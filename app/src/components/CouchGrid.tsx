import React, { createRef, RefObject, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useHousehold } from '../lens/household';
import { MAX_PEOPLE } from '../lens/people';
import { size, space } from '../styles/tokens';
import { Route, useFocusRoutes } from '../utils/focusRoutes';
import AddPersonTile from './AddPersonTile';
import PersonCard from './PersonCard';

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  /** Up from the first row (the About link). */
  above: RefObject<View>;
  /** Down from the last row (Continue). */
  below: RefObject<View>;
  /** The person whose card takes focus on arrival; the first card when unset or gone. */
  focusId?: string;
};

type Refs = { card: RefObject<View>; edit: RefObject<View> };

const COLUMNS = size.columns;

/**
 * The household as a grid of four columns, with the "Add person" card last. Up to seven people and
 * the add card make two rows that fit inside the safe area.
 *
 * Focus: arrows move between cards; Down on a card reaches its Edit, and Down again the card below
 * (or Continue). Up from a card reaches the Edit above it; Up or Left from an Edit returns to its card;
 * Right from an Edit goes to the next card.
 */
const CouchGrid = ({
  selected,
  onToggle,
  onAdd,
  onEdit,
  above,
  below,
  focusId,
}: Props) => {
  const household = useHousehold();
  const refsById = useRef(new Map<string, Refs>()).current;
  const addRef = useRef<View>(null);
  const refsFor = (id: string): Refs => {
    let refs = refsById.get(id);
    if (!refs) {
      refs = { card: createRef<View>(), edit: createRef<View>() };
      refsById.set(id, refs);
    }
    return refs;
  };

  const canAdd = household.length < MAX_PEOPLE;
  const people = household.map((p) => refsFor(p.id));
  // Every card in reading order; the add card has no Edit.
  const tiles: RefObject<View>[] = [
    ...people.map((r) => r.card),
    ...(canAdd ? [addRef] : []),
  ];
  const count = tiles.length;
  const lastRowStart = count - (count % COLUMNS || COLUMNS);
  const focusIndex = Math.max(
    0,
    household.findIndex((p) => p.id === focusId),
  );

  useFocusRoutes(() => {
    const routes: Route[] = [];
    tiles.forEach((tile, i) => {
      if (i < COLUMNS) {
        routes.push({ from: tile, to: above, direction: 'up' });
      } else {
        const over = people[i - COLUMNS];
        routes.push({ from: tile, to: over.edit, direction: 'up' });
      }
    });
    // The add card is always last, so always on the bottom row.
    if (canAdd) {
      routes.push({ from: addRef, to: below, direction: 'down' });
    }
    people.forEach(({ card, edit }, i) => {
      routes.push({ from: card, to: edit, direction: 'down' });
      routes.push({ from: edit, to: card, direction: 'up' });
      routes.push({ from: edit, to: card, direction: 'left' });
      const sameRowNext = i + 1 < count && (i + 1) % COLUMNS !== 0;
      if (sameRowNext) {
        routes.push({ from: edit, to: tiles[i + 1], direction: 'right' });
      }
      let down: RefObject<View> = below;
      if (i + COLUMNS < count) {
        down = tiles[i + COLUMNS];
      } else if (i < lastRowStart) {
        down = tiles[count - 1];
      }
      routes.push({ from: edit, to: down, direction: 'down' });
    });
    return routes;
  }, `${household.map((p) => p.id).join('|')}:${canAdd}`);

  const gap = (i: number) => (i % COLUMNS === COLUMNS - 1 ? 0 : space.lg);
  return (
    <View style={styles.grid}>
      {household.map((person, i) => {
        const refs = refsFor(person.id);
        return (
          <PersonCard
            key={person.id}
            person={person}
            selected={selected.includes(person.id)}
            onToggle={() => onToggle(person.id)}
            onEdit={() => onEdit(person.id)}
            cardRef={refs.card}
            editRef={refs.edit}
            autoFocus={i === focusIndex}
            marginRight={gap(i)}
          />
        );
      })}
      {canAdd && (
        <AddPersonTile
          ref={addRef}
          onPress={onAdd}
          autoFocus={household.length === 0}
          first={household.length === 0}
          marginRight={gap(household.length)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
});

export default CouchGrid;
