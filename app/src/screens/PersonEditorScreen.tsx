import { FocusManager } from '@amazon-devices/react-native-kepler';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  findNodeHandle,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Backdrop from '../components/Backdrop';
import Button from '../components/Button';
import Focusable, { FocusRing, useFocusMotion } from '../components/Focusable';
import { LensSettings, NO_LENS } from '../engine/types';
import { personId } from '../lens/household';
import { MAX_NAME, Person } from '../lens/people';
import {
  colors,
  focus,
  layer,
  radius,
  safe,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';
import { useDownTo, useFocusOnMount } from '../utils/focusRoutes';

type Props = {
  /** The person being edited; undefined adds someone new. */
  person?: Person;
  /** Everyone else, so a name is never used twice. */
  others: Person[];
  onSave: (person: Person) => void;
  onCancel: () => void;
  onDelete: () => void;
};

type Row = {
  key: keyof LensSettings;
  on: LensSettings[keyof LensSettings];
  label: string;
  line: string;
};

const ROWS: Row[] = [
  {
    key: 'flashes',
    on: 'soften',
    label: 'Flashes',
    line: 'Dim flashing images when they come up.',
  },
  {
    key: 'loud',
    on: 'cap',
    label: 'Loud sounds',
    line: 'Keep sudden loud sounds in check.',
  },
  {
    key: 'scares',
    on: 'headsup',
    label: 'Scares',
    line: 'Show a heads-up before a scary moment.',
  },
  {
    key: 'ad',
    on: 'on',
    label: 'Audio description',
    line: 'Hear what is on screen, played on the phone.',
  },
];

type ToggleProps = {
  row: Row;
  on: boolean;
  onPress: () => void;
  /** Down from the last toggle leads to Save, not to whichever button is nearest. */
  downTo?: React.RefObject<View>;
};

const Toggle = ({ row, on, onPress, downTo }: ToggleProps) => {
  const ref = useRef<View>(null);
  useDownTo(ref, downTo);
  return (
    <Focusable
      ref={ref}
      accessible
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${row.label}. ${row.line} ${on ? 'On' : 'Off'}`}
      onPress={onPress}
      radius={radius.md}
      style={styles.toggle}
      contentStyle={(focused) => [
        styles.toggleSurface,
        focused && styles.surfaceFocused,
      ]}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{row.label}</Text>
        <Text style={styles.toggleLine}>{row.line}</Text>
      </View>
      <Text style={[styles.state, on && styles.stateOn]}>
        {on ? 'On' : 'Off'}
      </Text>
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </Focusable>
  );
};

type NameFieldProps = {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<TextInput>;
};

/** A text field that wears the shared focus outline; Select opens the on-screen keyboard. */
const NameField = ({ value, onChange, onSubmit, inputRef }: NameFieldProps) => {
  const motion = useFocusMotion(focus.scaleControl);
  return (
    <Animated.View
      style={[styles.fieldFrame, motion.focused && styles.raised, motion.grow]}>
      <FocusRing progress={motion.progress} radius={radius.md} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        onFocus={motion.onFocus}
        onBlur={motion.onBlur}
        maxLength={MAX_NAME}
        placeholder="Name"
        placeholderTextColor={colors.textMuted}
        returnKeyType="done"
        autoCapitalize="words"
        autoCorrect={false}
        accessible
        accessibilityLabel="Name. Select to type a name."
        style={[styles.input, motion.focused && styles.inputFocused]}
      />
    </Animated.View>
  );
};

/** Removing someone asks once, calmly, with focus on the safe choice. */
const Confirm = ({
  name,
  onCancel,
  onRemove,
}: {
  name: string;
  onCancel: () => void;
  onRemove: () => void;
}) => {
  const cancelRef = useRef<View>(null);
  useFocusOnMount(cancelRef);
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {`Remove ${name}?`}
      </Text>
      <Text style={styles.lead}>
        {`${name} and their comfort settings leave the household. You can add them again any time.`}
      </Text>
      <View style={[styles.actions, styles.actionsConfirm]}>
        <Button
          ref={cancelRef}
          label="Cancel"
          variant="secondary"
          size="lg"
          accessibilityLabel={`Cancel and keep ${name}`}
          onPress={onCancel}
        />
        <View style={styles.actionGap} />
        <Button
          label="Remove"
          variant="secondary"
          size="lg"
          accessibilityLabel={`Remove ${name} from the household`}
          onPress={onRemove}
        />
      </View>
    </>
  );
};

const PersonEditorScreen = ({
  person,
  others,
  onSave,
  onCancel,
  onDelete,
}: Props) => {
  const [name, setName] = useState(person?.name ?? '');
  const [settings, setSettings] = useState<LensSettings>(
    person?.settings ?? NO_LENS,
  );
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const saveRef = useRef<View>(null);

  // Focus goes to the name when adding someone, and to Save when changing settings.
  useEffect(() => {
    const timer = setTimeout(() => {
      const target = person ? saveRef.current : inputRef.current;
      const tag = target && findNodeHandle(target);
      if (tag) {
        FocusManager.focus(tag);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [person]);

  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (confirmingRef.current) {
        setConfirming(false);
      } else {
        cancelRef.current();
      }
      return true;
    });
    return () => sub.remove();
  }, []);

  const save = () => {
    const trimmed = name.trim();
    let problem = '';
    if (trimmed === '') {
      problem = 'Type a name first.';
    } else if (others.some((p) => p.id === personId(trimmed))) {
      problem = `Someone is already called ${trimmed}.`;
    }
    setError(problem);
    if (problem) {
      AccessibilityInfo.announceForAccessibility(problem);
      return;
    }
    onSave({ id: personId(trimmed), name: trimmed, settings });
  };

  const flip = (row: Row) =>
    setSettings((prev) => ({
      ...prev,
      [row.key]: prev[row.key] === row.on ? 'off' : row.on,
    }));

  return (
    <Backdrop>
      <View style={styles.layout}>
        <View style={styles.column}>
          {confirming && person ? (
            <Confirm
              name={person.name}
              onCancel={() => setConfirming(false)}
              onRemove={onDelete}
            />
          ) : (
            <>
              <Text style={styles.title} accessibilityRole="header">
                {person ? `Edit ${person.name}` : 'Add a person'}
              </Text>
              <NameField
                value={name}
                onChange={(text) => {
                  setName(text);
                  setError('');
                }}
                onSubmit={() => undefined}
                inputRef={inputRef}
              />
              <Text
                style={[styles.hint, error !== '' && styles.error]}
                accessibilityLiveRegion="polite">
                {error ||
                  'Comfort settings for this person. Select one to switch it.'}
              </Text>
              {ROWS.map((row, i) => (
                <Toggle
                  key={row.key}
                  downTo={i === ROWS.length - 1 ? saveRef : undefined}
                  row={row}
                  on={settings[row.key] === row.on}
                  onPress={() => flip(row)}
                />
              ))}
              <View style={[styles.actions, styles.actionsTop]}>
                <Button
                  ref={saveRef}
                  label="Save"
                  variant="primary"
                  size="lg"
                  accessibilityLabel="Save"
                  onPress={save}
                />
                <View style={styles.actionGap} />
                <Button
                  label="Cancel"
                  variant="secondary"
                  size="lg"
                  accessibilityLabel="Cancel without saving"
                  onPress={onCancel}
                />
                {person && (
                  <>
                    <View style={styles.actionGap} />
                    <Button
                      label="Remove"
                      variant="secondary"
                      size="lg"
                      accessibilityLabel={`Remove ${person.name} from the household`}
                      onPress={() => setConfirming(true)}
                    />
                  </>
                )}
              </View>
            </>
          )}
        </View>
      </View>
    </Backdrop>
  );
};

const styles = StyleSheet.create({
  layout: {
    flex: 1,
    paddingHorizontal: safe.x,
    paddingTop: safe.top,
    paddingBottom: safe.y,
  },
  column: {
    width: size.readable,
  },
  title: {
    ...type.display,
    color: colors.text,
    fontWeight: weight.bold,
    marginBottom: space.md,
  },
  lead: {
    ...type.body,
    color: colors.text,
  },
  hint: {
    ...type.small,
    color: colors.textMuted,
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  error: {
    color: colors.text,
    fontWeight: weight.bold,
  },
  fieldFrame: {
    height: size.field,
    alignSelf: 'stretch',
  },
  raised: {
    zIndex: layer.raised,
    elevation: layer.raised,
  },
  input: {
    ...type.title,
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: 0,
    textAlignVertical: 'center',
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: size.border,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  inputFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  toggle: {
    alignSelf: 'stretch',
    marginBottom: space.sm,
  },
  toggleSurface: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: colors.surface,
    borderWidth: size.border,
    borderColor: colors.line,
  },
  surfaceFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  toggleText: {
    flex: 1,
  },
  toggleLabel: {
    ...type.body,
    color: colors.text,
    fontWeight: weight.bold,
  },
  toggleLine: {
    ...type.small,
    color: colors.textMuted,
  },
  state: {
    ...type.body,
    color: colors.textMuted,
    width: size.stateWord,
    textAlign: 'right',
    marginRight: space.sm,
  },
  stateOn: {
    color: colors.text,
    fontWeight: weight.bold,
  },
  track: {
    width: size.switchW,
    height: size.switchH,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    justifyContent: 'center',
    paddingHorizontal: (size.switchH - size.knob) / 2,
    alignItems: 'flex-start',
  },
  trackOn: {
    backgroundColor: colors.accent,
    alignItems: 'flex-end',
  },
  knob: {
    width: size.knob,
    height: size.knob,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
  },
  knobOn: {
    backgroundColor: colors.onAccent,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionsConfirm: {
    marginTop: space.xl,
  },
  actionsTop: {
    marginTop: space.sm,
  },
  actionGap: {
    width: space.md,
  },
});

export default PersonEditorScreen;
