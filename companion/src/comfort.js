import { combineLens, handlingFor } from "./lens.js";

/** @typedef {import("./contracts.d.ts").LensPerson} LensPerson */
/** @typedef {import("./contracts.d.ts").LensSettings} LensSettings */
/** @typedef {import("./catalog.js").Title} Title */

/**
 * @typedef {object} Moment
 * @property {string} id
 * @property {"flash" | "loud" | "scare"} type
 * @property {number} start
 * @property {number} end
 * @property {number} intensity
 * @property {string} preview
 * @property {("dim" | "comfort-audio" | "heads-up")[]} handling What the viewers' combined settings do about it; empty if nothing.
 * @property {string[]} by The viewers whose settings handle it.
 */

/**
 * `m:ss`, or `h:mm:ss` from an hour up.
 * @param {number} seconds
 */
export function clock(seconds) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** @param {string[]} names */
function joinNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const TYPE_WORDS = { flash: "flashing", loud: "loud sound", scare: "scare" };

/**
 * What a title holds and how much of it the viewers' settings cover. The result is the
 * tool's structured content, which the comfort card renders.
 *
 * @param {Title} title
 * @param {LensPerson[]} viewers
 * @param {string[]} [unknownViewers] Names that were asked about but have no saved settings.
 */
export function buildComfortReport(title, viewers, unknownViewers = []) {
  const lens = combineLens(viewers.map((viewer) => viewer.settings));

  /** @type {Moment[]} */
  const moments = [];
  for (const cue of title.cues) {
    if (cue.type === "ad") continue;
    moments.push({
      id: cue.id,
      type: cue.type,
      start: cue.start,
      end: cue.end,
      intensity: cue.intensity,
      preview: cue.preview,
      handling: handlingFor(lens, cue),
      by: viewers
        .filter((viewer) => handlingFor(viewer.settings, cue).length > 0)
        .map((viewer) => viewer.name),
    });
  }

  const handled = moments.filter((moment) => moment.handling.length > 0);
  const open = moments.filter((moment) => moment.handling.length === 0);
  const summary = {
    moments: moments.length,
    handled: handled.length,
    notHandled: open.length,
    peakIntensity: Math.max(0, ...moments.map((moment) => moment.intensity)),
  };

  return {
    found: true,
    title: { id: title.id, name: title.name, durationS: title.durationS, iris: title.iris.verdict },
    viewers: viewers.map((viewer) => ({ name: viewer.name, settings: viewer.settings })),
    unknownViewers,
    lens,
    moments,
    counts: summary,
    summary: [
      describe(title, viewers, moments, open),
      unknownViewers.length > 0 && `I don't have settings for ${joinNames(unknownViewers)}.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * A short plain-English answer, safe to read aloud.
 * @param {Title} title
 * @param {LensPerson[]} viewers
 * @param {Moment[]} moments
 * @param {Moment[]} open
 */
function describe(title, viewers, moments, open) {
  if (moments.length === 0) {
    return `${title.name} has no flashing, loud or scary moments in its analysis.`;
  }
  const count = `${moments.length} ${moments.length === 1 ? "moment" : "moments"}`;
  const opening = `${title.name} has ${count} worth knowing about.`;
  if (viewers.length === 0) {
    return `${opening} Nobody is on the couch yet, so nothing is set up for it.`;
  }
  const who = joinNames(viewers.map((viewer) => viewer.name));
  if (open.length === 0) return `${opening} Everything is covered for ${who}.`;
  const listed = open
    .slice(0, 3)
    .map((moment) => `a ${TYPE_WORDS[moment.type]} at ${clock(moment.start)}`)
    .join(", ");
  const rest = open.length > 3 ? ` and ${open.length - 3} more` : "";
  return `${opening} For ${who}, ${moments.length - open.length} ${moments.length - open.length === 1 ? "is" : "are"} covered; not covered: ${listed}${rest}.`;
}
