/** A ramp up, a hold and a ramp down, in media seconds. */
export type Window = {
  key: string;
  rampInStart: number;
  fullStart: number;
  fullEnd: number;
  rampOutEnd: number;
  level: number;
};

export type Sample = {
  level: number;
  /** Identifies the current ramp or hold, so a caller can restart an animation when it changes. */
  phase: string;
  /** Level at the end of the current phase. */
  endLevel: number;
  /** Media time at the end of the current phase. */
  endAt: number;
};

const IDLE: Sample = { level: 0, phase: 'idle', endLevel: 0, endAt: Infinity };

const sampleWindow = (w: Window, t: number): Sample | null => {
  if (t < w.rampInStart || t >= w.rampOutEnd) {
    return null;
  }
  if (t < w.fullStart) {
    const span = w.fullStart - w.rampInStart;
    return {
      level: (w.level * (t - w.rampInStart)) / span,
      phase: `${w.key}:in`,
      endLevel: w.level,
      endAt: w.fullStart,
    };
  }
  if (t < w.fullEnd) {
    return {
      level: w.level,
      phase: `${w.key}:hold`,
      endLevel: w.level,
      endAt: w.fullEnd,
    };
  }
  const span = w.rampOutEnd - w.fullEnd;
  return {
    level: (w.level * (w.rampOutEnd - t)) / span,
    phase: `${w.key}:out`,
    endLevel: 0,
    endAt: w.rampOutEnd,
  };
};

/** The strongest window at `t`. */
export const sample = (windows: Window[], t: number): Sample => {
  let best: Sample = IDLE;
  windows.forEach((w) => {
    const s = sampleWindow(w, t);
    if (s && s.level > best.level) {
      best = s;
    }
  });
  return best;
};

/**
 * Joins windows of equal strength whose ramps overlap into one run that holds through the gap,
 * so a ramp never starts inside a run.
 */
export const mergeRuns = (windows: Window[]): Window[] => {
  const sorted = [...windows].sort((a, b) => a.rampInStart - b.rampInStart);
  const runs: Window[] = [];
  sorted.forEach((w) => {
    const last = runs[runs.length - 1];
    if (last && last.level === w.level && w.rampInStart < last.rampOutEnd) {
      last.fullEnd = Math.max(last.fullEnd, w.fullEnd);
      last.rampOutEnd = Math.max(last.rampOutEnd, w.rampOutEnd);
    } else {
      runs.push({ ...w });
    }
  });
  return runs;
};
