import { LensSettings } from './engine/types';

export const MEDIA_BASE = 'http://10.0.2.2:8080';

export const DEFAULT_TITLE = 'test_pattern';

/** Every comfort setting on, for use until a couch has been chosen. */
export const DEFAULT_LENS: LensSettings = {
  flashes: 'soften',
  loud: 'cap',
  scares: 'headsup',
  ad: 'off',
};

export const manifestUrl = (title: string) =>
  `${MEDIA_BASE}/${title}/master.m3u8`;

export const cuesUrl = (title: string) =>
  `${MEDIA_BASE}/${title}/cues.sensevtt`;
