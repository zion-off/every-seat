import React from 'react';
import { StyleSheet, View } from 'react-native';
import { PEOPLE } from '../lens/people';
import { scaleUxToDp } from '../utils/pixelUtils';
import PersonTile from './PersonTile';

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  layout: 'row' | 'column';
  autoFocus?: boolean;
};

/** Multi-select over the household; the first tile takes focus when `autoFocus` is set. */
const CouchPicker = ({ selected, onToggle, layout, autoFocus }: Props) => (
  <View style={layout === 'row' ? styles.row : styles.column}>
    {PEOPLE.map((person, i) => (
      <View key={person.id} style={layout === 'row' ? styles.cell : undefined}>
        <PersonTile
          person={person}
          selected={selected.includes(person.id)}
          onPress={() => onToggle(person.id)}
          compact={layout === 'column'}
          autoFocus={autoFocus && i === 0}
        />
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  cell: {
    marginHorizontal: scaleUxToDp(12),
  },
  column: {
    alignItems: 'flex-start',
  },
});

export default CouchPicker;
