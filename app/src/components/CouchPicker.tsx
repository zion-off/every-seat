import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useHousehold } from '../lens/household';
import { scaleUxToDp } from '../utils/pixelUtils';
import PersonTile from './PersonTile';

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  layout: 'row' | 'column';
  autoFocus?: boolean;
};

/** Multi-select over the household; the first tile takes focus when `autoFocus` is set. */
const CouchPicker = ({ selected, onToggle, layout, autoFocus }: Props) => {
  const household = useHousehold();
  const dense = layout === 'row' && household.length > 4;
  return (
    <View style={layout === 'row' ? styles.row : styles.column}>
      {household.map((person, i) => (
        <View
          key={person.id}
          style={layout === 'row' ? styles.cell : undefined}>
          <PersonTile
            person={person}
            selected={selected.includes(person.id)}
            onPress={() => onToggle(person.id)}
            compact={layout === 'column'}
            dense={dense}
            autoFocus={autoFocus && i === 0}
          />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  // Names the companion adds make more tiles than fit on one line, so the row wraps.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  cell: {
    marginHorizontal: scaleUxToDp(12),
    marginBottom: scaleUxToDp(20),
  },
  column: {
    alignItems: 'flex-start',
  },
});

export default CouchPicker;
