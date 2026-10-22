import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { COLORS } from '../styles/palette';

type Props = {
  opacity: Animated.Value;
};

/**
 * Black layer over the video that the engine fades natively. Anything that must stay undimmed
 * needs a higher zIndex than `DIM_Z_INDEX`.
 */
export const DIM_Z_INDEX = 10;

const DimOverlay = ({ opacity }: Props) => (
  <Animated.View pointerEvents="none" style={[styles.overlay, { opacity }]} />
);

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.BLACK,
    zIndex: DIM_Z_INDEX,
  },
});

export default DimOverlay;
