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
 */

const metadataSchema = z.record(
  z.string(),
  z.object({
    name: z.string(),
    aliases: z.array(z.string()).default([]),
    durationS: z.number().positive().optional(),
  }),
);

export class Catalog {
  /** @param {Title[]} titles */
  constructor(titles) {
    this.titles = titles;
  }

  /** @param {string} id */
  get(id) {
    return this.titles.find((title) => title.id === id);
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
      let parsed;
      try {
        parsed = parseSenseVtt(await readFile(file, "utf8"));
      } catch (error) {
        console.warn(`skipping ${path.basename(file)}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
      const { header, cues, problems } = parsed;
      for (const problem of problems) console.warn(`${path.basename(file)}: ${problem}`);

      const known = metadata[header.title];
      const lastEnd = Math.max(0, ...cues.map((cue) => cue.end));
      byId.set(header.title, {
        id: header.title,
        name: known?.name ?? titleCase(header.title),
        aliases: known?.aliases ?? [],
        durationS: known?.durationS ?? Math.ceil(lastEnd + 30),
        fps: header.fps,
        iris: header.iris,
        cues: cues.sort((a, b) => a.start - b.start),
        file: path.basename(file),
      });
    }
  }
  return new Catalog([...byId.values()]);
}
