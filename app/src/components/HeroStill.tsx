import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ImageSourcePropType,
  StyleSheet,
  View,
} from 'react-native';
import { colors, motion, size } from '../styles/tokens';
import Gradient from './Gradient';

type Props = {
  source: ImageSourcePropType;
  /** Changes with the picture, so the previous one can fade out underneath. */
  id: string;
};

/**
 * The large picture behind the focused film. It bleeds off the top and right edges and fades into
 * the background on its left, bottom and top. A new picture fades in over the old one, slowly.
 */
const HeroStill = ({ source, id }: Props) => {
  const [shown, setShown] = useState({ id, source });
  const [previous, setPrevious] = useState<ImageSourcePropType | null>(null);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (id === shown.id) {
      return;
    }
    setPrevious(shown.source);
    setShown({ id, source });
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: motion.heroMs,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setPrevious(null);
      }
    });
  }, [id, source, shown, opacity]);

  return (
    <View pointerEvents="none" style={styles.frame}>
      {previous !== null && (
        <Animated.Image
          accessible={false}
          source={previous}
          style={styles.picture}
        />
      )}
      <Animated.Image
        accessible={false}
        source={shown.source}
        style={[styles.picture, { opacity }]}
      />
      <Gradient
        color={colors.background}
        from="left"
        style={styles.fadeLeft}
        steps={80}
      />
      <Gradient
        color={colors.background}
        from="bottom"
        style={styles.fadeBottom}
        steps={64}
      />
      <Gradient
        color={colors.background}
        from="top"
        style={styles.fadeTop}
        steps={40}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: size.heroW,
    height: size.heroH,
  },
  picture: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: size.heroW,
    height: size.heroH,
  },
  fadeLeft: {
    top: 0,
    bottom: 0,
    left: 0,
    width: size.heroFadeX,
  },
  fadeBottom: {
    left: 0,
    right: 0,
    bottom: 0,
    height: size.heroFadeY,
  },
  fadeTop: {
    left: 0,
    right: 0,
    top: 0,
    height: size.topFade,
  },
});

export default HeroStill;
