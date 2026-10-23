import { LensSettings } from '../engine/types';

export interface Person {
  id: string;
  name: string;
  /** These are choices people make, not anything about them. */
  settings: LensSettings;
}

/** The most people a household holds; the couch screen shows them on two rows with the add tile. */
export const MAX_PEOPLE = 7;

/** The longest name the editor accepts, so a tile never has to wrap it. */
export const MAX_NAME = 16;
