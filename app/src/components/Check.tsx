import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, size } from '../styles/tokens';

/** The round check on a person: an empty ring, or filled amber with a tick when they are on the couch. */
const Check = ({ on }: { on: boolean }) => (
  <View accessible={false} style={[styles.box, on && styles.boxOn]}>
    {on && <View style={styles.tick} />}
  </View>
);

const styles = StyleSheet.create({
  box: {
    width: size.check,
    height: size.check,
    borderRadius: radius.pill,
    borderWidth: size.border * 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: {
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

export default Check;
