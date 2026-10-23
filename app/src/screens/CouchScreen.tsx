import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Backdrop from '../components/Backdrop';
import Button from '../components/Button';
import CouchGrid from '../components/CouchGrid';
import Focusable from '../components/Focusable';
import { LensSettings } from '../engine/types';
import { useHousehold } from '../lens/household';
import { describeLens } from '../lens/lens';
import { colors, radius, safe, space, type, weight } from '../styles/tokens';

type Props = {
  selected: string[];
  lens: LensSettings;
  onToggle: (id: string) => void;
  onContinue: () => void;
  onAbout: () => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  /** The person whose card takes focus on arrival, such as the one just edited. */
  focusId?: string;
};

const summaryLine = (empty: boolean, active: string[]) => {
  if (empty) {
    return 'Or continue to the films without comfort settings.';
  }
  return active.length > 0
    ? `For this couch: ${active.join(' · ')}`
    : 'No comfort settings for this couch: films play as they are.';
};

const CouchScreen = ({
  selected,
  lens,
  onToggle,
  onContinue,
  onAbout,
  onAdd,
  onEdit,
  focusId,
}: Props) => {
  const empty = useHousehold().length === 0;
  const active = describeLens(lens);
  const continueRef = useRef<View>(null);
  const aboutRef = useRef<View>(null);
  return (
    <Backdrop>
      <View style={styles.layout}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Who's on the couch?
          </Text>
          <Focusable
            ref={aboutRef}
            accessible
            accessibilityRole="button"
            accessibilityLabel="About Every Seat and the not-a-medical-device notice"
            onPress={onAbout}
            radius={radius.sm}
            contentStyle={(focused) => [
              styles.aboutFill,
              focused && styles.aboutFillFocused,
            ]}>
            {(focused) => (
              <Text style={[styles.about, focused && styles.aboutFocused]}>
                About
              </Text>
            )}
          </Focusable>
        </View>
        <Text style={styles.hint}>
          {empty
            ? 'Add the people who watch here, with the comfort settings each of them likes.'
            : 'Choose everyone watching. The most protective setting of each kind applies to the whole couch.'}
        </Text>
        <CouchGrid
          selected={selected}
          onToggle={onToggle}
          onAdd={onAdd}
          onEdit={onEdit}
          above={aboutRef}
          below={continueRef}
          focusId={focusId}
        />
        <Text style={styles.summary} accessibilityLiveRegion="polite">
          {summaryLine(empty, active)}
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
        </View>
      </View>
    </Backdrop>
  );
};

const styles = StyleSheet.create({
  layout: {
    flex: 1,
    paddingHorizontal: safe.x,
    paddingTop: safe.top,
    paddingBottom: safe.y,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    marginBottom: space.lg,
  },
  summary: {
    ...type.body,
    color: colors.text,
    marginBottom: space.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aboutFill: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
  aboutFillFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  about: {
    ...type.small,
    color: colors.textMuted,
  },
  aboutFocused: {
    color: colors.text,
  },
});

export default CouchScreen;
