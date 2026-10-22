import { Button } from '@amazon-devices/kepler-ui-components';
import { FocusManager } from '@amazon-devices/react-native-kepler';
import React, { useEffect, useRef } from 'react';
import { findNodeHandle, StyleSheet, Text, View } from 'react-native';
import { HOW_IT_WORKS, NOTICE_POINTS, NOTICE_TITLE } from '../notice';
import { COLORS } from '../styles/palette';
import { scaleUxToDp } from '../utils/pixelUtils';

type Props = {
  /** The first-run notice must be accepted; About can also be left with Back. */
  mode: 'first-run' | 'about';
  onDone: () => void;
};

const NoticeScreen = ({ mode, onDone }: Props) => {
  const about = mode === 'about';
  const buttonRef = useRef<View>(null);

  // KUIC's Button has no preferred-focus prop, so focus it once the screen has laid out.
  useEffect(() => {
    const timer = setTimeout(() => {
      const tag = buttonRef.current && findNodeHandle(buttonRef.current);
      if (tag) {
        FocusManager.focus(tag);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.column}>
        <Text style={styles.title} accessibilityRole="header">
          {about ? 'About Every Seat' : 'Before you start'}
        </Text>
        {about && <Text style={styles.body}>{HOW_IT_WORKS}</Text>}
        <Text style={styles.heading} accessibilityRole="header">
          {NOTICE_TITLE}
        </Text>
        {NOTICE_POINTS.map((point) => (
          <Text key={point} style={styles.body}>
            {point}
          </Text>
        ))}
        <View style={styles.action}>
          <Button
            ref={buttonRef}
            label={about ? 'Back' : 'Got it'}
            variant="primary"
            size="lg"
            accessibilityLabel={
              about ? 'Back to who is on the couch' : 'Got it, continue'
            }
            onPress={onDone}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  column: {
    width: scaleUxToDp(1400),
  },
  title: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(64),
    fontWeight: '700',
    marginBottom: scaleUxToDp(28),
  },
  heading: {
    color: COLORS.ACCENT,
    fontSize: scaleUxToDp(42),
    fontWeight: '700',
    marginBottom: scaleUxToDp(20),
  },
  body: {
    color: COLORS.MUTED,
    fontSize: scaleUxToDp(34),
    lineHeight: scaleUxToDp(48),
    marginBottom: scaleUxToDp(20),
  },
  action: {
    marginTop: scaleUxToDp(28),
    alignSelf: 'flex-start',
  },
});

export default NoticeScreen;
