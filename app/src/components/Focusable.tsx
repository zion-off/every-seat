import React, {
  forwardRef,
  ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { colors, focus, motion, radius as radii } from '../styles/tokens';

/** Drives the focus animation: one 0..1 value on the native driver, plus the plain focused flag. */
export const useFocusMotion = (scale: number) => {
  const progress = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);

  const move = useCallback(
    (to: number) => {
      Animated.timing(progress, {
        toValue: to,
        duration: motion.focusMs,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    },
    [progress],
  );

  const onFocus = useCallback(() => {
    setFocused(true);
    move(1);
  }, [move]);
  const onBlur = useCallback(() => {
    setFocused(false);
    move(0);
  }, [move]);

  const grow = {
    transform: [
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, scale],
        }),
      },
    ],
  };
  return { focused, progress, onFocus, onBlur, grow };
};

type RingProps = {
  progress: Animated.Value;
  radius: number;
};

const HALO_LAYERS = [1, 5 / 6, 4 / 6, 3 / 6, 2 / 6, 1 / 6];

/** The amber outline and the soft glow behind it; they fade in with focus and never affect layout. */
export const FocusRing = ({ progress, radius }: RingProps) => {
  const edge = focus.ringOffset + focus.ringWidth;
  return (
    <>
      {HALO_LAYERS.map((share) => (
        <Animated.View
          key={share}
          pointerEvents="none"
          style={[
            styles.layer,
            {
              top: -focus.haloSpread * share - edge,
              left: -focus.haloSpread * share - edge,
              right: -focus.haloSpread * share - edge,
              bottom: -focus.haloSpread * share - edge,
              borderRadius: radius + edge + focus.haloSpread * share,
              backgroundColor: colors.glow,
              opacity: progress,
            },
          ]}
        />
      ))}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.layer,
          {
            top: -edge,
            left: -edge,
            right: -edge,
            bottom: -edge,
            borderRadius: radius + edge,
            borderWidth: focus.ringWidth,
            borderColor: colors.accent,
            opacity: progress,
          },
        ]}
      />
    </>
  );
};

type Props = Omit<PressableProps, 'style' | 'children'> & {
  /** Size and margins of the visible box. */
  style?: StyleProp<ViewStyle>;
  /** Fill, padding and clipping of the visible box; may depend on focus. */
  contentStyle?:
    | StyleProp<ViewStyle>
    | ((focused: boolean) => StyleProp<ViewStyle>);
  radius?: number;
  scale?: number;
  children: ReactNode | ((focused: boolean) => ReactNode);
};

/** A pressable that grows and gains the amber outline and glow while it holds focus. */
const Focusable = forwardRef<View, Props>(
  (
    {
      style,
      contentStyle,
      radius = radii.md,
      scale = focus.scaleControl,
      onFocus,
      onBlur,
      children,
      ...rest
    },
    ref,
  ) => {
    const motionState = useFocusMotion(scale);
    return (
      <Pressable
        ref={ref}
        {...rest}
        onFocus={(e) => {
          motionState.onFocus();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          motionState.onBlur();
          onBlur?.(e);
        }}
        style={motionState.focused ? styles.raised : undefined}>
        <Animated.View style={[style, motionState.grow]}>
          <FocusRing progress={motionState.progress} radius={radius} />
          <View
            style={[
              styles.content,
              { borderRadius: radius },
              typeof contentStyle === 'function'
                ? contentStyle(motionState.focused)
                : contentStyle,
            ]}>
            {typeof children === 'function'
              ? children(motionState.focused)
              : children}
          </View>
        </Animated.View>
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
  },
  raised: {
    zIndex: 1,
  },
  content: {
    flexGrow: 1,
  },
});

export default Focusable;
