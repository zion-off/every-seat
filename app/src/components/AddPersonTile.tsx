import React, { forwardRef } from 'react';
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
import Focusable from './Focusable';

type Props = {
  onPress: () => void;
  marginRight?: number;
  autoFocus?: boolean;
  /** Nobody is in the household yet: the tile says so and invites the first person. */
  first?: boolean;
};

/** The last card on the couch screen: the same size as a person, drawn as an empty seat. */
const AddPersonTile = forwardRef<View, Props>(
  ({ onPress, marginRight = 0, autoFocus, first }, ref) => (
    <Focusable
      ref={ref}
      accessible
      accessibilityRole="button"
      accessibilityLabel={
        first
          ? 'Add the first person, with their name and comfort settings'
          : 'Add person, with their name and comfort settings'
      }
      hasTVPreferredFocus={autoFocus}
      onPress={onPress}
      radius={radius.lg}
      scale={focus.scaleTile}
      style={[styles.tile, { marginRight }]}
      contentStyle={(focused) => [
        styles.surface,
        focused && styles.surfaceFocused,
      ]}>
      {(focused) => (
        <>
          <View style={styles.head}>
            <View style={[styles.seat, focused && styles.seatFocused]}>
              <Text style={styles.plus}>+</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              Add person
            </Text>
          </View>
          <Text style={styles.detail} numberOfLines={2}>
            {first
              ? 'Start with yourself, or whoever watches most.'
              : 'Name and comfort settings'}
          </Text>
        </>
      )}
    </Focusable>
  ),
);

const styles = StyleSheet.create({
  tile: {
    width: size.tileW,
    height: size.personH,
    marginBottom: space.lg,
  },
  surface: {
    padding: space.md,
    borderWidth: size.border,
    borderStyle: 'dashed',
    borderColor: colors.line,
  },
  surfaceFocused: {
    borderStyle: 'solid',
    backgroundColor: colors.surfaceFocused,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  seat: {
    width: size.avatar,
    height: size.avatar,
    borderRadius: radius.pill,
    borderWidth: size.border,
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatFocused: {
    borderStyle: 'solid',
    borderColor: colors.text,
  },
  plus: {
    ...type.title,
    color: colors.text,
    fontWeight: weight.bold,
  },
  name: {
    ...type.title,
    flex: 1,
    marginLeft: space.sm,
    color: colors.text,
    fontWeight: weight.bold,
  },
  detail: {
    ...type.small,
    color: colors.textMuted,
  },
});

export default AddPersonTile;
