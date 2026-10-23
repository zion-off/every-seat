import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { formatClock, TitleEntry } from '../catalog';
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
  title: TitleEntry;
  /** The sentence read out with the film: its length and what is marked for the couch. */
  spoken: string;
  current: boolean;
  autoFocus?: boolean;
  marginRight?: number;
  onFocus: () => void;
  onPress: () => void;
};

/** A film as a picture with its length in the corner and its name below. */
const FilmTile = ({
  title,
  spoken,
  current,
  autoFocus,
  marginRight = 0,
  onFocus,
  onPress,
}: Props) => (
  <View style={[styles.column, { marginRight }]}>
    <Focusable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${title.name}. ${spoken}`}
      hasTVPreferredFocus={autoFocus}
      onFocus={onFocus}
      onPress={onPress}
      radius={radius.lg}
      scale={focus.scaleTile}
      style={styles.tile}
      contentStyle={styles.surface}>
      <Image source={title.still} style={styles.picture} accessible={false} />
      <View style={styles.length}>
        <Text style={styles.lengthText}>{formatClock(title.durationS)}</Text>
      </View>
    </Focusable>
    <Text
      style={[styles.name, current && styles.nameCurrent]}
      numberOfLines={1}>
      {title.name}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  column: {
    width: size.tileW,
  },
  tile: {
    width: size.tileW,
    height: size.tileH,
  },
  surface: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  picture: {
    width: size.tileW,
    height: size.tileH,
  },
  length: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.scrim,
  },
  lengthText: {
    ...type.small,
    color: colors.text,
    fontWeight: weight.bold,
  },
  name: {
    ...type.body,
    color: colors.textMuted,
    fontWeight: weight.bold,
    marginTop: space.lg,
  },
  nameCurrent: {
    color: colors.text,
  },
});

export default FilmTile;
