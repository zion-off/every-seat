import { FocusManager } from '@amazon-devices/react-native-kepler';
import { RefObject, useEffect } from 'react';
import { findNodeHandle, View } from 'react-native';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** One explicit focus move: pressing `direction` on `from` leads to `to`. */
export type Route = {
  from: RefObject<View>;
  to: RefObject<View> | undefined;
  direction: Direction;
};

const tagOf = (ref: RefObject<View> | undefined) =>
  (ref?.current && findNodeHandle(ref.current)) || null;

/**
 * Sets a list of explicit focus moves and clears them when the list changes or the screen leaves.
 * `key` should change whenever the controls behind the refs change (for example the list of ids).
 */
export const useFocusRoutes = (build: () => Route[], key: string) => {
  useEffect(() => {
    const set: Array<{ tag: number; direction: Direction }> = [];
    for (const { from, to, direction } of build()) {
      const fromTag = tagOf(from);
      const toTag = tagOf(to);
      if (fromTag && toTag) {
        FocusManager.setNextFocus(fromTag, toTag, direction);
        set.push({ tag: fromTag, direction });
      }
    }
    return () =>
      set.forEach(({ tag, direction }) =>
        FocusManager.clearNextFocus(tag, direction),
      );
    // The routes depend only on what `key` describes; refs are stable objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
};

/** Makes Down from one control lead to a given control instead of the nearest one. */
export const useDownTo = (
  from: RefObject<View>,
  to: RefObject<View> | undefined,
) => {
  useEffect(() => {
    const fromTag = tagOf(from);
    const toTag = tagOf(to);
    if (!fromTag || !toTag) {
      return undefined;
    }
    FocusManager.setNextFocus(fromTag, toTag, 'down');
    return () => FocusManager.clearNextFocus(fromTag, 'down');
  }, [from, to]);
};

/** Puts focus on a control (such as a KUIC Button, which has no preferred-focus prop) shortly after mount. */
export const useFocusOnMount = (target: RefObject<View>, delayMs = 150) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      const tag = tagOf(target);
      if (tag) {
        FocusManager.focus(tag);
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [target, delayMs]);
};
