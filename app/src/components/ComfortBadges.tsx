import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { SenseController } from 'sensevtt';
import { useControllerState } from '../engine/useController';
import {
  colors,
  layer,
  radius,
  safe,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';

const BARS = 12;
/** The meter spans this many dB below full volume. */
const METER_RANGE_DB = 24;

const decibels = (gain: number): number =>
  gain > 0 ? Math.round(20 * Math.log10(gain)) : -METER_RANGE_DB;

/** Calls `announce` once each time `on` turns true. */
const useAnnounceOnRise = (on: boolean, text: string) => {
  const was = useRef(false);
  useEffect(() => {
    if (on && !was.current) {
      AccessibilityInfo.announceForAccessibility(text);
    }
    was.current = on;
  }, [on, text]);
};

type Props = {
  controller: SenseController;
};

/**
 * Shows what the TV is doing right now, so it can be seen with the sound off: a badge while a
 * flash is dimmed and a level meter while the volume is lowered.
 */
const ComfortBadges = ({ controller }: Props) => {
  const { flashDimming, ducking, volume } = useControllerState(controller);
  useAnnounceOnRise(flashDimming, 'Flash softened');
  useAnnounceOnRise(ducking, 'Sound lowered for a loud moment');

  const db = decibels(volume);
  const lit = Math.max(
    0,
    Math.min(BARS, Math.round(((METER_RANGE_DB + db) / METER_RANGE_DB) * BARS)),
  );

  return (
    <View style={styles.root} pointerEvents="none">
      {flashDimming && (
        <View
          style={styles.badge}
          accessible
          accessibilityRole="text"
          accessibilityLabel="Flash softened">
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>Flash softened</Text>
        </View>
      )}
      {ducking && (
        <View
          style={styles.badge}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Sound lowered, ${Math.abs(db)} decibels`}
          accessibilityValue={{ min: 0, max: BARS, now: lit }}>
          <Text style={styles.badgeText}>Sound lowered</Text>
          <View style={styles.bars}>
            {Array.from({ length: BARS }, (_, i) => (
              <View
                key={i}
                style={[styles.bar, i < lit ? styles.barLit : styles.barDim]}
              />
            ))}
          </View>
          <Text style={styles.level}>{db} dB</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: safe.y,
    left: safe.x,
    zIndex: layer.card,
    alignItems: 'flex-start',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: size.pill,
    paddingHorizontal: space.md,
    marginBottom: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.scrimStrong,
    borderWidth: size.border,
    borderColor: colors.line,
  },
  badgeDot: {
    width: size.dot,
    height: size.dot,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    marginRight: space.xs,
  },
  badgeText: {
    ...type.small,
    color: colors.text,
    fontWeight: weight.bold,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: size.meterBar.height,
    marginHorizontal: space.sm,
  },
  bar: {
    width: size.meterBar.width,
    height: size.meterBar.height,
    marginRight: size.meterBar.gap,
    borderRadius: size.meterBar.width / 2,
  },
  barLit: {
    backgroundColor: colors.accent,
  },
  barDim: {
    backgroundColor: colors.line,
  },
  level: {
    ...type.small,
    color: colors.textMuted,
    minWidth: size.meterLevel,
  },
});

export default ComfortBadges;
