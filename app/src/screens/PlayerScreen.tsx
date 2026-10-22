import { FocusManager } from '@amazon-devices/react-native-kepler';
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  BackHandler,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Cue, loadSenseVtt, VegaVideoSurface } from 'react-native-sensevtt';
import { DimOverlay } from 'react-native-sensevtt/react';
import ComfortBadges from '../components/ComfortBadges';
import CouchPanel from '../components/CouchPanel';
import HeadsUpCard from '../components/HeadsUpCard';
import PlayerControls from '../components/PlayerControls';
import { cuesUrl, manifestUrl } from '../config';
import { audioLabelFor } from '../engine/comfort';
import { LensSettings } from '../engine/types';
import { useController } from '../engine/useController';
import { usePlayer } from '../media/usePlayer';
import { startClockMessages } from '../relay/clockMessages';
import { RelayContext } from '../relay/RelayContext';
import { COLORS } from '../styles/palette';

type Props = {
  /** Media folder of the film. */
  title: string;
  name: string;
  lens: LensSettings;
  selected: string[];
  couchLabel: string;
  onToggle: (id: string) => void;
  onExit: () => void;
};

const PlayerScreen = ({
  title,
  name,
  lens,
  selected,
  couchLabel,
  onToggle,
  onExit,
}: Props) => {
  const { width } = useWindowDimensions();
  const scale = width / 1920;
  const { adapter, loaded, surfaceOn, durationMs, error } = usePlayer(
    manifestUrl(title),
    audioLabelFor(lens),
  );
  const controller = useController(adapter, lens);
  const relay = useContext(RelayContext);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const focusBeforePanel = useRef<number | undefined>();
  const started = useRef(false);

  // Without a cue list the film plays on with nothing to soften or warn about.
  useEffect(() => {
    let live = true;
    loadSenseVtt(cuesUrl(title))
      .then(
        (file) => {
          if (file.issues.length > 0) {
            console.warn('cues', title, `${file.issues.length} skipped`);
          }
          return file.cues;
        },
        (e: any) => {
          console.warn('cues', title, 'load failed', e?.message ?? '');
          return [] as Cue[];
        },
      )
      .then((list) => {
        if (live) {
          setCues(list);
        }
      });
    return () => {
      live = false;
    };
  }, [title]);

  useEffect(() => {
    if (controller && cues) {
      controller.setCues(cues);
    }
  }, [controller, cues]);

  // The film starts once the stream and the cue list are both in, so no moment is missed.
  useEffect(() => {
    if (started.current || !adapter || !controller || !loaded || !cues) {
      return;
    }
    started.current = true;
    console.info('cues', title, `${cues.length} cues`);
    adapter.play();
  }, [adapter, controller, loaded, cues, title]);

  const openPanel = useCallback(() => {
    focusBeforePanel.current = FocusManager.getFocused();
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    const tag = focusBeforePanel.current;
    if (tag !== undefined) {
      setTimeout(() => FocusManager.focus(tag), 50);
    }
  }, []);

  const panelOpenRef = useRef(false);
  panelOpenRef.current = panelOpen;
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const chipRef = useRef<View>(null);

  // Registered once: handlers added later, such as the heads-up card's, run before it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panelOpenRef.current) {
        closePanel();
      } else {
        exitRef.current();
      }
      return true;
    });
    return () => sub.remove();
  }, [closePanel]);

  // Phones follow the film from this clock, for the audio description they play.
  useEffect(
    () =>
      relay && adapter && controller
        ? startClockMessages(adapter, controller, relay, title)
        : undefined,
    [adapter, controller, relay, title],
  );

  useEffect(() => {
    if (!adapter || !controller) {
      return undefined;
    }
    return adapter.addListener((eventName) =>
      console.info(
        'media',
        eventName,
        adapter.currentTime.toFixed(3),
        controller.clock.now().toFixed(3),
      ),
    );
  }, [adapter, controller]);

  return (
    <View style={styles.root}>
      {adapter && surfaceOn && (
        <VegaVideoSurface adapter={adapter} style={styles.surface} />
      )}
      {controller && <DimOverlay controller={controller} />}
      {adapter && controller && (
        <PlayerControls
          adapter={adapter}
          controller={controller}
          name={name}
          cues={cues ?? []}
          lens={lens}
          couchLabel={couchLabel}
          durationMs={durationMs}
          locked={panelOpen}
          chipRef={chipRef}
          onOpenCouch={openPanel}
        />
      )}
      {controller && <ComfortBadges controller={controller} />}
      {controller && (
        <HeadsUpCard controller={controller} anchors={[chipRef]} />
      )}
      {panelOpen && (
        <CouchPanel
          selected={selected}
          onToggle={onToggle}
          onClose={closePanel}
        />
      )}
      {error && (
        <Text style={[styles.error, { fontSize: 36 * scale }]}>{error}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.BLACK,
  },
  surface: {
    ...StyleSheet.absoluteFillObject,
  },
  error: {
    position: 'absolute',
    top: 40,
    left: 40,
    color: COLORS.ACCENT,
    zIndex: 20,
  },
});

export default PlayerScreen;
