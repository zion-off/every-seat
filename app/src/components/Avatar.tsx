import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, size, type, weight } from '../styles/tokens';

type Props = {
  name: string;
  /** Filled amber, as for someone who is on the couch. */
  selected?: boolean;
  small?: boolean;
};

/** A person's initial in a circle; decorative, since the name is always spoken beside it. */
const Avatar = ({ name, selected, small }: Props) => (
  <View
    accessible={false}
    style={[
      styles.circle,
      small ? styles.small : styles.regular,
      selected && styles.selected,
    ]}>
    <Text
      style={[
        small ? styles.initialSmall : styles.initial,
        selected && styles.initialSelected,
      ]}>
      {name.charAt(0)}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  circle: {
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regular: {
    width: size.avatar,
    height: size.avatar,
  },
  small: {
    width: size.avatarSm,
    height: size.avatarSm,
  },
  selected: {
    backgroundColor: colors.accent,
  },
  initial: {
    ...type.title,
    color: colors.text,
    fontWeight: weight.bold,
  },
  initialSmall: {
    ...type.small,
    color: colors.text,
    fontWeight: weight.bold,
  },
  initialSelected: {
    color: colors.onAccent,
  },
});

export default Avatar;
