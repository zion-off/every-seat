import { FocusManager } from '@amazon-devices/react-native-kepler';
import React, {
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  findNodeHandle,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Cue, SenseController } from 'react-native-sensevtt';
import { useControllerState } from '../engine/useController';
import {
  colors,
  layer,
  radius,
  safe,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';
import Focusable from './Focusable';

type Choice = 'soften' | 'watch';

const kindOf = (cards: Cue[]): string => {
  const loud = cards.some((c) => c.type === 'loud');
  const scare = cards.some((c) => c.type === 'scare');
  if (loud && scare) {
    return 'a sudden loud sound and a scare';
  }
  return loud ? 'a sudden loud sound' : 'a scare';
};

const previewOf = (cards: Cue[]): string[] =>
  cards
    .map((c) => c.preview)
    .filter((text, i, all) => text.length > 0 && all.indexOf(text) === i);

const announce = (text: string) =>
  AccessibilityInfo.announceForAccessibility(text);

type ButtonProps = {
  label: string;
  hint: string;
  buttonRef: RefObject<View>;
  onPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
};

const CardButton = ({
  label,
  hint,
  buttonRef,
  onPress,
  onFocus,
  onBlur,
}: ButtonProps) => (
  <Focusable
    ref={buttonRef}
    accessible
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint={hint}
    onPress={onPress}
    onFocus={onFocus}
    onBlur={onBlur}
    style={styles.button}
    contentStyle={(focused) => [
      styles.buttonFill,
      focused && styles.buttonFocused,
    ]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Focusable>
);

type BodyProps = {
  controller: SenseController;
  cards: Cue[];
  /** Controls the card can be reached from, besides whatever held focus when it appeared. */
  anchors: Array<RefObject<View>>;
};

const tagOf = (ref: RefObject<View>): number | null =>
  ref.current ? findNodeHandle(ref.current) : null;

const CardBody = ({ controller, cards, anchors }: BodyProps) => {
  const softenRef = useRef<View>(null);
  const watchRef = useRef<View>(null);
  const tellRef = useRef<View>(null);
  const prevTag = useRef<number | undefined>();
  const routed = useRef<number[]>([]);
  const inCard = useRef(false);
  const unmounting = useRef(false);
  const choice = useRef<Choice | null>(null);
  const ids = useRef<string[]>([]);
  ids.current = cards.map((c) => c.id);
  const [tellMe, setTellMe] = useState(false);
  const [focused, setFocused] = useState(false);

  const kind = kindOf(cards);

  useLayoutEffect(
    () => () => {
      unmounting.current = true;
    },
    [],
  );

  useEffect(() => {
    const prev = FocusManager.getFocused();
    prevTag.current = prev;
    const first = tagOf(softenRef);
    const sources = [prev, ...anchors.map(tagOf)].filter(
      (tag, i, all): tag is number =>
        typeof tag === 'number' && all.indexOf(tag) === i,
    );
    if (first !== null) {
      sources.forEach((from) => FocusManager.setNextFocus(from, first, 'up'));
    }
    routed.current = sources;
    const buttons = [softenRef, watchRef, tellRef].map(tagOf);
    if (prev !== undefined) {
      buttons.forEach((from) => {
        if (from !== null) {
          FocusManager.setNextFocus(from, prev, 'down');
        }
      });
    }
    announce(
      `Heads-up: ${kind} is coming up. Press up to choose soften, watch or tell me. If you do not choose, it will be softened.`,
    );
    const watched = ids.current;
    return () => {
      routed.current.forEach((from) => FocusManager.clearNextFocus(from, 'up'));
      const back = prevTag.current;
      if (inCard.current && back !== undefined) {
        setTimeout(() => FocusManager.focus(back), 50);
      }
      if (choice.current === 'soften') {
        announce('Softened');
      } else if (choice.current === 'watch') {
        announce('Watching as it is');
      } else if (
        watched.some((id) => controller.decisionFor(id) === 'soften')
      ) {
        announce('No answer, so the moment is softened');
      }
    };
    // The card is mounted once per heads-up; later card changes only update its text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const back = prevTag.current;
      if (inCard.current && back !== undefined) {
        FocusManager.focus(back);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const decide = (picked: Choice) => {
    choice.current = picked;
    ids.current.forEach((id) =>
      picked === 'soften' ? controller.soften(id) : controller.watch(id),
    );
  };

  const onTellMe = () => {
    setTellMe(true);
    announce(previewOf(cards).join(' '));
  };

  const enter = () => {
    inCard.current = true;
    setFocused(true);
  };
  const leave = () => {
    if (!unmounting.current) {
      inCard.current = false;
      setFocused(false);
    }
  };

  return (
    <View style={styles.card} accessible={false}>
      <View style={styles.edge} />
      <Text style={styles.title} accessibilityRole="header">
        Heads-up: {kind} is coming up
      </Text>
      {tellMe &&
        previewOf(cards).map((text) => (
          <Text key={text} style={styles.preview}>
            {text}
          </Text>
        ))}
      <Text style={styles.hint}>
        {focused
          ? 'No answer softens it.'
          : 'Press Up to choose. No answer softens it.'}
      </Text>
      <View style={styles.row}>
        <CardButton
          label="Soften"
          hint="Lowers the volume and dims the picture for this moment"
          buttonRef={softenRef}
          onPress={() => decide('soften')}
          onFocus={enter}
          onBlur={leave}
        />
        <CardButton
          label="Watch"
          hint="Plays this moment as it is"
          buttonRef={watchRef}
          onPress={() => decide('watch')}
          onFocus={enter}
          onBlur={leave}
        />
        <CardButton
          label="Tell me"
          hint="Describes this moment and keeps this card open"
          buttonRef={tellRef}
          onPress={onTellMe}
          onFocus={enter}
          onBlur={leave}
        />
      </View>
    </View>
  );
};

type Props = {
  controller: SenseController;
  anchors?: Array<RefObject<View>>;
};

/**
 * A card that asks what to do about a coming scare or sudden loud sound. It does not take
 * focus: Up from the controls reaches it, and focus goes back to where it was when it closes.
 */
const HeadsUpCard = ({ controller, anchors = [] }: Props) => {
  const { cards } = useControllerState(controller);
  if (cards.length === 0) {
    return null;
  }
  return <CardBody controller={controller} cards={cards} anchors={anchors} />;
};

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: safe.x,
    bottom: size.cardBottom,
    width: size.column,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: size.border,
    borderColor: colors.line,
    zIndex: layer.card,
  },
  edge: {
    position: 'absolute',
    top: -size.border,
    left: -size.border,
    right: -size.border,
    height: size.accentEdge,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    backgroundColor: colors.accent,
  },
  title: {
    ...type.title,
    color: colors.text,
    fontWeight: weight.bold,
  },
  preview: {
    ...type.body,
    color: colors.text,
    marginTop: space.sm,
  },
  hint: {
    ...type.body,
    color: colors.textMuted,
    marginTop: space.xs,
    marginBottom: space.md,
  },
  row: {
    flexDirection: 'row',
  },
  button: {
    minWidth: size.cardButton,
    marginRight: space.md,
  },
  buttonFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.buttonMd,
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderWidth: size.border,
    borderColor: colors.line,
  },
  buttonFocused: {
    backgroundColor: colors.surfaceFocused,
  },
  buttonText: {
    ...type.body,
    color: colors.text,
    fontWeight: weight.bold,
  },
});

export default HeadsUpCard;
