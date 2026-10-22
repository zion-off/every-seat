import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { personKey, settingsSchema } from "../lens.js";

/** @typedef {import("../contracts.d.ts").LensPerson} LensPerson */
/** @typedef {import("../contracts.d.ts").LensMessage} LensMessage */
/** @typedef {import("./index.js").PreferenceStore} PreferenceStore */

const personSchema = z.object({ name: z.string().min(1), settings: settingsSchema });

const seedSchema = z.record(z.string(), z.object({ people: z.array(personSchema) }));

const stateSchema = z.object({
  households: z.record(
    z.string(),
    z.object({
      people: z.record(z.string(), personSchema).default({}),
      tonight: z.custom((value) => typeof value === "object" && value !== null).optional(),
    }),
  ),
});

/** @typedef {z.infer<typeof stateSchema>} State */

/**
 * Keeps saved settings in one JSON file. A seed file supplies the people each household
 * starts with; anything saved afterwards is written to the state file and wins over the seed.
 * Reads are served from memory.
 *
 * @implements {PreferenceStore}
 */
export class JsonStore {
  /**
   * @param {string} file
   * @param {z.infer<typeof seedSchema>} seed
   * @param {State} state
   */
  constructor(file, seed, state) {
    this.file = file;
    this.seed = seed;
    this.state = state;
    /** @type {Promise<void>} */
    this.writing = Promise.resolve();
  }

  /** @param {{ file: string, seedFile: string }} options */
  static async create({ file, seedFile }) {
    const seed = seedSchema.parse(JSON.parse(await readFile(seedFile, "utf8")));
    /** @type {State} */
    let state = { households: {} };
    try {
      state = stateSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") {
        throw new Error(`cannot read the preference file ${file}`, { cause: error });
      }
    }
    return new JsonStore(file, seed, state);
  }

  /** @param {string} household */
  household(household) {
    return (this.state.households[household] ??= { people: {} });
  }

  /** @param {string} household */
  async listPeople(household) {
    /** @type {Map<string, LensPerson>} */
    const people = new Map();
    for (const person of this.seed[household]?.people ?? []) people.set(personKey(person.name), person);
    for (const [key, person] of Object.entries(this.state.households[household]?.people ?? {})) {
      people.set(key, person);
    }
    return structuredClone([...people.values()]);
  }

  /**
   * @param {string} household
   * @param {string} name
   */
  async getPerson(household, name) {
    const key = personKey(name);
    return (await this.listPeople(household)).find((person) => personKey(person.name) === key);
  }

  /**
   * @param {string} household
   * @param {LensPerson} person
   */
  async savePerson(household, person) {
    this.household(household).people[personKey(person.name)] = structuredClone(person);
    await this.persist();
  }

  /** @param {string} household */
  async getTonight(household) {
    const tonight = this.state.households[household]?.tonight;
    return /** @type {LensMessage | undefined} */ (tonight && structuredClone(tonight));
  }

  /**
   * @param {string} household
   * @param {LensMessage} lens
   */
  async saveTonight(household, lens) {
    this.household(household).tonight = structuredClone(lens);
    await this.persist();
  }

  /** Writes the state file through a temporary file so a reader never sees half of it. */
  async persist() {
    const json = JSON.stringify(this.state, null, 2) + "\n";
    const write = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, json);
      await rename(temp, this.file);
    });
    this.writing = write.catch(() => {});
    await write;
  }
}
