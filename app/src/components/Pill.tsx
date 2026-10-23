import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, size, space, type, weight } from '../styles/tokens';

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

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: size.pill,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: size.border,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
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
