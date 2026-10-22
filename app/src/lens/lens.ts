import { Cue } from 'react-native-sensevtt';
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
