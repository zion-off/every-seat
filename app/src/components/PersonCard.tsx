import React, { RefObject, useCallback, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { describeLens } from '../lens/lens';
import { Person } from '../lens/people';
import {
  colors,
  focus,
  layer,
  radius,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';
import Avatar from './Avatar';
import Check from './Check';
import Focusable, { useFocusMotion } from './Focusable';

type Props = {
  person: Person;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  /** The card itself (Select puts the person on the couch) and its Edit control. */
  cardRef: RefObject<View>;
  editRef: RefObject<View>;
  autoFocus?: boolean;
  /** Space after the card, so a row keeps its gaps without leaving the container. */
  marginRight?: number;
};

type Zone = 'none' | 'card' | 'edit';

export const summary = (person: Person): string => {
  const parts = describeLens(person.settings);
  return parts.length > 0 ? parts.join(' · ') : 'No comfort settings';
};

/**
 * A person on the couch screen, as one card with two focusable zones: the card (Select puts the
 * person on the couch or takes them off) and a quiet "Edit" inside its lower right corner. The
 * whole card lifts while focus is anywhere in it; the amber outline shows which zone has it.
 */
const PersonCard = ({
  person,
  selected,
  onToggle,
  onEdit,
  cardRef,
  editRef,
  autoFocus,
  marginRight = 0,
}: Props) => {
  const [zone, setZone] = useState<Zone>('none');
  const zoneRef = useRef<Zone>('none');
  const lift = useFocusMotion(focus.scaleTile);
  const { onFocus: grow, onBlur: shrink } = lift;
  const enter = useCallback(
    (next: Zone) => {
      zoneRef.current = next;
      setZone(next);
      grow();
    },
    [grow],
  );
  // Moving from the card to its Edit blurs one zone and focuses the other; only a real exit shrinks.
  const leave = useCallback(
    (from: Zone) => {
      if (zoneRef.current !== from) {
        return;
      }
      zoneRef.current = 'none';
      setTimeout(() => {
        if (zoneRef.current === 'none') {
          setZone('none');
          shrink();
        }
      }, 0);
    },
    [shrink],
  );
  const within = zone !== 'none';
  return (
    <Animated.View
      style={[
        styles.frame,
        { marginRight },
        within && styles.raised,
        lift.grow,
      ]}>
      <Focusable
        ref={cardRef}
        accessible
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${person.name}. ${summary(person)}. ${
          selected ? 'On the couch' : 'Not on the couch'
        }. Press down to edit.`}
        hasTVPreferredFocus={autoFocus}
        onPress={onToggle}
        onFocus={() => enter('card')}
        onBlur={() => leave('card')}
        radius={radius.lg}
        scale={1}
        style={styles.card}
        contentStyle={[
          styles.surface,
          selected && styles.surfaceSelected,
          within && styles.surfaceFocused,
        ]}>
        <View style={styles.head}>
          <Avatar name={person.name} selected={selected} />
          <Text style={styles.name} numberOfLines={1}>
            {person.name}
          </Text>
          <Check on={selected} />
        </View>
        <Text style={styles.detail} numberOfLines={2}>
          {summary(person)}
        </Text>
      </Focusable>
      <View style={styles.editSlot}>
        <Focusable
          ref={editRef}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Edit ${person.name}'s name and comfort settings`}
          onPress={onEdit}
          onFocus={() => enter('edit')}
          onBlur={() => leave('edit')}
          radius={radius.pill}
          style={styles.edit}
          contentStyle={(focused) => [
            styles.editFill,
            focused && styles.editFillFocused,
          ]}>
          {(focused) => (
            <Text style={[styles.editText, focused && styles.editTextFocused]}>
              Edit
            </Text>
          )}
        </Focusable>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  frame: {
    width: size.tileW,
    height: size.personH,
    marginBottom: space.lg,
  },
  raised: {
    zIndex: layer.raised,
    elevation: layer.raised,
  },
  card: {
    width: size.tileW,
    height: size.personH,
  },
  surface: {
    padding: space.md,
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
    marginBottom: space.xs,
  },
  name: {
    ...type.title,
    flex: 1,
    marginHorizontal: space.sm,
    color: colors.text,
    fontWeight: weight.bold,
  },
  detail: {
    ...type.small,
    color: colors.textMuted,
  },
  // Above the card's own surface, so the card's focus layer never covers it.
  editSlot: {
    position: 'absolute',
    right: space.xs,
    bottom: space.xs,
    zIndex: layer.raised + 1,
    elevation: layer.raised + 1,
  },
  edit: {
    height: size.pill,
  },
  editFill: {
    height: size.pill,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderWidth: size.border,
    borderColor: colors.line,
  },
  editFillFocused: {
    backgroundColor: colors.line,
  },
  editText: {
    ...type.small,
    color: colors.textMuted,
    fontWeight: weight.bold,
  },
  editTextFocused: {
    color: colors.text,
  },
});

export default PersonCard;
