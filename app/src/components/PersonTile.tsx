import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { describeLens } from '../lens/lens';
import { Person } from '../lens/people';
import { COLORS } from '../styles/palette';
import { scaleUxToDp } from '../utils/pixelUtils';

type Props = {
  person: Person;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
  /** Smaller tiles for a row, used when the household is too big for one line of full ones. */
  dense?: boolean;
  autoFocus?: boolean;
};

const summary = (person: Person): string => {
  const parts = describeLens(person.settings);
  return parts.length > 0 ? parts.join(' · ') : 'No comfort settings';
};

const PersonTile = ({
  person,
  selected,
  onPress,
  compact,
  dense,
  autoFocus,
}: Props) => {
  const [focused, setFocused] = useState(false);
  const short = compact || dense;
  const lines = describeLens(person.settings);
  return (
    <Pressable
      accessible
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${person.name}. ${summary(person)}. ${
        selected ? 'On the couch' : 'Not on the couch'
      }`}
      hasTVPreferredFocus={autoFocus}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.tile,
        short ? styles.tileCompact : styles.tileFull,
        dense && styles.tileDense,
        selected && styles.tileSelected,
        focused && styles.tileFocused,
      ]}>
      <View style={[styles.head, short && styles.headCompact]}>
        <View style={[styles.avatar, selected && styles.avatarSelected]}>
          <Text style={[styles.initial, selected && styles.initialSelected]}>
            {person.name.charAt(0)}
          </Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {person.name}
        </Text>
        <View style={[styles.box, selected && styles.boxSelected]}>
          {selected && <View style={styles.tick} />}
        </View>
      </View>
      {short ? (
        <Text
          style={[styles.detail, styles.detailCompact]}
          numberOfLines={dense ? 3 : 2}>
          {summary(person)}
        </Text>
      ) : (
        <View style={styles.lines}>
          {lines.length === 0 ? (
            <Text style={styles.detail}>No comfort settings</Text>
          ) : (
            lines.map((line) => (
              <Text key={line} style={styles.detail}>
                {line}
              </Text>
            ))
          )}
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  tile: {
    backgroundColor: COLORS.SURFACE,
    borderRadius: scaleUxToDp(20),
    borderWidth: scaleUxToDp(6),
    borderColor: COLORS.TRANSPARENT,
    padding: scaleUxToDp(28),
  },
  tileFull: {
    width: scaleUxToDp(430),
    height: scaleUxToDp(340),
  },
  tileCompact: {
    width: scaleUxToDp(560),
    height: scaleUxToDp(174),
    marginBottom: scaleUxToDp(10),
    paddingVertical: scaleUxToDp(16),
  },
  tileDense: {
    width: scaleUxToDp(430),
    height: scaleUxToDp(190),
    marginBottom: 0,
  },
  tileSelected: {
    backgroundColor: COLORS.SURFACE_FOCUSED,
  },
  tileFocused: {
    borderColor: COLORS.TEXT,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: scaleUxToDp(14),
  },
  headCompact: {
    marginBottom: scaleUxToDp(4),
  },
  avatar: {
    width: scaleUxToDp(64),
    height: scaleUxToDp(64),
    borderRadius: scaleUxToDp(32),
    backgroundColor: COLORS.BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: scaleUxToDp(18),
  },
  avatarSelected: {
    backgroundColor: COLORS.ACCENT,
  },
  initial: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(34),
    fontWeight: '700',
  },
  initialSelected: {
    color: COLORS.BLACK,
  },
  name: {
    flex: 1,
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(40),
    fontWeight: '700',
  },
  box: {
    width: scaleUxToDp(44),
    height: scaleUxToDp(44),
    borderRadius: scaleUxToDp(10),
    borderWidth: scaleUxToDp(4),
    borderColor: COLORS.MUTED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxSelected: {
    borderColor: COLORS.ACCENT,
    backgroundColor: COLORS.ACCENT,
  },
  tick: {
    width: scaleUxToDp(22),
    height: scaleUxToDp(12),
    borderLeftWidth: scaleUxToDp(5),
    borderBottomWidth: scaleUxToDp(5),
    borderColor: COLORS.BLACK,
    transform: [{ rotate: '-45deg' }, { translateY: -scaleUxToDp(2) }],
  },
  lines: {
    flex: 1,
  },
  detail: {
    color: COLORS.MUTED,
    fontSize: scaleUxToDp(27),
    lineHeight: scaleUxToDp(36),
  },
  detailCompact: {
    fontSize: scaleUxToDp(24),
    lineHeight: scaleUxToDp(30),
  },
});

export default PersonTile;
