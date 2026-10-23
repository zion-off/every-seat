import React, { RefObject } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useHousehold } from '../lens/household';
import { MAX_PEOPLE } from '../lens/people';
import { colors, size, space, type } from '../styles/tokens';
import AddPersonTile from './AddPersonTile';
import EditControl from './EditControl';
import PersonTile from './PersonTile';

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  /** A grid of cards for the couch screen, or a column of rows for the side panel. */
  layout: 'grid' | 'list';
  autoFocus?: boolean;
  /** Where Down leads from the last row of the grid; without it, the nearest control below. */
  below?: RefObject<View>;
  /** Grid only: adds the "Add person" tile and an "Edit" control under each person. */
  onAdd?: () => void;
  onEdit?: (id: string) => void;
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
  onAdd,
  onEdit,
}: Props) => {
  const household = useHousehold();
  const grid = layout === 'grid';
  const canAdd = grid && onAdd !== undefined && household.length < MAX_PEOPLE;
  const count = household.length + (canAdd ? 1 : 0);
  const lastRow = count - (count % size.columns || size.columns);
  const gap = (i: number) =>
    grid && i % size.columns !== size.columns - 1 ? space.lg : 0;
  const editable = grid && onEdit !== undefined;
  if (household.length === 0 && !grid) {
    return (
      <Text style={styles.empty}>
        Nobody is in the household yet. People are added on the couch screen.
      </Text>
    );
  }
  return (
    <View style={grid ? styles.grid : styles.list}>
      {household.map((person, i) => {
        const tile = (
          <PersonTile
            key={person.id}
            person={person}
            selected={selected.includes(person.id)}
            onPress={() => onToggle(person.id)}
            variant={grid ? 'card' : 'row'}
            lines={grid || household.length <= ROOMY_LIST ? 2 : 1}
            marginRight={editable ? 0 : gap(i)}
            autoFocus={autoFocus && i === 0}
            downTo={!editable && grid && i >= lastRow ? below : undefined}
          />
        );
        if (!editable) {
          return tile;
        }
        return (
          <View key={person.id} style={{ marginRight: gap(i) }}>
            {tile}
            <EditControl
              name={person.name}
              onPress={() => onEdit(person.id)}
              downTo={i >= lastRow ? below : undefined}
            />
          </View>
        );
      })}
      {canAdd && (
        <View style={{ marginRight: gap(household.length) }}>
          <AddPersonTile
            onPress={onAdd}
            autoFocus={autoFocus && household.length === 0}
            downTo={household.length >= lastRow ? below : undefined}
          />
        </View>
      )}
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
  empty: {
    ...type.body,
    color: colors.textMuted,
  },
});

export default CouchPicker;
