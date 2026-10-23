import { FocusManager } from '@amazon-devices/react-native-kepler';
import React, { useEffect, useRef } from 'react';
import { findNodeHandle, StyleSheet, Text, View } from 'react-native';
import Backdrop from '../components/Backdrop';
import Button from '../components/Button';
import {
  ABOUT_DISCLAIMER,
  ABOUT_SUMMARY,
  NOTICE_POINTS,
  NOTICE_TITLE,
} from '../notice';
import { colors, safe, size, space, type, weight } from '../styles/tokens';

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
    <Backdrop>
      <View style={styles.layout}>
        <View style={styles.column}>
          <Text style={styles.title} accessibilityRole="header">
            {about ? 'About Every Seat' : 'Before you start'}
          </Text>
          {about ? (
            <>
              <Text style={styles.lead}>{ABOUT_SUMMARY}</Text>
              <Text style={styles.note}>{ABOUT_DISCLAIMER}</Text>
            </>
          ) : (
            <>
              <Text style={styles.heading} accessibilityRole="header">
                {NOTICE_TITLE}
              </Text>
              {NOTICE_POINTS.map((point) => (
                <Text key={point} style={styles.note}>
                  {point}
                </Text>
              ))}
            </>
          )}
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
    </Backdrop>
  );
};

const styles = StyleSheet.create({
  layout: {
    flex: 1,
    paddingHorizontal: safe.x,
    paddingTop: safe.y + space.xxl + space.xl,
    paddingBottom: safe.y,
  },
  column: {
    width: size.readable,
  },
  title: {
    ...type.display,
    color: colors.text,
    fontWeight: weight.bold,
    marginBottom: space.md,
  },
  lead: {
    ...type.body,
    color: colors.text,
    marginBottom: space.md,
  },
  heading: {
    ...type.title,
    color: colors.text,
    fontWeight: weight.bold,
    marginBottom: space.sm,
  },
  note: {
    ...type.small,
    color: colors.textMuted,
    marginBottom: space.sm,
  },
  action: {
    marginTop: space.xl,
  },
});

export default NoticeScreen;
