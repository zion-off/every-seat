import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { personKey } from "../lens.js";
import { personSchema } from "./seed.js";

/** @typedef {import("../contracts.d.ts").LensPerson} LensPerson */
/** @typedef {import("../contracts.d.ts").LensMessage} LensMessage */
/** @typedef {import("./index.js").PreferenceStore} PreferenceStore */

const stateSchema = z.object({
  households: z.record(
    z.string(),
    z.object({
      people: z.record(z.string(), personSchema).default({}),
      updatedAt: z.number().int().min(0).default(0),
      tonight: z.custom((value) => typeof value === "object" && value !== null).optional(),
    }),
  ),
});

/** @typedef {z.infer<typeof stateSchema>} State */

/**
 * Keeps saved settings in one JSON file. A household starts empty. Reads are served from memory.
 *
 * @implements {PreferenceStore}
 */
export class JsonStore {
  /**
   * @param {string} file
   * @param {State} state
   */
  constructor(file, state) {
    this.file = file;
    this.state = state;
    /** @type {Promise<void>} */
    this.writing = Promise.resolve();
  }

  /** @param {{ file: string }} options */
  static async create({ file }) {
    /** @type {State} */
    let state = { households: {} };
    try {
      state = stateSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") {
        throw new Error(`cannot read the preference file ${file}`, { cause: error });
      }
    }
    return new JsonStore(file, state);
  }

  /** @param {string} household */
  household(household) {
    return (this.state.households[household] ??= { people: {}, updatedAt: 0 });
  }

  /** @param {string} household */
  async listPeople(household) {
    return structuredClone(Object.values(this.state.households[household]?.people ?? {}));
  }

  /** @param {string} household */
  async getHousehold(household) {
    return { people: await this.listPeople(household), updatedAt: this.state.households[household]?.updatedAt ?? 0 };
  }

  /**
   * @param {string} household
   * @param {LensPerson[]} people
   * @param {number} updatedAt
   */
  async setHousehold(household, people, updatedAt) {
    const entry = this.household(household);
    entry.people = Object.fromEntries(people.map((person) => [personKey(person.name), structuredClone(person)]));
    entry.updatedAt = updatedAt;
    await this.persist();
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
    const entry = this.household(household);
    entry.people[personKey(person.name)] = structuredClone(person);
    entry.updatedAt = Math.max(Date.now(), entry.updatedAt + 1);
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
