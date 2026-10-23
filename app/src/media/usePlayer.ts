import { VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { useEffect, useRef, useState } from 'react';
import { createVegaAdapter, VegaAdapter } from 'sensevtt';
import { createShakaPlayer } from './shaka';

export type PlayerState = {
  adapter: VegaAdapter | null;
  /** True once the stream is loaded and playback can start. */
  loaded: boolean;
  /** True once the stream's metadata is known; the video surface can be shown. */
  surfaceOn: boolean;
  durationMs: number;
  error: string | null;
};

const IDLE: PlayerState = {
  adapter: null,
  loaded: false,
  surfaceOn: false,
  durationMs: 0,
  error: null,
};

/** Events the adapter does not forward, logged so a session can be read back. */
const LOGGED_EVENTS = ['loadedmetadata', 'canplay', 'error', 'volumechange'];

/**
 * Creates the w3cmedia video element and the Shaka player, loads `url` and wraps the element in a
 * SenseVTT adapter. `audioLabel` picks the rendition the stream starts on, so nothing switches
 * once the first frame is shown; a later change switches without flushing the buffer. Everything
 * is released when the component unmounts or `url` changes. Playback is left to the caller.
 */
export const usePlayer = (url: string, audioLabel: string): PlayerState => {
  const [state, setState] = useState<PlayerState>(IDLE);
  const wanted = useRef(audioLabel);
  wanted.current = audioLabel;
  const playing = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let video: VideoPlayer | null = null;
    let shaka: any = null;
    let adapter: VegaAdapter | null = null;

    const fail = (what: string, e: any) => {
      if (!cancelled) {
        setState((s) => ({
          ...s,
          error: `${what} ${e?.code ?? e?.message ?? ''}`,
        }));
      }
    };

    (async () => {
      video = new VideoPlayer();
      await video.initialize();
      if (cancelled) {
        video.deinitializeSync(1500);
        video = null;
        return;
      }
      const element = video;
      element.autoplay = false;
      LOGGED_EVENTS.forEach((name) =>
        element.addEventListener(name, () =>
          console.info('media', name, element.currentTime.toFixed(3)),
        ),
      );
      element.addEventListener('loadedmetadata', () => {
        if (!cancelled) {
          const duration = Number.isFinite(element.duration)
            ? Math.round(element.duration * 1000)
            : 0;
          setState((s) => ({ ...s, surfaceOn: true, durationMs: duration }));
        }
      });
      shaka = createShakaPlayer(element, (e) => fail('playback error', e));
      adapter = createVegaAdapter({ video: element, shaka });
      adapter.preferAudioLabel(wanted.current);
      setState((s) => ({ ...s, adapter }));
      await shaka.load(url);
      if (cancelled) {
        return;
      }
      playing.current = adapter.activeAudioLabel() ?? wanted.current;
      console.info(
        'media',
        'opened',
        `audio=${playing.current}`,
        JSON.stringify(
          adapter
            .audioRenditions()
            .map((r) => [r.id, r.label, r.language, r.active]),
        ),
      );
      setState((s) => ({ ...s, loaded: true }));
    })().catch((e) => fail('load error', e));

    return () => {
      cancelled = true;
      try {
        adapter?.release();
        video?.pause();
        if (shaka) {
          shaka.detach();
          shaka.destroy();
        }
        video?.deinitializeSync(1500);
      } catch (e) {
        console.error('media teardown failed', e);
      }
      playing.current = null;
      setState(IDLE);
    };
  }, [url]);

  const { adapter, loaded } = state;
  useEffect(() => {
    if (!adapter || !loaded || playing.current === audioLabel) {
      return;
    }
    if (adapter.selectAudio(audioLabel)) {
      console.info(
        'media',
        'audio rendition',
        playing.current,
        '->',
        audioLabel,
      );
      playing.current = audioLabel;
    }
  }, [adapter, loaded, audioLabel]);

  return state;
};
