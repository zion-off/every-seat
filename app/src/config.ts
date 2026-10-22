export const MEDIA_BASE = 'http://10.0.2.2:8080';

/** The companion's relay. The Virtual Device reaches the host's localhost at 10.0.2.2. */
export const RELAY_URL = 'ws://10.0.2.2:8787/relay';

/** The household this TV joins on the relay. */
export const HOUSEHOLD = 'demo';

export const manifestUrl = (title: string) =>
  `${MEDIA_BASE}/${title}/master.m3u8`;

export const cuesUrl = (title: string) =>
  `${MEDIA_BASE}/${title}/cues.sensevtt`;
