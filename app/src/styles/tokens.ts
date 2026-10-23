import { scaleUxToDp as dp } from '../utils/pixelUtils';

/** Every colour, size, radius, duration and layer the app uses; see DESIGN.md. */

export const colors = {
  background: '#0d111c',
  backgroundTop: '#1d2332',
  surface: '#161c2a',
  surfaceRaised: '#1d2332',
  surfaceFocused: '#2a3350',
  line: '#33405e',
  text: '#f3f5fb',
  textMuted: '#aeb7cc',
  accent: '#ffbe5c',
  accentDeep: '#e8973a',
  onAccent: '#1a1206',
  scrim: 'rgba(13, 17, 28, 0.72)',
  scrimStrong: 'rgba(13, 17, 28, 0.94)',
  glow: 'rgba(255, 190, 92, 0.05)',
  black: '#000000',
  transparent: 'transparent',
};

/** Seek bar colours for a marked moment, from the mildest (intensity 1) to the strongest (5). */
export const heat: Array<{ base: string; progressed: string }> = [
  { base: '#ffd899', progressed: '#fff0d6' },
  { base: '#ffbe5c', progressed: '#ffe0ad' },
  { base: '#e8973a', progressed: '#f5c78f' },
  { base: '#e0612f', progressed: '#f1a283' },
  { base: '#d94040', progressed: '#eb9696' },
];

export const space = {
  xs: dp(8),
  sm: dp(16),
  md: dp(24),
  lg: dp(32),
  xl: dp(48),
  xxl: dp(64),
};

/** The 5% title-safe margin at 1080p is 96 x 54; the vertical margin is rounded up to the scale. */
export const safe = {
  x: dp(96),
  y: dp(56),
  /** Where the title of a full-screen page starts, so every page opens at the same height. */
  top: dp(168),
};

export const radius = {
  sm: dp(8),
  md: dp(16),
  lg: dp(24),
  pill: dp(999),
};

export const type = {
  small: { fontSize: dp(24), lineHeight: dp(32) },
  body: { fontSize: dp(28), lineHeight: dp(36) },
  title: { fontSize: dp(40), lineHeight: dp(48) },
  display: { fontSize: dp(56), lineHeight: dp(64) },
};

export const weight = {
  regular: '400' as const,
  bold: '700' as const,
};

export const motion = {
  /** Focus and state changes, on the native driver (opacity and transform only). */
  focusMs: 150,
  /** The hero picture cross-fades slowly enough to stay gentle for light-sensitive viewers. */
  heroMs: 400,
};

export const focus = {
  scaleTile: 1.05,
  scaleControl: 1.04,
  ringWidth: dp(3),
  ringOffset: dp(4),
  haloSpread: dp(14),
};

export const layer = {
  /** A focused element, above its neighbours so its outline and halo are never covered. */
  raised: 1,
  dim: 10,
  controls: 30,
  panel: 40,
  card: 50,
};

export const size = {
  border: dp(2),
  accentEdge: dp(4),
  avatar: dp(64),
  avatarSm: dp(32),
  check: dp(40),
  buttonMd: dp(64),
  buttonLg: dp(80),
  topBar: dp(64),
  mark: dp(56),
  markHero: dp(448),
  pill: dp(48),
  column: dp(1040),
  readable: dp(900),
  tileW: dp(408),
  tileH: dp(230),
  /** A person card on the couch screen: eight fit in two rows inside the safe area. */
  personH: dp(240),
  columns: 4,
  heroW: dp(1100),
  heroH: dp(619),
  heroText: dp(700),
  heroFadeX: dp(560),
  heroFadeY: dp(320),
  topFade: dp(240),
  dot: dp(12),
  couchPill: dp(560),
  seekTrack: dp(12),
  cardBottom: dp(344),
  meterBar: { width: dp(8), height: dp(32), gap: dp(4) },
  chip: dp(640),
  cardButton: dp(224),
  meterLevel: dp(96),
  tick: { width: dp(20), height: dp(10), stroke: dp(4) },
  panel: dp(760),
  field: dp(72),
  switchW: dp(88),
  switchH: dp(48),
  knob: dp(32),
  stateWord: dp(72),
};
