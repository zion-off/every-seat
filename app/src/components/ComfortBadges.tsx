import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { SenseController } from 'react-native-sensevtt';
import { useControllerState } from '../engine/useController';
import { COLORS } from '../styles/palette';
import { scaleUxToDp } from '../utils/pixelUtils';
import { CARD_Z_INDEX } from './HeadsUpCard';

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
    top: scaleUxToDp(48),
    left: scaleUxToDp(80),
    zIndex: CARD_Z_INDEX,
    alignItems: 'flex-start',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleUxToDp(14),
    paddingHorizontal: scaleUxToDp(26),
    marginBottom: scaleUxToDp(14),
    borderRadius: scaleUxToDp(18),
    backgroundColor: 'rgba(15, 20, 28, 0.92)',
    borderWidth: scaleUxToDp(3),
    borderColor: COLORS.ACCENT,
  },
  badgeDot: {
    width: scaleUxToDp(18),
    height: scaleUxToDp(18),
    borderRadius: scaleUxToDp(9),
    backgroundColor: COLORS.ACCENT,
    marginRight: scaleUxToDp(14),
  },
  badgeText: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(32),
    fontWeight: '700',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: scaleUxToDp(36),
    marginHorizontal: scaleUxToDp(20),
  },
  bar: {
    width: scaleUxToDp(10),
    height: scaleUxToDp(36),
    marginRight: scaleUxToDp(5),
    borderRadius: scaleUxToDp(3),
  },
  barLit: {
    backgroundColor: COLORS.ACCENT,
  },
  barDim: {
    backgroundColor: COLORS.TRACK,
  },
  level: {
    color: COLORS.MUTED,
    fontSize: scaleUxToDp(30),
    minWidth: scaleUxToDp(90),
  },
});

export default ComfortBadges;
