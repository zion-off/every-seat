import { readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseSenseVtt } from "./sensevtt.js";

/** @typedef {import("./contracts.d.ts").CuePayload} CuePayload */
/** @typedef {import("./contracts.d.ts").IrisSummary} IrisSummary */

/**
 * @typedef {object} Title
 * @property {string} id
 * @property {string} name
 * @property {string[]} aliases
 * @property {number} durationS
 * @property {number} fps
 * @property {IrisSummary} iris
 * @property {CuePayload[]} cues Sorted by start time.
 * @property {string} file The cue file's name, without its directory.
 * @property {string} path The cue file's full path, read again when its modification time changes.
 * @property {number} mtimeMs The cue file's modification time when it was last read.
 */

const metadataSchema = z.record(
  z.string(),
  z.object({
    name: z.string(),
    aliases: z.array(z.string()).default([]),
    durationS: z.number().positive().optional(),
  }),
);

/** @typedef {z.infer<typeof metadataSchema>} Metadata */

/**
 * Builds a title from a cue file's text; throws when the file is not a cue file.
 * @param {string} file
 * @param {string} text
 * @param {number} mtimeMs
 * @param {Metadata} metadata
 * @returns {Title}
 */
function readTitle(file, text, mtimeMs, metadata) {
  const { header, cues, problems } = parseSenseVtt(text);
  for (const problem of problems) console.warn(`${path.basename(file)}: ${problem}`);
  const known = metadata[header.title];
  const lastEnd = Math.max(0, ...cues.map((cue) => cue.end));
  return {
    id: header.title,
    name: known?.name ?? titleCase(header.title),
    aliases: known?.aliases ?? [],
    durationS: known?.durationS ?? Math.ceil(lastEnd + 30),
    fps: header.fps,
    iris: header.iris,
    cues: cues.sort((a, b) => a.start - b.start),
    file: path.basename(file),
    path: file,
    mtimeMs,
  };
}

export class Catalog {
  /**
   * @param {Title[]} titles
   * @param {Metadata} [metadata] Names and aliases, used when a cue file is read again.
   */
  constructor(titles, metadata = {}) {
    this.titles = titles;
    this.metadata = metadata;
  }

  /**
   * Re-reads a title's cue file when its modification time has changed, so what is served never
   * lags the file. The title object is updated in place; a file that no longer parses is ignored.
   * @param {Title} title
   */
  refresh(title) {
    let mtimeMs;
    try {
      mtimeMs = statSync(title.path).mtimeMs;
    } catch {
      return title;
    }
    if (mtimeMs === title.mtimeMs) return title;
    try {
      const fresh = readTitle(title.path, readFileSync(title.path, "utf8"), mtimeMs, this.metadata);
      if (fresh && fresh.id === title.id) Object.assign(title, fresh);
      else title.mtimeMs = mtimeMs;
    } catch (error) {
      console.warn(`${title.file}: kept the earlier cues: ${error instanceof Error ? error.message : error}`);
      title.mtimeMs = mtimeMs;
    }
    return title;
  }

  /** @param {string} id */
  get(id) {
    const title = this.titles.find((candidate) => candidate.id === id);
    return title && this.refresh(title);
  }

  /**
   * Finds a title from what a person said: the id, the name or an alias, ignoring case,
   * punctuation and a leading article.
   * @param {string} query
   */
  find(query) {
    const wanted = normalize(query);
    if (!wanted) return undefined;
    let best;
    let bestScore = 0;
    for (const title of this.titles) {
      this.refresh(title);
      const score = Math.max(
        ...[title.id, title.name, ...title.aliases].map((name) => similarity(wanted, normalize(name))),
      );
      if (score > bestScore) {
        best = title;
        bestScore = score;
      }
    }
    return bestScore >= 0.6 ? best : undefined;
  }
}

/** @param {string} text */
function normalize(text) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

/**
 * 1 for equal names, 0.8 when one contains the other, otherwise the share of words in common.
 * @param {string} a
 * @param {string} b
 */
function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return 0.8;
  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  return shared / Math.max(wordsA.size, wordsB.size);
}

/** @param {string} id */
function titleCase(id) {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Recursively lists `.sensevtt` files below a directory; a missing directory has none.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function findCueFiles(dir) {
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return findCueFiles(full);
      return entry.name.endsWith(".sensevtt") ? [full] : [];
    }),
  );
  return found.flat().sort();
}

/**
 * Reads every cue file below `cueDirs`. A title found in a later directory replaces one
 * of the same id from an earlier directory.
 * @param {{ cueDirs: string[], titlesFile: string }} options
 * @returns {Promise<Catalog>}
 */
export async function loadCatalog({ cueDirs, titlesFile }) {
  const metadata = metadataSchema.parse(JSON.parse(await readFile(titlesFile, "utf8")));
  /** @type {Map<string, Title>} */
  const byId = new Map();

  for (const dir of cueDirs) {
    for (const file of await findCueFiles(dir)) {
      let title;
      try {
        title = readTitle(file, await readFile(file, "utf8"), statSync(file).mtimeMs, metadata);
      } catch (error) {
        console.warn(`skipping ${path.basename(file)}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
      if (title) byId.set(title.id, title);
    }
  }
  return new Catalog([...byId.values()], metadata);
}
