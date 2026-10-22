import { Cue, CueAnchor, CueType, SenseVttFile, SenseVttHeader } from './types';

const CUE_TYPES: CueType[] = ['flash', 'loud', 'scare', 'ad'];
const ANCHORS: CueAnchor[] = ['iris', 'onset', 'cut', 'approx'];
const HEADER_NOTE = 'NOTE sensevtt-header';

const toBlocks = (text: string): string[][] => {
  const blocks: string[][] = [];
  let current: string[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line) => {
      if (line.trim() === '') {
        if (current.length > 0) {
          blocks.push(current);
          current = [];
        }
      } else {
        current.push(line);
      }
    });
  if (current.length > 0) {
    blocks.push(current);
  }
  return blocks;
};

const toCue = (raw: any): Cue | null => {
  if (
    !raw ||
    typeof raw.id !== 'string' ||
    !CUE_TYPES.includes(raw.type) ||
    typeof raw.start !== 'number' ||
    typeof raw.end !== 'number' ||
    raw.start < 0 ||
    raw.end < raw.start
  ) {
    return null;
  }
  return {
    ...raw,
    anchor: ANCHORS.includes(raw.anchor) ? raw.anchor : 'approx',
    intensity: typeof raw.intensity === 'number' ? raw.intensity : 3,
    preview: typeof raw.preview === 'string' ? raw.preview : '',
  };
};

/** Parses a SenseVTT file: WebVTT whose cues carry one line of JSON. Malformed cues are skipped. */
export const parseSenseVtt = (text: string): SenseVttFile => {
  const blocks = toBlocks(text);
  if (blocks.length === 0 || !blocks[0][0].startsWith('WEBVTT')) {
    throw new Error('not a WebVTT file');
  }

  let header: SenseVttHeader | null = null;
  const cues: Cue[] = [];

  blocks.forEach((block, index) => {
    if (block[0].startsWith(HEADER_NOTE)) {
      const json =
        block.length > 1 ? block.slice(1).join('') : blocks[index + 1]?.[0];
      try {
        header = JSON.parse(json);
      } catch (e) {
        console.warn('sensevtt: unreadable header');
      }
      return;
    }
    const timing = block.findIndex((line) => line.includes('-->'));
    if (timing < 0) {
      return;
    }
    try {
      const cue = toCue(JSON.parse(block.slice(timing + 1).join('')));
      if (cue) {
        cues.push(cue);
      } else {
        console.warn('sensevtt: skipped an invalid cue');
      }
    } catch (e) {
      console.warn('sensevtt: skipped a cue with unreadable JSON');
    }
  });

  cues.sort((a, b) => a.start - b.start);
  return { header, cues };
};

export const loadCues = async (url: string): Promise<SenseVttFile | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn('sensevtt: no cue list', response.status);
      return null;
    }
    return parseSenseVtt(await response.text());
  } catch (e) {
    console.warn('sensevtt: could not load the cue list', e);
    return null;
  }
};
