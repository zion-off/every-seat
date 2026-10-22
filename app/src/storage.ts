import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTICE_KEY = 'everyseat.notice.seen';
const READ_TIMEOUT_MS = 1500;

/** Reads never block the first screen: a slow or failing store counts as "not seen". */
export const hasSeenNotice = async (): Promise<boolean> => {
  try {
    const value = await Promise.race<string | null>([
      AsyncStorage.getItem(NOTICE_KEY),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), READ_TIMEOUT_MS),
      ),
    ]);
    return value === '1';
  } catch (e) {
    console.info('storage', 'read failed', String(e));
    return false;
  }
};

export const markNoticeSeen = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(NOTICE_KEY, '1');
  } catch (e) {
    console.info('storage', 'write failed', String(e));
  }
};
