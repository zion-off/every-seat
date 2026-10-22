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
