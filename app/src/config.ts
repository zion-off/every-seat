export const MEDIA_BASE = 'http://10.0.2.2:8080';

export const DEFAULT_TITLE = 'test_pattern';

export const manifestUrl = (title: string) =>
  `${MEDIA_BASE}/${title}/master.m3u8`;

export const cuesUrl = (title: string) =>
  `${MEDIA_BASE}/${title}/cues.sensevtt`;
