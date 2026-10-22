export type CueType = 'flash' | 'loud' | 'scare' | 'ad';

/** What fixed a cue's timestamp. `approx` means the player widens its margins. */
export type CueAnchor = 'iris' | 'onset' | 'cut' | 'approx';

export interface AudioRef {
  uri: string;
  duration_s: number;
}

/** One cue as written in a SenseVTT file. `start` and `end` are the event itself, without margins. */
export interface Cue {
  id: string;
  type: CueType;
  start: number;
  end: number;
  anchor: CueAnchor;
  intensity: number;
  preview: string;
  lead_s?: number;
  pre_s?: number;
  post_s?: number;
  audio_ref?: AudioRef;
  evidence?: Record<string, unknown>;
}

export interface SenseVttHeader {
  version: 1;
  title: string;
  analyzer: string;
  source_sha256: string;
  fps: number;
  iris: { verdict: string; max_luminance_swing?: number };
}

export interface SenseVttFile {
  header: SenseVttHeader | null;
  cues: Cue[];
}

export type FlashesSetting = 'soften' | 'off';
export type LoudSetting = 'cap' | 'off';
export type ScaresSetting = 'headsup' | 'off';
export type AdSetting = 'on' | 'off';

/** Comfort settings for one person, or the combined (most protective) lens. */
export interface LensSettings {
  flashes: FlashesSetting;
  loud: LoudSetting;
  scares: ScaresSetting;
  ad: AdSetting;
}

export const NO_LENS: LensSettings = {
  flashes: 'off',
  loud: 'off',
  scares: 'off',
  ad: 'off',
};
