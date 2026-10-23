import React from 'react';
import { StyleSheet, View } from 'react-native';

type Edge = 'top' | 'bottom' | 'left' | 'right';

type Props = {
  color: string;
  /** The edge where the colour is solid; it fades out towards the opposite edge. */
  from: Edge;
  /** Absolute placement and size of the fade. */
  style: object;
  steps?: number;
};

const DEFAULT_STEPS = 24;
const EASE = 1.6;

/** A fade built from stacked strips, since there is no gradient view on the platform. */
const Gradient = ({ color, from, style, steps = DEFAULT_STEPS }: Props) => {
  const horizontal = from === 'left' || from === 'right';
  const solidFirst = from === 'top' || from === 'left';
  return (
    <View
      pointerEvents="none"
      style={[styles.fade, style, horizontal ? styles.row : styles.column]}>
      {Array.from({ length: steps }, (_, i) => {
        const t = (i + 0.5) / steps;
        const opacity = Math.pow(solidFirst ? 1 - t : t, EASE);
        return (
          <View
            key={i}
            style={[styles.strip, { backgroundColor: color, opacity }]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
  },
  row: {
    flexDirection: 'row',
  },
  column: {
    flexDirection: 'column',
  },
  strip: {
    flex: 1,
  },
});

export default Gradient;
