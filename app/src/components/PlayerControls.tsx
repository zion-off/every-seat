import { SeekBar, SeekBarHandle } from '@amazon-devices/kepler-ui-components';
import { useTVEventHandler } from '@amazon-devices/react-native-kepler';
import React, { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Cue, SenseController, VegaAdapter } from 'react-native-sensevtt';
import { formatClock } from '../catalog';
import { LensSettings } from '../engine/types';
import { buildHeatmap } from '../lens/heatmap';
import { COLORS, HEAT } from '../styles/palette';
import { scaleUxToDp } from '../utils/pixelUtils';

export const CONTROLS_Z_INDEX = 30;

const HIDE_AFTER_MS = 6000;
const SCRUB_CANCEL_MS = 4000;
const STEP_MS = 10000;
/** A thumb further than this from the playhead means the viewer is scrubbing. */
const SCRUB_THRESHOLD_MS = 1500;
const POSITION_TICK_MS = 1000;

type Props = {
  adapter: VegaAdapter;
  controller: SenseController;
  name: string;
  cues: Cue[];
  lens: LensSettings;
  couchLabel: string;
  durationMs: number;
  /** While true (a panel is open over the film) the controls stay on screen. */
  locked: boolean;
  chipRef?: RefObject<View>;
  onOpenCouch: () => void;
};

const momentsLabel = (n: number): string => {
  if (n === 0) {
    return 'Nothing marked for this couch';
  }
  return n === 1
    ? '1 moment marked for this couch'
    : `${n} moments marked for this couch`;
};

const PlayerControls = ({
  adapter,
  controller,
  name,
  cues,
  lens,
  couchLabel,
  durationMs,
  locked,
  chipRef,
  onOpenCouch,
}: Props) => {
  const seekRef = useRef<SeekBarHandle>(null);
  const opacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionRef = useRef(0);
  const scrubbingRef = useRef(false);
  const lockedRef = useRef(locked);
  const pausedRef = useRef(false);
  lockedRef.current = locked;

  const [positionMs, setPositionMs] = useState(0);
  const [thumbMs, setThumbMs] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [chipFocused, setChipFocused] = useState(false);

  const heatmap = useMemo(
    () => buildHeatmap(cues, lens, durationMs),
    [cues, lens, durationMs],
  );

  const scheduleHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      if (!scrubbingRef.current && !lockedRef.current && !pausedRef.current) {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start();
      } else {
        scheduleHide();
      }
    }, HIDE_AFTER_MS);
  };

  const show = () => {
    opacity.stopAnimation();
    Animated.timing(opacity, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
    scheduleHide();
  };

  useTVEventHandler(() => show());

  useEffect(() => {
    show();
    const tick = setInterval(() => {
      pausedRef.current = adapter.paused;
      if (!scrubbingRef.current) {
        const ms = Math.round(adapter.currentTime * 1000);
        positionRef.current = ms;
        setPositionMs(ms);
      }
    }, POSITION_TICK_MS);
    const off = adapter.addListener((n) => {
      if (n === 'play' || n === 'pause') {
        pausedRef.current = adapter.paused;
        show();
      }
    });
    return () => {
      clearInterval(tick);
      off();
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
      if (cancelTimer.current) {
        clearTimeout(cancelTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  // A new lens repaints the markers, so bring the bar up where the change can be seen.
  useEffect(() => {
    show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens]);

  const endScrub = () => {
    scrubbingRef.current = false;
    setScrubbing(false);
    if (cancelTimer.current) {
      clearTimeout(cancelTimer.current);
      cancelTimer.current = null;
    }
  };

  const onValueChange = (value: number) => {
    const away = Math.abs(value - positionRef.current) > SCRUB_THRESHOLD_MS;
    scrubbingRef.current = away;
    setScrubbing(away);
    setThumbMs(value);
    if (cancelTimer.current) {
      clearTimeout(cancelTimer.current);
      cancelTimer.current = null;
    }
    if (away) {
      cancelTimer.current = setTimeout(() => {
        endScrub();
        seekRef.current?.resetThumbValue(positionRef.current);
      }, SCRUB_CANCEL_MS);
    }
  };

  // A seek while paused does not repaint, so a committed seek always resumes playback.
  const activate = (thumb: number) => {
    show();
    if (scrubbingRef.current) {
      endScrub();
      positionRef.current = thumb;
      setPositionMs(thumb);
      controller.seek(thumb / 1000);
      adapter.play();
    } else if (adapter.paused) {
      adapter.play();
    } else {
      adapter.pause();
    }
  };

  const shownMs = scrubbing ? thumbMs : positionMs;

  return (
    <Animated.View style={[styles.root, { opacity }]} pointerEvents="box-none">
      <View style={styles.row}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.time} accessibilityLiveRegion="none">
          {scrubbing ? 'Jump to ' : ''}
          {formatClock(shownMs / 1000)} / {formatClock(durationMs / 1000)}
        </Text>
      </View>
      <SeekBar
        ref={seekRef}
        currentValue={positionMs}
        totalValue={Math.max(1, durationMs)}
        step={STEP_MS}
        markers={heatmap.markers}
        segmentColors={heatmap.segmentColors}
        barTrackColor={COLORS.TRACK}
        onValueChange={onValueChange}
        onPress={activate}
        onPlayPause={activate}
        disabledWhenNotFocused
        hasTVPreferredFocus
        accessibilityLabel={`Seek bar. ${formatClock(
          shownMs / 1000,
        )} of ${formatClock(durationMs / 1000)}. Left and right to jump`}
      />
      <View style={styles.row}>
        <View style={styles.legend}>
          <View
            style={[
              styles.dot,
              {
                backgroundColor:
                  heatmap.count > 0 ? HEAT[2].base : COLORS.TRACK_SEEK,
              },
            ]}
          />
          <Text style={styles.legendText}>{momentsLabel(heatmap.count)}</Text>
        </View>
        <Pressable
          ref={chipRef}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`On the couch: ${couchLabel}. Change who is on the couch`}
          onPress={onOpenCouch}
          onFocus={() => setChipFocused(true)}
          onBlur={() => setChipFocused(false)}
          style={[styles.chip, chipFocused && styles.chipFocused]}>
          <Text style={styles.chipText} numberOfLines={1}>
            Couch: {couchLabel}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: scaleUxToDp(80),
    paddingTop: scaleUxToDp(40),
    paddingBottom: scaleUxToDp(44),
    backgroundColor: 'rgba(10, 14, 20, 0.78)',
    zIndex: CONTROLS_Z_INDEX,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: scaleUxToDp(10),
  },
  name: {
    flex: 1,
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(36),
    fontWeight: '700',
  },
  time: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(32),
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: scaleUxToDp(20),
    height: scaleUxToDp(20),
    borderRadius: scaleUxToDp(10),
    marginRight: scaleUxToDp(14),
  },
  legendText: {
    color: COLORS.MUTED,
    fontSize: scaleUxToDp(30),
  },
  chip: {
    paddingVertical: scaleUxToDp(12),
    paddingHorizontal: scaleUxToDp(28),
    borderRadius: scaleUxToDp(14),
    borderWidth: scaleUxToDp(4),
    borderColor: COLORS.TRACK_SEEK,
    backgroundColor: COLORS.SURFACE,
    maxWidth: scaleUxToDp(760),
  },
  chipFocused: {
    borderColor: COLORS.TEXT,
    backgroundColor: COLORS.SURFACE_FOCUSED,
  },
  chipText: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(30),
    fontWeight: '600',
  },
});

export default PlayerControls;
