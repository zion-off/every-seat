import { readFile } from "node:fs/promises";
import { z } from "zod";
import { settingsSchema } from "../lens.js";

export const personSchema = z.object({ name: z.string().min(1), settings: settingsSchema });

const seedSchema = z.record(z.string(), z.object({ people: z.array(personSchema) }));

/** @typedef {z.infer<typeof seedSchema>} Seed */

/**
 * The people each household starts with. Saved settings are layered on top by the store.
 * @param {string} seedFile
 * @returns {Promise<Seed>}
 */
export async function loadSeed(seedFile) {
  return seedSchema.parse(JSON.parse(await readFile(seedFile, "utf8")));
}
