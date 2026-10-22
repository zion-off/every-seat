import { Button } from '@amazon-devices/kepler-ui-components';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import CouchPicker from '../components/CouchPicker';
import { LensSettings } from '../engine/types';
import { describeLens } from '../lens/lens';
import { COLORS } from '../styles/palette';
import { scaleUxToDp } from '../utils/pixelUtils';

type Props = {
  selected: string[];
  lens: LensSettings;
  onToggle: (id: string) => void;
  onContinue: () => void;
};

const CouchScreen = ({ selected, lens, onToggle, onContinue }: Props) => {
  const active = describeLens(lens);
  return (
    <View style={styles.root}>
      <Text style={styles.title} accessibilityRole="header">
        Who's on the couch?
      </Text>
      <Text style={styles.hint}>
        Choose everyone watching. The most protective setting of each kind
        applies to the whole couch.
      </Text>
      <CouchPicker
        selected={selected}
        onToggle={onToggle}
        layout="row"
        autoFocus
      />
      <Text style={styles.summary} accessibilityLiveRegion="polite">
        {active.length > 0
          ? `For this couch: ${active.join(' · ')}`
          : 'No comfort settings for this couch: films play as they are.'}
      </Text>
      <Button
        label="Continue"
        variant="primary"
        size="lg"
        accessibilityLabel="Continue to the films"
        onPress={onContinue}
      />
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
  title: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(72),
    fontWeight: '700',
    marginBottom: scaleUxToDp(16),
  },
  hint: {
    color: COLORS.MUTED,
    fontSize: scaleUxToDp(32),
    marginBottom: scaleUxToDp(56),
  },
  summary: {
    color: COLORS.ACCENT,
    fontSize: scaleUxToDp(34),
    marginTop: scaleUxToDp(48),
    marginBottom: scaleUxToDp(40),
  },
});

export default CouchScreen;
