import { z } from "zod";

/** @typedef {import("./contracts.d.ts").CuePayload} CuePayload */
/** @typedef {import("./contracts.d.ts").SenseVttHeader} SenseVttHeader */

const headerSchema = z.object({
  version: z.literal(1),
  title: z.string().regex(/^[a-z0-9-]+$/),
  analyzer: z.string(),
  source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  fps: z.number().int().min(1).max(120),
  iris: z.object({
    verdict: z.enum(["PASS", "PASS_WITH_WARNING", "FAIL", "NOT_RUN"]),
    max_luminance_swing: z.number().optional(),
  }),
});

const cueSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["flash", "loud", "scare", "ad"]),
  start: z.number().min(0),
  end: z.number().min(0),
  anchor: z.enum(["iris", "onset", "cut", "approx"]),
  intensity: z.number().int().min(1).max(5),
  preview: z.string().min(1).max(140),
  lead_s: z.number().min(0).max(30).optional(),
  pre_s: z.number().min(0).max(10).optional(),
  post_s: z.number().min(0).max(10).optional(),
  audio_ref: z.object({ uri: z.string().min(1), duration_s: z.number().positive() }).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

const TIMING = /^\d{2,}:\d{2}:\d{2}\.\d{3} --> \d{2,}:\d{2}:\d{2}\.\d{3}$/;

/**
 * Reads a SenseVTT file: WebVTT whose cue payloads are one line of JSON, after a
 * `NOTE everyseat-header` block holding one line of JSON. Throws on a bad header; cues
 * that do not parse are skipped and reported in `problems`.
 * @param {string} text
 * @returns {{ header: SenseVttHeader, cues: CuePayload[], problems: string[] }}
 */
export function parseSenseVtt(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0] !== "WEBVTT") throw new Error("not a WebVTT file");

  /** @type {SenseVttHeader | undefined} */
  let header;
  /** @type {CuePayload[]} */
  const cues = [];
  /** @type {string[]} */
  const problems = [];

  for (const block of splitBlocks(lines.slice(1))) {
    const [first = "", ...rest] = block.lines;
    if (first === "NOTE everyseat-header") {
      const parsed = headerSchema.safeParse(parseJson(rest.join("\n")));
      if (!parsed.success) throw new Error(`bad header: ${parsed.error.issues[0]?.message}`);
      header = parsed.data;
      continue;
    }
    if (first.startsWith("NOTE")) continue;

    const timingAt = block.lines.findIndex((line) => TIMING.test(line));
    const payload = block.lines.slice(timingAt + 1).join("\n");
    const parsed = timingAt < 0 ? undefined : cueSchema.safeParse(parseJson(payload));
    if (!parsed?.success) {
      problems.push(`line ${block.line}: cue skipped`);
      continue;
    }
    cues.push(parsed.data);
  }

  if (!header) throw new Error("missing everyseat-header block");
  return { header, cues, problems };
}

/**
 * @param {string[]} lines
 * @returns {{ line: number, lines: string[] }[]}
 */
function splitBlocks(lines) {
  /** @type {{ line: number, lines: string[] }[]} */
  const blocks = [];
  /** @type {{ line: number, lines: string[] } | undefined} */
  let current;
  lines.forEach((text, index) => {
    if (text.trim() === "") {
      current = undefined;
      return;
    }
    if (!current) {
      current = { line: index + 2, lines: [] };
      blocks.push(current);
    }
    current.lines.push(text);
  });
  return blocks;
}

/** @param {string} text */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
