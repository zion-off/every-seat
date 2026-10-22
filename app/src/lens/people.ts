import { LensSettings } from '../engine/types';

export interface Person {
  id: string;
  name: string;
  settings: LensSettings;
}

/** The household's comfort settings. These are choices people make, not anything about them. */
export const PEOPLE: Person[] = [
  {
    id: 'leo',
    name: 'Leo',
    settings: { flashes: 'soften', loud: 'cap', scares: 'headsup', ad: 'off' },
  },
  {
    id: 'mira',
    name: 'Mira',
    settings: { flashes: 'soften', loud: 'off', scares: 'off', ad: 'off' },
  },
  {
    id: 'nana',
    name: 'Nana',
    settings: { flashes: 'off', loud: 'cap', scares: 'off', ad: 'on' },
  },
  {
    id: 'sam',
    name: 'Sam',
    settings: { flashes: 'off', loud: 'off', scares: 'off', ad: 'off' },
  },
];

export const personById = (id: string): Person | undefined =>
  PEOPLE.find((p) => p.id === id);
