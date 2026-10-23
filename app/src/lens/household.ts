import { createContext, useContext, useRef } from 'react';
import { Person } from './people';

/** Everyone in the household; empty until someone is added. */
export const HouseholdContext = createContext<Person[]>([]);

export const useHousehold = (): Person[] => useContext(HouseholdContext);

/** A name as an id for matching and for links: lowercase letters and digits joined by dashes. */
export const personId = (name: string): string => {
  const trimmed = name.trim().toLowerCase();
  return trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || trimmed;
};

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
