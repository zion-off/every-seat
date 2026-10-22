// The generated Shaka bundle ships without type declarations.
// @ts-nocheck
import shaka from '../w3cmedia/shakaplayer/dist/shaka-player.compiled';
import '../w3cmedia/shakaplayer/ShakaPlayer';

let schemesRegistered = false;

export type ShakaError = {
  code?: number;
  category?: number;
  data?: unknown;
};

export function createShakaPlayer(
  mediaElement: unknown,
  onError: (e: ShakaError) => void,
) {
  shaka.polyfill.installAll();
  if (!schemesRegistered) {
    shaka.net.NetworkingEngine.unregisterScheme('http');
    shaka.net.NetworkingEngine.unregisterScheme('https');
    const { PluginPriority } = shaka.net.NetworkingEngine;
    shaka.net.NetworkingEngine.registerScheme(
      'http',
      shaka.net.HttpFetchPlugin.parse,
      PluginPriority.APPLICATION,
      true,
    );
    shaka.net.NetworkingEngine.registerScheme(
      'https',
      shaka.net.HttpFetchPlugin.parse,
      PluginPriority.APPLICATION,
      true,
    );
    schemesRegistered = true;
  }

  const player = new shaka.Player(mediaElement);
  player.configure({
    streaming: {
      lowLatencyMode: false,
      inaccurateManifestTolerance: 0,
      rebufferingGoal: 0.01,
      bufferingGoal: 10,
      retryParameters: { maxAttempts: 3 },
    },
    manifest: { hls: { sequenceMode: false } },
    abr: { enabled: false },
    preferredAudioLanguage: 'en',
  });
  player.addEventListener('error', (ev) => onError(ev.detail));
  return player;
}
