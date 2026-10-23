import { SegmentColorsConfig } from '@amazon-devices/kepler-ui-components';
import { Cue } from 'sensevtt';
import { LensSettings } from '../engine/types';
import { colors, heat as heatRamp } from '../styles/tokens';
import { coversCue } from './lens';

export interface BreakMarker {
  position: number;
  type: 'break';
}

export interface Heatmap {
  markers: BreakMarker[];
  segmentColors: SegmentColorsConfig;
  /** How many moments are marked for this couch. */
  count: number;
}

/** A marked moment is drawn at least this wide, as a share of the film, so it stays visible. */
const MIN_SPAN = 0.012;

const NEUTRAL = {
  baseColor: colors.line,
  progressedColor: colors.text,
  seekColor: colors.textMuted,
};

const heat = (intensity: number) => {
  const step =
    heatRamp[Math.min(heatRamp.length, Math.max(1, Math.round(intensity))) - 1];
  return {
    baseColor: step.base,
    progressedColor: step.progressed,
    seekColor: step.base,
  };
};

interface Span {
  lo: number;
  hi: number;
  intensity: number;
}

/**
 * Marks the moments the combined lens acts on. The bar is split into alternating plain and marked
 * segments with break markers; positions and `totalMs` share one unit.
 */
export const buildHeatmap = (
  cues: Cue[],
  lens: LensSettings,
  totalMs: number,
): Heatmap => {
  const spans: Span[] = [];
  if (totalMs > 0) {
    const min = totalMs * MIN_SPAN;
    cues
      .filter((c) => coversCue(c, lens))
      .sort((a, b) => a.start - b.start)
      .forEach((c) => {
        const mid = ((c.start + c.end) / 2) * 1000;
        const half = Math.max(min, (c.end - c.start) * 1000) / 2;
        const lo = Math.max(min / 2, mid - half);
        const hi = Math.min(totalMs - min / 2, mid + half);
        const last = spans[spans.length - 1];
        if (last && lo - last.hi < min) {
          last.hi = Math.max(last.hi, hi);
          last.intensity = Math.max(last.intensity, c.intensity);
        } else if (hi > lo) {
          spans.push({ lo, hi, intensity: c.intensity });
        }
      });
  }

  const markers: BreakMarker[] = [];
  const segmentColors: SegmentColorsConfig = { 0: NEUTRAL };
  spans.forEach((s, i) => {
    markers.push(
      { position: Math.round(s.lo), type: 'break' },
      { position: Math.round(s.hi), type: 'break' },
    );
    segmentColors[2 * i + 1] = heat(s.intensity);
    segmentColors[2 * i + 2] = NEUTRAL;
  });
  return { markers, segmentColors, count: spans.length };
};
