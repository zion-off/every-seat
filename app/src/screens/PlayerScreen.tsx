import { KeplerVideoSurfaceView } from '@amazon-devices/react-native-w3cmedia';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import DimOverlay from '../components/DimOverlay';
import { PlaybackEngine } from '../engine/PlaybackEngine';
import { LensSettings } from '../engine/types';
import { MediaSession } from '../media/MediaSession';
import { COLORS } from '../styles/palette';

type Props = {
  title: string;
  lens: LensSettings;
  onExit: () => void;
};

const PlayerScreen = ({ title, lens, onExit }: Props) => {
  const { width } = useWindowDimensions();
  const scale = width / 1920;
  const session = useMemo(() => new MediaSession(), []);
  const engine = useMemo(() => new PlaybackEngine(session), [session]);
  const [surfaceOn, setSurfaceOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    engine.setLens(lens);
  }, [engine, lens]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onExit();
      return true;
    });
    return () => sub.remove();
  }, [onExit]);

  useEffect(() => {
    const off = session.addListener((name) => {
      console.info(
        'media',
        name,
        session.currentTime.toFixed(3),
        engine.clock.now().toFixed(3),
      );
      if (name === 'loadedmetadata') {
        setSurfaceOn(true);
      }
    });
    session.onError = (e: any) => setError(`playback error ${e?.code ?? ''}`);
    engine
      .open(title)
      .then(() => session.play())
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
