import { FocusManager } from '@amazon-devices/react-native-kepler';
import React, { RefObject, useEffect, useRef } from 'react';
import { findNodeHandle, StyleSheet, Text, View } from 'react-native';
import { describeLens } from '../lens/lens';
import { Person } from '../lens/people';
import {
  colors,
  focus,
  radius,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';
import Avatar from './Avatar';
import Focusable from './Focusable';

type Props = {
  person: Person;
  selected: boolean;
  onPress: () => void;
  /** A card in the couch grid, or a slimmer row for the side panel. */
  variant: 'card' | 'row';
  /** Lines of settings text; the full text is always in the spoken label. */
  lines?: number;
  /** Space after the tile, so a row of tiles keeps its gaps without leaving the container. */
  marginRight?: number;
  autoFocus?: boolean;
  /** When set, Down from this tile goes to that control instead of the nearest one. */
  downTo?: RefObject<View>;
};

const summary = (person: Person): string => {
  const parts = describeLens(person.settings);
  return parts.length > 0 ? parts.join(' · ') : 'No comfort settings';
};

const PersonTile = ({
  person,
  selected,
  onPress,
  variant,
  lines = 2,
  marginRight = 0,
  autoFocus,
  downTo,
}: Props) => {
  const card = variant === 'card';
  const ref = useRef<View>(null);
  useEffect(() => {
    const from = ref.current && findNodeHandle(ref.current);
    const to = downTo?.current && findNodeHandle(downTo.current);
    if (!from || !to) {
      return undefined;
    }
    FocusManager.setNextFocus(from, to, 'down');
    return () => FocusManager.clearNextFocus(from, 'down');
  }, [downTo]);
  const avatar = <Avatar name={person.name} selected={selected} />;
  const box = (
    <View style={[styles.box, selected && styles.boxSelected]}>
      {selected && <View style={styles.tick} />}
    </View>
  );
  return (
    <Focusable
      ref={ref}
      accessible
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${person.name}. ${summary(person)}. ${
        selected ? 'On the couch' : 'Not on the couch'
      }`}
      hasTVPreferredFocus={autoFocus}
      onPress={onPress}
      radius={card ? radius.lg : radius.md}
      scale={card ? focus.scaleTile : focus.scaleControl}
      style={[card ? styles.card : styles.row, { marginRight }]}
      contentStyle={(focused) => [
        styles.surface,
        card ? styles.surfaceCard : styles.surfaceRow,
        selected && styles.surfaceSelected,
        focused && styles.surfaceFocused,
      ]}>
      {card ? (
        <>
          <View style={styles.cardHead}>
            {avatar}
            {box}
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {person.name}
          </Text>
          <Text style={styles.detail} numberOfLines={lines}>
            {summary(person)}
          </Text>
        </>
      ) : (
        <View style={styles.rowHead}>
          {avatar}
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>
              {person.name}
            </Text>
            <Text style={styles.detail} numberOfLines={lines}>
              {summary(person)}
            </Text>
          </View>
          {box}
        </View>
      )}
    </Focusable>
  );
};

const styles = StyleSheet.create({
  card: {
    width: size.tileW,
    marginBottom: space.lg,
  },
  row: {
    alignSelf: 'stretch',
    marginBottom: space.sm,
  },
  surface: {
    backgroundColor: colors.surface,
    borderWidth: size.border,
    borderColor: colors.line,
  },
  surfaceCard: {
    padding: space.md,
  },
  surfaceRow: {
    padding: space.sm,
  },
  surfaceSelected: {
    backgroundColor: colors.surfaceRaised,
  },
  surfaceFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    marginHorizontal: space.sm,
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
  box: {
    width: size.check,
    height: size.check,
    borderRadius: radius.pill,
    borderWidth: size.border * 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  tick: {
    width: size.tick.width,
    height: size.tick.height,
    borderLeftWidth: size.tick.stroke,
    borderBottomWidth: size.tick.stroke,
    borderColor: colors.onAccent,
    transform: [{ rotate: '-45deg' }, { translateY: -size.tick.height / 4 }],
  },
});

export default PersonTile;
