import {
  Button as KuicButton,
  ButtonProps,
} from '@amazon-devices/kepler-ui-components';
import React, { forwardRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { focus, layer, radius } from '../styles/tokens';
import { FocusRing, useFocusMotion } from './Focusable';

/** The KUIC button, themed from the tokens and drawn with the shared focus outline and glow. */
const Button = forwardRef<View, ButtonProps>(
  ({ onFocus, onBlur, ...rest }, ref) => {
    const motionState = useFocusMotion(focus.scaleControl);
    return (
      <Animated.View
        style={[
          styles.frame,
          motionState.focused && styles.raised,
          motionState.grow,
        ]}>
        <FocusRing progress={motionState.progress} radius={radius.md} />
        <KuicButton
          ref={ref}
          {...rest}
          onFocus={() => {
            motionState.onFocus();
            onFocus?.();
          }}
          onBlur={() => {
            motionState.onBlur();
            onBlur?.();
          }}
        />
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'flex-start',
  },
  raised: {
    zIndex: layer.raised,
    elevation: layer.raised,
  },
});

export default Button;
