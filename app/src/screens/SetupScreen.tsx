import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Backdrop from '../components/Backdrop';
import Button from '../components/Button';
import { colors, safe, size, space, type, weight } from '../styles/tokens';
import { useFocusOnMount } from '../utils/focusRoutes';

type Props = {
  onSetUp: () => void;
  onDemo: () => void;
};

/** First run: nobody is in the household yet. Same left-aligned layout as the notice. */
const SetupScreen = ({ onSetUp, onDemo }: Props) => {
  const setUpRef = useRef<View>(null);
  useFocusOnMount(setUpRef);
  return (
    <Backdrop>
      <View style={styles.layout}>
        <View style={styles.column}>
          <Text style={styles.title} accessibilityRole="header">
            Who watches here?
          </Text>
          <Text style={styles.lead}>
            Add the people who watch here, with the comfort settings each of
            them likes. You can change them any time.
          </Text>
          <Text style={styles.note}>
            The demo household is four made-up people, for looking around first.
          </Text>
          <View style={styles.actions}>
            <Button
              ref={setUpRef}
              label="Set up your household"
              variant="primary"
              size="lg"
              accessibilityLabel="Set up your household, starting with one person"
              onPress={onSetUp}
            />
            <View style={styles.gap} />
            <Button
              label="Use the demo household"
              variant="secondary"
              size="lg"
              accessibilityLabel="Use the demo household of four example people"
              onPress={onDemo}
            />
          </View>
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
    marginBottom: space.md,
  },
  note: {
    ...type.small,
    color: colors.textMuted,
  },
  actions: {
    marginTop: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
  },
  gap: {
    width: space.md,
  },
});

export default SetupScreen;
