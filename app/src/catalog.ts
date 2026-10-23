import { ImageSourcePropType } from 'react-native';

export interface TitleEntry {
  /** Folder under the media server, also the key for the cue list. */
  folder: string;
  name: string;
  byline: string;
  /** One sentence about the film, shown with the focused title. */
  blurb: string;
  durationS: number;
  /** A frame from the film, used for the tile and the hero picture. */
  still: ImageSourcePropType;
}

export const TITLES: TitleEntry[] = [
  {
    folder: 'test_pattern',
    name: 'Test pattern',
    byline: 'One moment of each kind',
    blurb:
      'A short reel with a flash, a loud sound and a scare, made for trying the comfort settings.',
    durationS: 120,
    still: require('../assets/stills/test_pattern.jpg'),
  },
  {
    folder: 'elephants_dream',
    name: 'Elephants Dream',
    byline: 'Blender Foundation, 2006',
    blurb:
      'Two strange characters explore a capricious and seemingly infinite machine.',
    durationS: 653.875,
    still: require('../assets/stills/elephants_dream.jpg'),
  },
  {
    folder: 'tears_of_steel',
    name: 'Tears of Steel',
    byline: 'Blender Foundation, 2012',
    blurb:
      'Warriors and scientists in Amsterdam try to save the world from destructive robots.',
    durationS: 734.167,
    still: require('../assets/stills/tears_of_steel.jpg'),
  },
  {
    folder: 'sintel',
    name: 'Sintel',
    byline: 'Blender Foundation, 2010',
    blurb: 'A young woman sets out to find the baby dragon she befriended.',
    durationS: 888.032,
    still: require('../assets/stills/sintel.jpg'),
  },
];

export const formatClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest}`;
};
