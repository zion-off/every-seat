import React, { RefObject, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, size, space, type, weight } from '../styles/tokens';
import { useDownTo } from '../utils/focusRoutes';
import Focusable from './Focusable';

type Props = {
  name: string;
  onPress: () => void;
  /** When set, Down from this control goes to that control instead of the nearest one. */
  downTo?: RefObject<View>;
};

/** A small "Edit" control under a person's tile; Down from the tile reaches it. */
const EditControl = ({ name, onPress, downTo }: Props) => {
  const ref = useRef<View>(null);
  useDownTo(ref, downTo);
  return (
    <Focusable
      ref={ref}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Edit ${name}`}
      onPress={onPress}
      radius={radius.pill}
      style={styles.frame}
      contentStyle={(focused) => [styles.pill, focused && styles.pillFocused]}>
      {(focused) => (
        <Text style={[styles.text, focused && styles.textFocused]}>Edit</Text>
      )}
    </Focusable>
  );
};

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'flex-start',
    height: size.pill,
    marginBottom: space.md,
  },
  pill: {
    height: size.pill,
    flexGrow: 0,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: size.border,
    borderColor: colors.line,
  },
  pillFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  text: {
    ...type.small,
    color: colors.textMuted,
    fontWeight: weight.bold,
  },
  textFocused: {
    color: colors.text,
  },
});

export default EditControl;
