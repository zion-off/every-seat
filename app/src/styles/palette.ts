export const COLORS = {
  BACKGROUND: '#0f141c',
  SURFACE: '#1b2430',
  SURFACE_FOCUSED: '#2c3a4d',
  TEXT: '#eaefff',
  MUTED: '#9aa6bd',
  ACCENT: '#ffc166',
  BLACK: '#000000',
  TRANSPARENT: 'transparent',
  TRACK: '#3b475c',
  TRACK_SEEK: '#6d7b95',
};

/** Seek bar colours for a marked moment, from the mildest (intensity 1) to the strongest (5). */
export const HEAT: Array<{ base: string; progressed: string }> = [
  { base: '#9a8350', progressed: '#cdb98a' },
  { base: '#c99a3e', progressed: '#ecc67a' },
  { base: '#e8913a', progressed: '#f7bf85' },
  { base: '#ee6b3a', progressed: '#f8a784' },
  { base: '#ef4444', progressed: '#f69a9a' },
];
