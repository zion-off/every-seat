import { KeplerVideoSurfaceView } from '@amazon-devices/react-native-w3cmedia';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { manifestUrl } from '../config';
import { MediaSession } from '../media/MediaSession';
import { COLORS } from '../styles/palette';

type Props = {
  title: string;
};

const PlayerScreen = ({ title }: Props) => {
  const { width } = useWindowDimensions();
  const scale = width / 1920;
  const session = useMemo(() => new MediaSession(), []);
  const [surfaceOn, setSurfaceOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = session.addListener((name) => {
      console.info('media', name, session.currentTime.toFixed(3));
      if (name === 'loadedmetadata') {
        setSurfaceOn(true);
      }
    });
    session.onError = (e: any) => setError(`playback error ${e?.code ?? ''}`);
    session
      .load(manifestUrl(title))
      .then(() => session.play())
      .catch((e: any) => setError(`load error ${e?.code ?? e?.message ?? ''}`));
    return () => {
      off();
      session.destroy();
    };
  }, [session, title]);

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
  },
});

export default PlayerScreen;
