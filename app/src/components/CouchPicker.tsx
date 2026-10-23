import React, { RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { useHousehold } from '../lens/household';
import { size, space } from '../styles/tokens';
import PersonTile from './PersonTile';

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  /** A grid of cards for the couch screen, or a column of rows for the side panel. */
  layout: 'grid' | 'list';
  autoFocus?: boolean;
  /** Where Down leads from the last row of the grid; without it, the nearest control below. */
  below?: RefObject<View>;
};

/** More rows than this and the side panel shows one line of settings per person. */
const ROOMY_LIST = 4;

/** Multi-select over the household; the first tile takes focus when `autoFocus` is set. */
const CouchPicker = ({
  selected,
  onToggle,
  layout,
  autoFocus,
  below,
}: Props) => {
  const household = useHousehold();
  const grid = layout === 'grid';
  const lastRow =
    household.length - (household.length % size.columns || size.columns);
  return (
    <View style={grid ? styles.grid : styles.list}>
      {household.map((person, i) => (
        <PersonTile
          key={person.id}
          person={person}
          selected={selected.includes(person.id)}
          onPress={() => onToggle(person.id)}
          variant={grid ? 'card' : 'row'}
          lines={grid || household.length <= ROOMY_LIST ? 2 : 1}
          marginRight={
            grid && i % size.columns !== size.columns - 1 ? space.lg : 0
          }
          autoFocus={autoFocus && i === 0}
          downTo={grid && i >= lastRow ? below : undefined}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  // Names the companion adds make more tiles than fit on one line, so the grid wraps.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  list: {
    alignSelf: 'stretch',
  },
});

export default CouchPicker;
