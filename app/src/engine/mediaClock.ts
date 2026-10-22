import { MediaEventName, MediaSession } from '../media/MediaSession';

/** Seconds added to the media time so the clock matches the frame on screen. */
export const RENDER_BIAS_S = 0.051;
/** A timeupdate this far from the running clock is treated as an unexplained jump. */
const JUMP_S = 1;
/** How long an unexplained jump is ignored before it is accepted as real. */
const JUMP_HOLD_MS = 2000;
/** Playback counts as moving again once the media time has advanced this much. */
const ADVANCE_S = 0.02;

declare const global: any;

const perfNow = (): number => {
  const perf = global.performance;
  return perf && perf.now ? perf.now() : Date.now();
};

type Anchor = {
  mediaT: number;
  perfT: number;
  running: boolean;
  seeking: boolean;
};

/**
 * Media time estimated between events: anchored on `timeupdate`, `playing`, `pause`,
 * `seeking` and `seeked`, and extrapolated with a monotonic timer.
 *
 * It is frozen from `play` until `playing` (anchoring on `play` leads the picture by up to
 * 0.66 s), frozen at the target while seeking, and ignores unexplained jumps of over a second
 * for two seconds.
 */
export class MediaClock {
  private anchor: Anchor = {
    mediaT: 0,
    perfT: perfNow(),
    running: false,
    seeking: false,
  };
  private suspectSince: number | null = null;
  private resetListeners = new Set<() => void>();

  constructor(private session: MediaSession) {}

  /** Called after every discontinuity (seek, accepted jump, stall) so schedulers can resync. */
  onDiscontinuity(cb: () => void) {
    this.resetListeners.add(cb);
    return () => {
      this.resetListeners.delete(cb);
    };
  }

  private discontinuity() {
    this.resetListeners.forEach((cb) => cb());
  }

  private set(mediaT: number, running: boolean, seeking: boolean) {
    this.anchor = { mediaT, perfT: perfNow(), running, seeking };
    this.suspectSince = null;
  }

  /** Media time of the frame on screen, in seconds. */
  now(): number {
    const a = this.anchor;
    if (!a.running || a.seeking) {
      return a.mediaT;
    }
    return a.mediaT + (perfNow() - a.perfT) / 1000 + RENDER_BIAS_S;
  }

  get moving(): boolean {
    return this.anchor.running && !this.anchor.seeking;
  }

  /** Freezes the clock at a seek target immediately, before the `seeking` event arrives. */
  noteSeek(target: number) {
    this.set(target, false, true);
    this.discontinuity();
  }

  handle(name: MediaEventName) {
    const ct = this.session.currentTime;
    const a = this.anchor;
    switch (name) {
      case 'play':
      case 'waiting':
        this.set(ct, false, a.seeking);
        break;
      case 'playing':
        this.set(ct, !this.session.paused, false);
        break;
      case 'pause':
        this.set(ct, false, a.seeking);
        break;
      case 'seeking':
        this.set(ct, false, true);
        this.discontinuity();
        break;
      case 'seeked':
        this.set(ct, false, false);
        this.discontinuity();
        break;
      case 'timeupdate':
        this.onTimeUpdate(ct);
        break;
      default:
        break;
    }
  }

  private onTimeUpdate(ct: number) {
    const a = this.anchor;
    if (a.seeking || this.session.paused) {
      return;
    }
    if (!a.running) {
      if (ct > a.mediaT + ADVANCE_S) {
        this.set(ct, true, false);
      }
      return;
    }
    const predicted = a.mediaT + (perfNow() - a.perfT) / 1000;
    if (Math.abs(ct - predicted) > JUMP_S) {
      const t = perfNow();
      if (this.suspectSince === null) {
        this.suspectSince = t;
        console.info(
          'clock',
          'jump ignored',
          predicted.toFixed(3),
          ct.toFixed(3),
        );
      }
      if (t - this.suspectSince < JUMP_HOLD_MS) {
        return;
      }
      console.info(
        'clock',
        'jump accepted',
        predicted.toFixed(3),
        ct.toFixed(3),
      );
      this.set(ct, true, false);
      this.discontinuity();
      return;
    }
    this.set(ct, true, false);
  }
}
