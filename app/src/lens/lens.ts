import { Cue } from 'sensevtt';
import { LensSettings, NO_LENS } from '../engine/types';
import { Person } from './people';

/** The most protective setting of everyone on the couch; an empty couch changes nothing. */
export const combineLens = (people: Person[]): LensSettings =>
  people.reduce<LensSettings>(
    (lens, { settings }) => ({
      flashes:
        lens.flashes === 'soften' || settings.flashes === 'soften'
          ? 'soften'
          : 'off',
      loud: lens.loud === 'cap' || settings.loud === 'cap' ? 'cap' : 'off',
      scares:
        lens.scares === 'headsup' || settings.scares === 'headsup'
          ? 'headsup'
          : 'off',
      ad: lens.ad === 'on' || settings.ad === 'on' ? 'on' : 'off',
    }),
    NO_LENS,
  );

/** True when the lens acts on this cue: it dims, warns, or has the comfort rendition cover it. */
export const coversCue = (cue: Cue, lens: LensSettings): boolean => {
  switch (cue.type) {
    case 'flash':
      return lens.flashes === 'soften';
    case 'loud':
      return lens.loud === 'cap' || lens.scares === 'headsup';
    case 'scare':
      return lens.scares === 'headsup';
    default:
      return false;
  }
};

/** Short phrases for the settings that are on, in the order they appear on screen. */
export const describeLens = (lens: LensSettings): string[] => {
  const parts: string[] = [];
  if (lens.flashes === 'soften') {
    parts.push('Softens flashes');
  }
  if (lens.loud === 'cap') {
    parts.push('Keeps loud sounds in check');
  }
  if (lens.scares === 'headsup') {
    parts.push('Heads-up before scares');
  }
  if (lens.ad === 'on') {
    parts.push('Audio description on the phone');
  }
  return parts;
};

export const couchNames = (people: Person[]): string =>
  people.length === 0 ? 'Nobody yet' : people.map((p) => p.name).join(', ');

const INTENSITY_WORDS = [
  'mild',
  'moderate',
  'strong',
  'intense',
  'very intense',
];

/** A plain word for an intensity from 1 to 5, so a number never has to be explained. */
export const intensityWord = (intensity: number): string =>
  INTENSITY_WORDS[Math.min(Math.max(Math.round(intensity), 1), 5) - 1];

export interface CueSummary {
  flashes: number;
  loud: number;
  scares: number;
  /** Strongest intensity (1 to 5) among the moments the lens acts on; 0 when there are none. */
  strongest: number;
}

/** Counts, by kind, the moments of a film that the lens acts on. */
export const summarizeCues = (cues: Cue[], lens: LensSettings): CueSummary => {
  const summary: CueSummary = { flashes: 0, loud: 0, scares: 0, strongest: 0 };
  cues
    .filter((c) => coversCue(c, lens))
    .forEach((c) => {
      if (c.type === 'flash') {
        summary.flashes += 1;
      } else if (c.type === 'loud') {
        summary.loud += 1;
      } else {
        summary.scares += 1;
      }
      summary.strongest = Math.max(summary.strongest, Math.round(c.intensity));
    });
  return summary;
};
