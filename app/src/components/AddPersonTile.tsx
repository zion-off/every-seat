import React, { RefObject, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  focus,
  radius,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';
import { useDownTo } from '../utils/focusRoutes';
import Focusable from './Focusable';

type Props = {
  onPress: () => void;
  marginRight?: number;
  autoFocus?: boolean;
  /** When set, Down from this tile goes to that control instead of the nearest one. */
  downTo?: RefObject<View>;
};

/** The tile after the people on the couch screen: adds someone to the household. */
const AddPersonTile = ({
  onPress,
  marginRight = 0,
  autoFocus,
  downTo,
}: Props) => {
  const ref = useRef<View>(null);
  useDownTo(ref, downTo);
  return (
    <Focusable
      ref={ref}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Add person. Set up comfort settings for someone new."
      hasTVPreferredFocus={autoFocus}
      onPress={onPress}
      radius={radius.lg}
      scale={focus.scaleTile}
      style={[styles.tile, { marginRight }]}
      contentStyle={(focused) => [
        styles.surface,
        focused && styles.surfaceFocused,
      ]}>
      <View style={styles.plus}>
        <Text style={styles.plusMark}>+</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        Add person
      </Text>
      <Text style={styles.detail} numberOfLines={2}>
        Name and comfort settings
      </Text>
    </Focusable>
  );
};

const styles = StyleSheet.create({
  tile: {
    width: size.tileW,
    marginBottom: space.sm,
  },
  surface: {
    backgroundColor: colors.surface,
    borderWidth: size.border,
    borderColor: colors.line,
    padding: space.md,
  },
  surfaceFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  plus: {
    width: size.avatar,
    height: size.avatar,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  plusMark: {
    ...type.title,
    color: colors.accent,
    fontWeight: weight.bold,
  },
  name: {
    ...type.title,
    color: colors.text,
    fontWeight: weight.bold,
  },
  detail: {
    ...type.small,
    color: colors.textMuted,
  },
});

export default AddPersonTile;
