import { Animated, Easing } from 'react-native';
import { cuesUrl, manifestUrl } from '../config';
import { MediaSession } from '../media/MediaSession';
import { sample } from './envelope';
import { MediaClock } from './mediaClock';
import {
  buildPlan,
  duckGain,
  headsUpCues,
  leadSeconds,
  Plan,
  softenDeadline,
} from './plan';
import { loadCues } from './sensevtt';
import { Cue, LensSettings, NO_LENS } from './types';

export const MAIN_AUDIO = 'main';
export const COMFORT_AUDIO = 'comfort';

/** Opacity never reaches 0: a zero-opacity native view is dropped and then dims late. */
const MIN_OPACITY = 0.01;
const TICK_MS = 50;
/**
 * Measured on the Vega Virtual Device: the overlay reaches a level about 0.06 s after the
 * clock says it should, so the dim is sampled that far ahead.
 */
const DIM_LEAD_S = 0.06;
/** A decision is cleared once the clock is this far before the card, so a replay asks again. */
const REPLAY_SLACK_S = 0.5;

export const audioLabelFor = (lens: LensSettings): string =>
  lens.loud === 'cap' ? COMFORT_AUDIO : MAIN_AUDIO;

export type EngineState = {
  /** Heads-up cards due now. */
  cards: Cue[];
  /** A flash cue is being dimmed. */
  flashDimming: boolean;
  /** The live volume duck is in effect. */
  ducking: boolean;
  /** The live volume gain, 1 when untouched. */
  volume: number;
  audio: string;
};

type Listener = (state: EngineState) => void;

/**
 * Applies the combined lens to playback. Cue times come from detectors; the engine only reads
 * the clock and moves the dim overlay, the live volume and the audio rendition.
 */
export class PlaybackEngine {
  readonly dim = new Animated.Value(MIN_OPACITY);
  readonly clock: MediaClock;

  private cues: Cue[] = [];
  private lens: LensSettings = NO_LENS;
  private plan: Plan = { flash: [], softenDim: [], duck: [] };
  private softened = new Set<string>();
  private watching = new Set<string>();
  private cards = new Map<string, Cue>();
  private audio = MAIN_AUDIO;
  private loaded = false;
  private dimPhase: string | null = null;
  private dimLevel = 0;
  private gain = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: EngineState = {
    cards: [],
    flashDimming: false,
    ducking: false,
    volume: 1,
    audio: MAIN_AUDIO,
  };
  private listeners = new Set<Listener>();
  private offs: Array<() => void> = [];

  constructor(private session: MediaSession) {
    this.clock = new MediaClock(session);
    this.offs.push(
      session.addListener((name) => {
        this.clock.handle(name);
        this.tick();
      }),
      this.clock.onDiscontinuity(() => {
        this.dimPhase = null;
      }),
    );
  }

  getState(): EngineState {
    return this.state;
  }

  /** The cues of the open title, for drawing the seek bar. */
  get cueList(): Cue[] {
    return this.cues;
  }

  subscribe(cb: Listener) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Loads the title's cues and stream. Playback starts on the rendition the lens asks for. */
  async open(title: string) {
    const label = audioLabelFor(this.lens);
    const [file] = await Promise.all([
      loadCues(cuesUrl(title)),
      this.session.load(manifestUrl(title), label),
    ]);
    this.cues = file?.cues ?? [];
    this.loaded = true;
    this.audio = this.session.activeAudioLabel() ?? label;
    console.info(
      'engine',
      'opened',
      title,
      `${this.cues.length} cues`,
      `audio=${this.audio}`,
      JSON.stringify(
        this.session
          .audioRenditions()
          .map((r) => [r.id, r.label, r.language, r.active]),
      ),
    );
    this.replan();
    this.applyAudio();
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
  }

  /** Replaces the combined lens, for example when the couch changes. */
  setLens(lens: LensSettings) {
    this.lens = lens;
    console.info(
      'engine',
      'lens',
      JSON.stringify(lens),
      this.clock.now().toFixed(3),
    );
    this.replan();
    this.applyAudio();
    this.dimPhase = null;
    this.tick();
  }

  /** Seeks and freezes the clock at the target so the dim snaps straight to the right level. */
  seek(t: number) {
    this.clock.noteSeek(t);
    this.session.seek(t);
  }

  /** Card [Soften]: duck the volume and dim by 30% around the moment. */
  soften(id: string) {
    this.watching.delete(id);
    this.softened.add(id);
    this.cards.delete(id);
    this.replan();
    this.tick();
  }

  /** Card [Watch]: leave the moment untouched. */
  watch(id: string) {
    this.softened.delete(id);
    this.watching.add(id);
    this.cards.delete(id);
    this.replan();
    this.tick();
  }

  /** How a heads-up moment was settled, whether by a choice or by the deadline. */
  decisionFor(id: string): 'soften' | 'watch' | undefined {
    if (this.softened.has(id)) {
      return 'soften';
    }
    return this.watching.has(id) ? 'watch' : undefined;
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.offs.forEach((off) => off());
    this.offs = [];
    this.listeners.clear();
    this.dim.stopAnimation();
  }

  private replan() {
    this.plan = buildPlan(this.cues, this.lens, this.softened);
  }

  /** Audio is chosen before the first frame; after that it changes only when the couch does. */
  private applyAudio() {
    if (!this.loaded) {
      return;
    }
    const label = audioLabelFor(this.lens);
    if (label !== this.audio && this.session.selectAudio(label)) {
      console.info('engine', 'audio rendition', this.audio, '->', label);
      this.audio = label;
    }
  }

  private tick() {
    if (!this.loaded) {
      return;
    }
    const t = this.clock.now();
    this.updateHeadsUp(t);
    this.updateDim(t);
    this.updateDuck(t);
    this.publish(t);
  }

  private updateHeadsUp(t: number) {
    let replan = false;
    const watched = headsUpCues(this.cues, this.lens);
    this.cards.forEach((cue, id) => {
      if (!watched.includes(cue)) {
        this.cards.delete(id);
      }
    });
    watched.forEach((cue) => {
      const sinceCard = t - (cue.start - leadSeconds(cue));
      const deadline = softenDeadline(cue);
      const decided = this.softened.has(cue.id) || this.watching.has(cue.id);
      if (sinceCard < -REPLAY_SLACK_S) {
        if (decided) {
          this.softened.delete(cue.id);
          this.watching.delete(cue.id);
          replan = true;
        }
        this.cards.delete(cue.id);
      } else if (t < deadline) {
        if (!decided && sinceCard >= 0) {
          this.cards.set(cue.id, cue);
        }
      } else {
        this.cards.delete(cue.id);
        if (!decided && t < cue.end) {
          console.info('engine', 'no input: soften', cue.id);
          this.softened.add(cue.id);
          replan = true;
        }
      }
    });
    if (replan) {
      this.replan();
    }
  }

  private dimSample(t: number) {
    const flash = sample(this.plan.flash, t);
    const soft = sample(this.plan.softenDim, t);
    return soft.level > flash.level ? soft : flash;
  }

  /** Drives the overlay natively: each ramp is one timed animation that ends on schedule. */
  private updateDim(t: number) {
    const s = this.dimSample(t + DIM_LEAD_S);
    if (!this.clock.moving) {
      if (this.dimPhase !== 'frozen' || s.level !== this.dimLevel) {
        this.dimPhase = 'frozen';
        this.dimLevel = s.level;
        this.dim.setValue(Math.max(MIN_OPACITY, s.level));
      }
      return;
    }
    if (s.phase === this.dimPhase) {
      return;
    }
    this.dimPhase = s.phase;
    this.dimLevel = s.level;
    this.dim.setValue(Math.max(MIN_OPACITY, s.level));
    if (s.endLevel !== s.level) {
      Animated.timing(this.dim, {
        toValue: Math.max(MIN_OPACITY, s.endLevel),
        duration: Math.max(1, (s.endAt - t - DIM_LEAD_S) * 1000),
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
  }

  private updateDuck(t: number) {
    const depth = sample(this.plan.duck, t).level;
    const gain = depth > 0 ? duckGain(depth) : 1;
    if (
      Math.abs(gain - this.gain) > 0.004 ||
      (depth === 0 && this.gain !== 1)
    ) {
      this.gain = gain;
      this.session.volume = gain;
    }
  }

  private publish(t: number) {
    const cards = Array.from(this.cards.values());
    const flashDimming = sample(this.plan.flash, t).level > 0;
    const ducking = this.gain < 1;
    const volume = this.gain;
    const prev = this.state;
    if (
      prev.flashDimming === flashDimming &&
      prev.ducking === ducking &&
      prev.volume === volume &&
      prev.audio === this.audio &&
      prev.cards.length === cards.length &&
      prev.cards.every((c, i) => c === cards[i])
    ) {
      return;
    }
    this.state = { cards, flashDimming, ducking, volume, audio: this.audio };
    this.listeners.forEach((cb) => cb(this.state));
  }
}
