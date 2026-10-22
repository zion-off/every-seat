import { FocusManager } from '@amazon-devices/react-native-kepler';
import { KeplerVideoSurfaceView } from '@amazon-devices/react-native-w3cmedia';
import React, {
  useCallback,
  useEffect,
  useMemo,
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
import CouchPanel from '../components/CouchPanel';
import DimOverlay from '../components/DimOverlay';
import PlayerControls from '../components/PlayerControls';
import { PlaybackEngine } from '../engine/PlaybackEngine';
import { Cue, LensSettings } from '../engine/types';
import { MediaSession } from '../media/MediaSession';
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
  const session = useMemo(() => new MediaSession(), []);
  const engine = useMemo(() => new PlaybackEngine(session), [session]);
  const [surfaceOn, setSurfaceOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [durationMs, setDurationMs] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const focusBeforePanel = useRef<number | undefined>();

  useEffect(() => {
    engine.setLens(lens);
  }, [engine, lens]);

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

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panelOpen) {
        closePanel();
      } else {
        onExit();
      }
      return true;
    });
    return () => sub.remove();
  }, [panelOpen, closePanel, onExit]);

  useEffect(() => {
    const off = session.addListener((eventName) => {
      console.info(
        'media',
        eventName,
        session.currentTime.toFixed(3),
        engine.clock.now().toFixed(3),
      );
      if (eventName === 'loadedmetadata') {
        setSurfaceOn(true);
        setDurationMs(Math.round(session.duration * 1000));
      }
    });
    session.onError = (e: any) => setError(`playback error ${e?.code ?? ''}`);
    engine
      .open(title)
      .then(() => {
        setCues(engine.cueList);
        session.play();
      })
      .catch((e: any) => setError(`load error ${e?.code ?? e?.message ?? ''}`));
    return () => {
      off();
      engine.destroy();
      session.destroy();
    };
  }, [engine, session, title]);

  const onSurfaceViewCreated = useCallback(
    (handle: string) => session.onSurfaceViewCreated(handle),
    [session],
  );
  const onSurfaceViewDestroyed = useCallback(
    (handle: string) => session.onSurfaceViewDestroyed(handle),
    [session],
  );

  return (
    <View style={styles.root}>
      {surfaceOn && (
        <KeplerVideoSurfaceView
          style={styles.surface}
          onSurfaceViewCreated={onSurfaceViewCreated}
          onSurfaceViewDestroyed={onSurfaceViewDestroyed}
        />
      )}
      <DimOverlay opacity={engine.dim} />
      <PlayerControls
        session={session}
        engine={engine}
        name={name}
        cues={cues}
        lens={lens}
        couchLabel={couchLabel}
        durationMs={durationMs}
        locked={panelOpen}
        onOpenCouch={openPanel}
      />
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
