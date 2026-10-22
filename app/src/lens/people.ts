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
    settings: { flashes: 'off', loud: 'cap', scares: 'off', ad: 'off' },
  },
  {
    id: 'mom',
    name: 'Mom',
    settings: { flashes: 'soften', loud: 'off', scares: 'off', ad: 'off' },
  },
  {
    id: 'grandpa',
    name: 'Grandpa',
    settings: { flashes: 'off', loud: 'off', scares: 'off', ad: 'on' },
  },
  {
    id: 'dad',
    name: 'Dad',
    settings: { flashes: 'off', loud: 'off', scares: 'off', ad: 'off' },
  },
];

export const personById = (id: string): Person | undefined =>
  PEOPLE.find((p) => p.id === id);
