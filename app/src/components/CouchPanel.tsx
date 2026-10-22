import { Button } from '@amazon-devices/kepler-ui-components';
import { TVFocusGuideView } from '@amazon-devices/react-native-kepler';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../styles/palette';
import { scaleUxToDp } from '../utils/pixelUtils';
import CouchPicker from './CouchPicker';

export const COUCH_PANEL_Z_INDEX = 40;

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
      layout="column"
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
    width: scaleUxToDp(680),
    paddingTop: scaleUxToDp(60),
    paddingLeft: scaleUxToDp(50),
    backgroundColor: 'rgba(15, 20, 28, 0.96)',
    zIndex: COUCH_PANEL_Z_INDEX,
  },
  title: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(48),
    fontWeight: '700',
  },
  hint: {
    color: COLORS.MUTED,
    fontSize: scaleUxToDp(28),
    marginTop: scaleUxToDp(8),
    marginBottom: scaleUxToDp(24),
  },
  done: {
    alignSelf: 'flex-start',
    marginTop: scaleUxToDp(6),
  },
});

export default CouchPanel;
