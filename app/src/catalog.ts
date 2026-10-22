export interface TitleEntry {
  /** Folder under the media server, also the key for the cue list. */
  folder: string;
  name: string;
  byline: string;
  durationS: number;
  accent: string;
}

export const TITLES: TitleEntry[] = [
  {
    folder: 'test_pattern',
    name: 'Test pattern',
    byline: 'One moment of each kind',
    durationS: 120,
    accent: '#2f4f73',
  },
  {
    folder: 'elephants_dream',
    name: 'Elephants Dream',
    byline: 'Blender Foundation, 2006',
    durationS: 653.875,
    accent: '#7a4b2a',
  },
  {
    folder: 'tears_of_steel',
    name: 'Tears of Steel',
    byline: 'Blender Foundation, 2012',
    durationS: 734.167,
    accent: '#2c5a5f',
  },
  {
    folder: 'sintel',
    name: 'Sintel',
    byline: 'Blender Foundation, 2010',
    durationS: 888.032,
    accent: '#5d3a63',
  },
];

export const formatClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest}`;
};
