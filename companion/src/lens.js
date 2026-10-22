import { z } from "zod";

/** @typedef {import("./contracts.d.ts").LensSettings} LensSettings */
/** @typedef {import("./contracts.d.ts").LensPerson} LensPerson */
/** @typedef {import("./contracts.d.ts").CuePayload} CuePayload */

export const settingsSchema = z.object({
  flashes: z.enum(["soften", "off"]),
  loud: z.enum(["cap", "off"]),
  scares: z.enum(["headsup", "off"]),
  ad: z.enum(["on", "off"]),
});

export const settingsPatchSchema = settingsSchema.partial();

/** @type {Readonly<LensSettings>} */
export const NO_SETTINGS = Object.freeze({
  flashes: "off",
  loud: "off",
  scares: "off",
  ad: "off",
});

/**
 * The key two names share when they differ only in case or surrounding space.
 * @param {string} name
 */
export function personKey(name) {
  return name.trim().toLowerCase();
}

/** The value of each setting that protects, i.e. that is not "off". */
const ACTIVE = /** @type {const} */ ({
  flashes: "soften",
  loud: "cap",
  scares: "headsup",
  ad: "on",
});

/**
 * The combined lens: a setting is active if it is active for anyone on the couch.
 * @param {Iterable<LensSettings>} list
 * @returns {LensSettings}
 */
export function combineLens(list) {
  const combined = { ...NO_SETTINGS };
  for (const settings of list) {
    for (const key of /** @type {(keyof LensSettings)[]} */ (Object.keys(ACTIVE))) {
      if (settings[key] === ACTIVE[key]) {
        /** @type {Record<string, string>} */ (combined)[key] = ACTIVE[key];
      }
    }
  }
  return combined;
}

/**
 * Applies explicitly given settings over a base, leaving the rest untouched.
 * @param {LensSettings} base
 * @param {Partial<LensSettings> | undefined} patch
 * @returns {LensSettings}
 */
export function applyPatch(base, patch) {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value !== undefined) /** @type {Record<string, string>} */ (next)[key] = value;
  }
  return next;
}

/**
 * How a lens handles a cue, following the lens-to-behavior table.
 * @param {LensSettings} settings
 * @param {Pick<CuePayload, "type">} cue
 * @returns {("dim" | "comfort-audio" | "heads-up")[]}
 */
export function handlingFor(settings, cue) {
  /** @type {("dim" | "comfort-audio" | "heads-up")[]} */
  const handling = [];
  if (cue.type === "flash" && settings.flashes === "soften") handling.push("dim");
  if (cue.type === "loud" && settings.loud === "cap") handling.push("comfort-audio");
  if ((cue.type === "loud" || cue.type === "scare") && settings.scares === "headsup") {
    handling.push("heads-up");
  }
  return handling;
}
