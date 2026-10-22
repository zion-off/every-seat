import type { Preferences } from 'react-native-sensevtt';
import { LensSettings } from './types';

export const MAIN_AUDIO = 'main';
export const COMFORT_AUDIO = 'comfort';

/** The audio rendition the couch needs: the comfort mix whenever any sudden loud sound is capped. */
export const audioLabelFor = (lens: LensSettings): string =>
  lens.loud === 'cap' ? COMFORT_AUDIO : MAIN_AUDIO;

/** What the scheduler is asked to do for a couch. Audio is chosen separately, by rendition. */
export const preferencesFor = (lens: LensSettings): Preferences => ({
  flashes: lens.flashes === 'soften' ? 'dim' : 'off',
  headsUp: lens.scares === 'headsup' ? 'on' : 'off',
});
