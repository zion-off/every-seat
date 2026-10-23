// Shared data contracts. Hand-written mirror of the JSON Schemas in
// pipeline/everyseat/contracts/schemas/ (lens and relay), the types in
// pipeline/everyseat/contracts/types.py, and the SenseVTT cue file schemas of the sensevtt library.

export type CueType = "flash" | "loud" | "scare" | "ad";

/** What fixed a cue's timestamp. `approx` means the player widens its margins. */
export type CueAnchor = "iris" | "onset" | "cut" | "approx";

export type IrisVerdict = "PASS" | "PASS_WITH_WARNING" | "FAIL" | "NOT_RUN";

export interface IrisSummary {
  verdict: IrisVerdict;
  max_luminance_swing?: number;
}

/** The JSON line after the `NOTE sensevtt-header` block of a SenseVTT file. */
export interface SenseVttHeader {
  version: 1;
  /** Title id, matching ^[a-z0-9-]+$ */
  title: string;
  analyzer: string;
  /** 64 lowercase hex characters */
  source_sha256: string;
  /** Integer constant frame rate, 1-120. All cue times are snapped to this grid. */
  fps: number;
  iris: IrisSummary;
}

export interface AudioRef {
  uri: string;
  /** Exact clip duration in seconds, greater than 0. */
  duration_s: number;
}

/** The one-line JSON payload of a SenseVTT cue. `start`/`end` are the event, without margins. */
export interface CuePayload {
  /** Unique within the file. */
  id: string;
  type: CueType;
  /** Seconds of media time, >= 0. */
  start: number;
  end: number;
  anchor: CueAnchor;
  /** Integer, 1-5. */
  intensity: number;
  /** One spoiler-light line, 1-140 characters. */
  preview: string;
  /** Heads-up lead time in seconds, 0-30. Default 5. */
  lead_s?: number;
  /** Ramp margins in seconds, 0-10. Defaults for flash cues: 1.5 before, 1.0 after. */
  pre_s?: number;
  post_s?: number;
  /** Required on `ad` cues, not allowed on any other type. */
  audio_ref?: AudioRef;
  evidence?: Record<string, unknown>;
}

export type FlashesSetting = "soften" | "off";
export type LoudSetting = "cap" | "off";
export type ScaresSetting = "headsup" | "off";
export type AdSetting = "on" | "off";

/** Comfort settings for one person, or the combined (most protective) lens. */
export interface LensSettings {
  flashes: FlashesSetting;
  loud: LoudSetting;
  scares: ScaresSetting;
  ad: AdSetting;
}

export interface LensPerson {
  name: string;
  settings: LensSettings;
}

export type RelayRole = "tv" | "phone" | "companion";

/** Client to relay: connect and declare a role. */
export interface HelloMessage {
  t: "hello";
  role: RelayRole;
  household: string;
}

export interface PingMessage {
  t: "ping";
}

export interface PongMessage {
  t: "pong";
}

/** Companion to TV: the people on the couch and the combined lens. */
export interface LensMessage {
  t: "lens";
  people: LensPerson[];
  settings: LensSettings;
}

/**
 * Either direction between the TV and the companion: everyone in the household with their
 * comfort settings (at most 7). The latest `updatedAt` wins; the relay keeps the latest and
 * replays it to a TV that connects later.
 */
export interface HouseholdMessage {
  t: "household";
  people: LensPerson[];
  /** Milliseconds since the Unix epoch when the list was last changed. */
  updatedAt: number;
}

/** TV to phone: sent on play, pause, seek, rate change, and every 2 s. */
export interface ClockMessage {
  t: "clock";
  /** Media position in seconds. */
  mediaTime: number;
  /** Sender time in the relay's clock (see `sync?`), integer milliseconds since the Unix epoch. */
  wallClock: number;
  /** Playback rate. */
  rate: number;
  /** The film's id. Empty in the TV's last clock when it leaves the player, so phones stop following. */
  title: string;
}

/** Phone or TV to relay: clock offset probe. `c` is an integer millisecond timestamp. */
export interface SyncRequestMessage {
  t: "sync?";
  c: number;
}

/** Relay to phone or TV: echoes `c` and adds the relay's integer millisecond timestamp `s`. */
export interface SyncReplyMessage {
  t: "sync!";
  c: number;
  s: number;
}

/** One newline-delimited JSON message on the relay WebSocket, discriminated by `t`. */
export type RelayMessage =
  | HelloMessage
  | PingMessage
  | PongMessage
  | LensMessage
  | HouseholdMessage
  | ClockMessage
  | SyncRequestMessage
  | SyncReplyMessage;
