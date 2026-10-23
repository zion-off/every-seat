import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, size, space, type, weight } from '../styles/tokens';
import Focusable from './Focusable';

type Props = {
  label: string;
  /** A colour dot before the label, for the heat of a moment. */
  dot?: string;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
};

/** A small rounded label on a solid surface, so it stays readable over a picture. */
const Pill = ({ label, dot, numberOfLines = 1, style }: Props) => (
  <View style={[styles.pill, style]}>
    {dot !== undefined && (
      <View style={[styles.dot, { backgroundColor: dot }]} />
    )}
    <Text style={styles.label} numberOfLines={numberOfLines}>
      {label}
    </Text>
  </View>
);

type ButtonProps = {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
};

/** A pill that can be pressed: the same height, padding, radius and type size as `Pill`. */
export const PillButton = ({
  label,
  accessibilityLabel,
  onPress,
}: ButtonProps) => (
  <Focusable
    accessible
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    onPress={onPress}
    radius={radius.pill}
    contentStyle={(focused) => [styles.pill, focused && styles.pillFocused]}>
    <Text style={styles.label} numberOfLines={1}>
      {label}
    </Text>
  </Focusable>
);

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: size.pill,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: size.border,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
  },
  pillFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  dot: {
    width: size.dot,
    height: size.dot,
    borderRadius: radius.pill,
    marginRight: space.xs,
  },
  label: {
    ...type.small,
    color: colors.text,
    fontWeight: weight.bold,
    flexShrink: 1,
  },
});

export default Pill;
