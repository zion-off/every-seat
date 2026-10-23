import { readFile } from "node:fs/promises";
import { z } from "zod";
import { MAX_PEOPLE, settingsSchema } from "../lens.js";

export const personSchema = z.object({ name: z.string().min(1), settings: settingsSchema });

const demoSchema = z.object({ people: z.array(personSchema).max(MAX_PEOPLE) });

/**
 * The demo household: a file of people to start a household with. It is only read when the
 * server is started with `EVERYSEAT_DEMO_HOUSEHOLD=1`.
 * @param {string} file
 */
export async function loadDemoHousehold(file) {
  return demoSchema.parse(JSON.parse(await readFile(file, "utf8"))).people;
}
