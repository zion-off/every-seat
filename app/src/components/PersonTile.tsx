import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Person } from '../lens/people';
import {
  colors,
  focus,
  radius,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';
import Avatar from './Avatar';
import Check from './Check';
import Focusable from './Focusable';
import { summary } from './PersonCard';

type Props = {
  person: Person;
  selected: boolean;
  onPress: () => void;
  /** Lines of settings text; the full text is always in the spoken label. */
  lines?: number;
  autoFocus?: boolean;
};

/** A person as a slim row in the side panel over the film. */
const PersonTile = ({
  person,
  selected,
  onPress,
  lines = 2,
  autoFocus,
}: Props) => (
  <Focusable
    accessible
    accessibilityRole="checkbox"
    accessibilityState={{ checked: selected }}
    accessibilityLabel={`${person.name}. ${summary(person)}. ${
      selected ? 'On the couch' : 'Not on the couch'
    }`}
    hasTVPreferredFocus={autoFocus}
    onPress={onPress}
    radius={radius.md}
    scale={focus.scaleControl}
    style={styles.row}
    contentStyle={(focused) => [
      styles.surface,
      selected && styles.surfaceSelected,
      focused && styles.surfaceFocused,
    ]}>
    <View style={styles.head}>
      <Avatar name={person.name} selected={selected} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.detail} numberOfLines={lines}>
          {summary(person)}
        </Text>
      </View>
      <Check on={selected} />
    </View>
  </Focusable>
);

const styles = StyleSheet.create({
  row: {
    alignSelf: 'stretch',
    marginBottom: space.sm,
  },
  surface: {
    padding: space.sm,
    backgroundColor: colors.surface,
    borderWidth: size.border,
    borderColor: colors.line,
  },
  surfaceSelected: {
    backgroundColor: colors.surfaceRaised,
  },
  surfaceFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    flex: 1,
    marginHorizontal: space.sm,
  },
  name: {
    ...type.title,
    color: colors.text,
    fontWeight: weight.bold,
  },
  detail: {
    ...type.small,
    color: colors.textMuted,
  },
});

export default PersonTile;
