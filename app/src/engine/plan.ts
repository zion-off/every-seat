import { mergeRuns, Window } from './envelope';
import { Cue, LensSettings } from './types';

export const FLASH_DIM = 0.5;
export const SOFTEN_DIM = 0.3;
export const DEFAULT_LEAD_S = 5;
const DEFAULT_PRE_S = 1.5;
const DEFAULT_POST_S = 1.0;
/** Extra margin on each side of a cue whose time is only approximate. */
const APPROX_MARGIN_S = 1.0;
/** The duck starts this long before the onset and reaches full depth 0.1 s before it. */
export const DUCK_LEAD_S = 0.4;
const DUCK_RAMP_S = 0.3;
const DUCK_RELEASE_S = 1.0;
const DUCK_DB = -18;
/**
 * Measured on the Vega Virtual Device: a volume change is heard about 0.35 s after the picture
 * time at which it is made, so the duck is scheduled that much earlier.
 */
export const AUDIO_LATENCY_S = 0.35;

export type Plan = {
  /** Dim windows for flash cues, merged into runs. */
  flash: Window[];
  /** Dim windows for softened scares and loud moments. */
  softenDim: Window[];
  /** Duck windows for softened scares and loud moments, at full strength 1. */
  duck: Window[];
};

const margin = (cue: Cue) => (cue.anchor === 'approx' ? APPROX_MARGIN_S : 0);

/** Cues that raise a heads-up card: the ones the lens asks to be warned about. */
export const headsUpCues = (cues: Cue[], lens: LensSettings): Cue[] =>
  lens.scares === 'headsup'
    ? cues.filter((c) => c.type === 'scare' || c.type === 'loud')
    : [];

export const leadSeconds = (cue: Cue): number =>
  (cue.lead_s ?? DEFAULT_LEAD_S) + margin(cue);

/** When the duck must start; a card left unanswered at this moment applies Soften. */
export const softenDeadline = (cue: Cue): number =>
  cue.start - margin(cue) - DUCK_LEAD_S - AUDIO_LATENCY_S;

const flashWindow = (cue: Cue): Window => {
  const m = margin(cue);
  const post = cue.post_s ?? DEFAULT_POST_S;
  const fullEnd = cue.end + m;
  return {
    key: `flash:${cue.id}`,
    rampInStart: cue.start - m - (cue.pre_s ?? DEFAULT_PRE_S),
    fullStart: cue.start - m,
    fullEnd,
    rampOutEnd: fullEnd + post,
    level: FLASH_DIM,
  };
};

/** `shift` moves the whole window, in seconds of media time. */
const softenWindow = (
  cue: Cue,
  level: number,
  key: string,
  shift: number,
): Window => {
  const m = margin(cue);
  const fullEnd = cue.end + m + shift;
  const rampInStart = cue.start - m - DUCK_LEAD_S + shift;
  return {
    key: `${key}:${cue.id}`,
    rampInStart,
    fullStart: rampInStart + DUCK_RAMP_S,
    fullEnd,
    rampOutEnd: fullEnd + DUCK_RELEASE_S,
    level,
  };
};

export const buildPlan = (
  cues: Cue[],
  lens: LensSettings,
  softened: ReadonlySet<string>,
): Plan => {
  const flash =
    lens.flashes === 'soften'
      ? mergeRuns(cues.filter((c) => c.type === 'flash').map(flashWindow))
      : [];
  const soft = headsUpCues(cues, lens).filter((c) => softened.has(c.id));
  return {
    flash,
    softenDim: mergeRuns(
      soft.map((c) => softenWindow(c, SOFTEN_DIM, 'dim', 0)),
    ),
    duck: mergeRuns(
      soft.map((c) => softenWindow(c, 1, 'duck', -AUDIO_LATENCY_S)),
    ),
  };
};

/**
 * Gain for a duck depth between 0 (none) and 1 (full); depth moves linearly in dB. The device
 * applies volume in steps of 0.01, so the gain is rounded to the nearest step.
 */
export const duckGain = (depth: number): number =>
  Math.round(Math.pow(10, (DUCK_DB * depth) / 20) * 100) / 100;
