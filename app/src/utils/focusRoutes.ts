import { FocusManager } from '@amazon-devices/react-native-kepler';
import { RefObject, useEffect } from 'react';
import { findNodeHandle, View } from 'react-native';

/** Makes Down from one control lead to a given control instead of the nearest one. */
export const useDownTo = (
  from: RefObject<View>,
  to: RefObject<View> | undefined,
) => {
  useEffect(() => {
    const fromTag = from.current && findNodeHandle(from.current);
    const toTag = to?.current && findNodeHandle(to.current);
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
      const tag = target.current && findNodeHandle(target.current);
      if (tag) {
        FocusManager.focus(tag);
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [target, delayMs]);
};
