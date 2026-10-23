import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useHousehold } from '../lens/household';
import { colors, type } from '../styles/tokens';
import PersonTile from './PersonTile';

type Props = {
  selected: string[];
  onToggle: (id: string) => void;
  autoFocus?: boolean;
};

/** More rows than this and each person shows one line of settings. */
const ROOMY_LIST = 4;

/** The household as a column of rows for the side panel; the first row takes focus when `autoFocus` is set. */
const CouchPicker = ({ selected, onToggle, autoFocus }: Props) => {
  const household = useHousehold();
  if (household.length === 0) {
    return (
      <Text style={styles.empty}>
        Nobody is in the household yet. People are added on the couch screen.
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {household.map((person, i) => (
        <PersonTile
          key={person.id}
          person={person}
          selected={selected.includes(person.id)}
          onPress={() => onToggle(person.id)}
          lines={household.length <= ROOMY_LIST ? 2 : 1}
          autoFocus={autoFocus && i === 0}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  list: {
    alignSelf: 'stretch',
  },
  empty: {
    ...type.body,
    color: colors.textMuted,
  },
});

export default CouchPicker;
