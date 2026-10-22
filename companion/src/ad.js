import express from "express";
import { z } from "zod";

/** @typedef {import("./config.js").Config} Config */
/** @typedef {import("./catalog.js").Title} Title */

/** Clip addresses in a cue file are relative paths under `ad/`; anything else is not served. */
const CLIP_URI = /^ad\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * @typedef {object} AdClip
 * @property {string} id
 * @property {number} start Media time in seconds when the description starts.
 * @property {number} duration Length of the audio in seconds.
 * @property {string} text What the clip says.
 * @property {string} url Where the phone fetches the audio from.
 */

/**
 * The description clips of a title, in playing order.
 * @param {Title} title
 * @returns {AdClip[]}
 */
export function adClips(title) {
  /** @type {AdClip[]} */
  const clips = [];
  for (const cue of title.cues) {
    const ref = cue.audio_ref;
    if (cue.type !== "ad" || !ref) continue;
    if (!CLIP_URI.test(ref.uri) || ref.uri.split("/").some((part) => part === "." || part === "..")) {
      console.warn(`${title.file}: ad cue ${cue.id} skipped: unsupported clip address`);
      continue;
    }
    const text = cue.evidence?.text;
    clips.push({
      id: cue.id,
      start: cue.start,
      duration: ref.duration_s,
      text: typeof text === "string" ? text : cue.preview,
      url: `/${ref.uri}`,
    });
  }
  return clips;
}

const reportSchema = z.strictObject({
  title: z.string().max(100),
  clip: z.string().max(100),
  plannedMediaS: z.number(),
  errorMs: z.number(),
  lateMs: z.number(),
  userOffsetMs: z.number(),
  relayOffsetMs: z.number(),
  rttMs: z.number(),
  latencyMs: z.number(),
  note: z.string().max(200).optional(),
});

/**
 * The phone page's routes: the page itself, the description clips, and a log line per clip.
 * @param {express.Express} app
 * @param {{ config: Config, catalog: import("./catalog.js").Catalog, requireKey: express.RequestHandler }} deps
 */
export function mountAd(app, { config, catalog, requireKey }) {
  app.use("/phone", express.static(config.phoneDir));
  app.use("/ad", requireKey, express.static(config.adDir, { index: false }));

  app.get("/api/ad/:title", requireKey, (req, res) => {
    const title = catalog.get(String(req.params.title));
    if (!title) {
      res.status(404).json({ error: "unknown title" });
      return;
    }
    res.json({ title: title.id, name: title.name, clips: adClips(title) });
  });

  // The phone reports how closely each clip landed; the line is for whoever is tuning the sync.
  app.post("/api/ad/report", requireKey, express.json({ limit: "4kb" }), (req, res) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad report" });
      return;
    }
    const r = parsed.data;
    console.info(
      `phone: ${r.title} ${r.clip} at ${r.plannedMediaS.toFixed(2)} s, ` +
        `sync error ${r.errorMs.toFixed(0)} ms, late ${r.lateMs.toFixed(0)} ms, ` +
        `user offset ${r.userOffsetMs} ms, relay offset ${r.relayOffsetMs.toFixed(0)} ms, ` +
        `rtt ${r.rttMs.toFixed(0)} ms, output latency ${r.latencyMs.toFixed(0)} ms` +
        (r.note ? ` (${r.note})` : ""),
    );
    res.status(204).end();
  });
}
