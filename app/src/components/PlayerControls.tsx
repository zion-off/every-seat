import { SeekBar, SeekBarHandle } from '@amazon-devices/kepler-ui-components';
import { useTVEventHandler } from '@amazon-devices/react-native-kepler';
import React, { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Cue, SenseController, VegaAdapter } from 'sensevtt';
import { formatClock } from '../catalog';
import { LensSettings } from '../engine/types';
import { buildHeatmap } from '../lens/heatmap';
import { Person } from '../lens/people';
import {
  colors,
  heat,
  layer,
  radius,
  safe,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';
import Avatar from './Avatar';
import Focusable from './Focusable';

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
  /** Who is on the couch, shown as a row of initials. */
  people: Person[];
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
  people,
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
      <View style={styles.panel}>
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
          barTrackColor={colors.line}
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
                    heatmap.count > 0 ? heat[2].base : colors.textMuted,
                },
              ]}
            />
            <Text style={styles.legendText}>{momentsLabel(heatmap.count)}</Text>
          </View>
          <Focusable
            ref={chipRef}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`On the couch: ${couchLabel}. Press to change.`}
            onPress={onOpenCouch}
            radius={radius.md}
            style={styles.chip}
            contentStyle={(focused) => [
              styles.couch,
              focused && styles.couchFocused,
            ]}>
            {people.length === 0 && (
              <Text style={styles.couchLabel}>Nobody on the couch yet</Text>
            )}
            {people.map((person) => (
              <View key={person.id} style={styles.person}>
                <Avatar name={person.name} muted small />
              </View>
            ))}
          </Focusable>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: safe.x,
    right: safe.x,
    bottom: safe.y,
    zIndex: layer.controls,
  },
  panel: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.scrimStrong,
    borderWidth: size.border,
    borderColor: colors.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: space.xs,
  },
  name: {
    ...type.title,
    flex: 1,
    color: colors.text,
    fontWeight: weight.bold,
  },
  time: {
    ...type.body,
    color: colors.textMuted,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: size.dot,
    height: size.dot,
    borderRadius: radius.pill,
    marginRight: space.xs,
  },
  legendText: {
    ...type.body,
    color: colors.textMuted,
  },
  chip: {
    maxWidth: size.chip,
  },
  couch: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  couchFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  couchLabel: {
    ...type.small,
    color: colors.textMuted,
  },
  person: {
    marginLeft: space.xs,
  },
});

export default PlayerControls;
