import { TVFocusGuideView } from '@amazon-devices/react-native-kepler';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  layer,
  safe,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';
import Button from './Button';
import CouchPicker from './CouchPicker';

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
};

/** A side panel over the film: toggling someone applies at once while playback carries on. */
const CouchPanel = ({ selected, onToggle, onClose }: Props) => (
  <TVFocusGuideView
    style={styles.panel}
    trapFocusUp
    trapFocusDown
    trapFocusLeft
    trapFocusRight>
    <View accessible accessibilityRole="header">
      <Text style={styles.title}>Who's on the couch?</Text>
    </View>
    <Text style={styles.hint}>Changes apply right away.</Text>
    <CouchPicker
      selected={selected}
      onToggle={onToggle}
      layout="list"
      autoFocus
    />
    <View style={styles.done}>
      <Button
        label="Done"
        variant="primary"
        size="md"
        accessibilityLabel="Close the couch panel"
        onPress={onClose}
      />
    </View>
  </TVFocusGuideView>
);

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: size.panel,
    paddingTop: safe.y,
    paddingLeft: space.xl,
    paddingRight: safe.x,
    backgroundColor: colors.scrimStrong,
    borderLeftWidth: size.border,
    borderLeftColor: colors.line,
    zIndex: layer.panel,
  },
  title: {
    ...type.title,
    color: colors.text,
    fontWeight: weight.bold,
  },
  hint: {
    ...type.body,
    color: colors.textMuted,
    marginTop: space.xs,
    marginBottom: space.md,
  },
  done: {
    marginTop: space.xs,
    paddingLeft: space.xs,
  },
});

export default CouchPanel;
