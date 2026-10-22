import { createContext, useContext, useRef } from 'react';
import { LensSettings } from '../engine/types';
import { PEOPLE, Person } from './people';

/** Everyone the app knows by name: the local seed list plus anyone the companion has named. */
export const HouseholdContext = createContext<Person[]>(PEOPLE);

export const useHousehold = (): Person[] => useContext(HouseholdContext);

/** A name as an id for matching and for links: lowercase letters and digits joined by dashes. */
export const personId = (name: string): string => {
  const trimmed = name.trim().toLowerCase();
  return trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || trimmed;
};

const sameSettings = (a: LensSettings, b: LensSettings): boolean =>
  a.flashes === b.flashes &&
  a.loud === b.loud &&
  a.scares === b.scares &&
  a.ad === b.ad;

/**
 * Adds new people and takes the incoming settings for people already known, keeping the order.
 * Returns the same array when nothing changes, so nothing re-renders.
 */
export const mergePeople = (
  household: Person[],
  incoming: Person[],
): Person[] =>
  incoming.reduce((next, person) => {
    const at = next.findIndex((p) => p.id === person.id);
    if (at === -1) {
      return [...next, person];
    }
    const known = next[at];
    if (
      known.name === person.name &&
      sameSettings(known.settings, person.settings)
    ) {
      return next;
    }
    return next.map((p, i) => (i === at ? person : p));
  }, household);

export const sameIds = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Keeps the previous object while a new one has the same content, so effects keyed on it stay quiet. */
export const useStableValue = <T>(value: T): T => {
  const ref = useRef(value);
  if (JSON.stringify(ref.current) !== JSON.stringify(value)) {
    ref.current = value;
  }
  return ref.current;
};
