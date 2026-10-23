import AsyncStorage from '@react-native-async-storage/async-storage';
import { personId } from './lens/household';
import { Person } from './lens/people';
import { readSettings } from './relay/RelayClient';

const NOTICE_KEY = 'everyseat.notice.seen';
const HOUSEHOLD_KEY = 'everyseat.household';
const READ_TIMEOUT_MS = 1500;

/** A read that never blocks the first screen: a slow or failing store counts as empty. */
const read = async (key: string): Promise<string | null> => {
  try {
    return await Promise.race<string | null>([
      AsyncStorage.getItem(key),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), READ_TIMEOUT_MS),
      ),
    ]);
  } catch (e) {
    console.info('storage', 'read failed', String(e));
    return null;
  }
};

const write = async (key: string, value: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    console.info('storage', 'write failed', String(e));
  }
};

export const hasSeenNotice = async (): Promise<boolean> =>
  (await read(NOTICE_KEY)) === '1';

export const markNoticeSeen = (): Promise<void> => write(NOTICE_KEY, '1');

export interface StoredHousehold {
  people: Person[];
  /** Milliseconds since the epoch when the list last changed; the latest writer wins. */
  updatedAt: number;
}

/** The household set up on this TV, or null on a first run (an empty list is a household too). */
export const loadHousehold = async (): Promise<StoredHousehold | null> => {
  const raw = await read(HOUSEHOLD_KEY);
  if (!raw) {
    return null;
  }
  try {
    const json = JSON.parse(raw);
    if (!Array.isArray(json?.people) || !Number.isFinite(json.updatedAt)) {
      return null;
    }
    const people: Person[] = [];
    for (const entry of json.people) {
      const settings = readSettings(entry?.settings);
      if (typeof entry?.name !== 'string' || !settings) {
        return null;
      }
      people.push({ id: personId(entry.name), name: entry.name, settings });
    }
    return { people, updatedAt: json.updatedAt };
  } catch (e) {
    console.info('storage', 'household unreadable', String(e));
    return null;
  }
};

export const saveHousehold = (household: StoredHousehold): Promise<void> =>
  write(
    HOUSEHOLD_KEY,
    JSON.stringify({
      people: household.people.map(({ name, settings }) => ({
        name,
        settings,
      })),
      updatedAt: household.updatedAt,
    }),
  );
