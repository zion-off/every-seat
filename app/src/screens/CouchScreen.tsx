import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Backdrop from '../components/Backdrop';
import Button from '../components/Button';
import CouchPicker from '../components/CouchPicker';
import { LensSettings } from '../engine/types';
import { describeLens } from '../lens/lens';
import { colors, safe, space, type, weight } from '../styles/tokens';

type Props = {
  selected: string[];
  lens: LensSettings;
  onToggle: (id: string) => void;
  onContinue: () => void;
  onAbout: () => void;
};

const CouchScreen = ({
  selected,
  lens,
  onToggle,
  onContinue,
  onAbout,
}: Props) => {
  const active = describeLens(lens);
  const continueRef = useRef<View>(null);
  return (
    <Backdrop>
      <View style={styles.layout}>
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
          layout="grid"
          below={continueRef}
          autoFocus
        />
        <Text style={styles.summary} accessibilityLiveRegion="polite">
          {active.length > 0
            ? `For this couch: ${active.join(' · ')}`
            : 'No comfort settings for this couch: films play as they are.'}
        </Text>
        <View style={styles.actions}>
          <Button
            ref={continueRef}
            label="Continue"
            variant="primary"
            size="lg"
            accessibilityLabel="Continue to the films"
            onPress={onContinue}
          />
          <View style={styles.gap} />
          <Button
            label="About"
            variant="secondary"
            size="lg"
            accessibilityLabel="About Every Seat and the not-a-medical-device notice"
            onPress={onAbout}
          />
        </View>
      </View>
    </Backdrop>
  );
};

const styles = StyleSheet.create({
  layout: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: safe.x,
    paddingVertical: safe.y,
  },
  title: {
    ...type.display,
    color: colors.text,
    fontWeight: weight.bold,
  },
  hint: {
    ...type.body,
    color: colors.textMuted,
    marginTop: space.xs,
    marginBottom: space.xl,
  },
  summary: {
    ...type.body,
    color: colors.text,
    marginTop: space.lg,
    marginBottom: space.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gap: {
    width: space.lg,
  },
});

export default CouchScreen;
