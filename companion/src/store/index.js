import { JsonStore } from "./json.js";

/** @typedef {import("../contracts.d.ts").LensPerson} LensPerson */
/** @typedef {import("../contracts.d.ts").LensMessage} LensMessage */

/**
 * Where a household's comfort settings live. Every method is async so a hosted backend can
 * stand in for the local file.
 *
 * @typedef {object} PreferenceStore
 * @property {(household: string) => Promise<LensPerson[]>} listPeople
 *   Everyone in the household, with their saved comfort settings.
 * @property {(household: string, name: string) => Promise<LensPerson | undefined>} getPerson
 *   One person by name, ignoring case; undefined if unknown.
 * @property {(household: string, person: LensPerson) => Promise<void>} savePerson
 *   Creates or replaces a person's saved settings.
 * @property {(household: string) => Promise<LensMessage | undefined>} getTonight
 *   The lens last set for tonight's couch.
 * @property {(household: string, lens: LensMessage) => Promise<void>} saveTonight
 *   Remembers tonight's lens.
 */

/**
 * @typedef {{ kind: "json", file: string, seedFile: string }
 *   | { kind: "dynamodb", table: string, region: string, endpoint?: string, seedFile: string }} StoreOptions
 */

/**
 * @param {StoreOptions} options
 * @returns {Promise<PreferenceStore>}
 */
export async function createStore(options) {
  if (options.kind === "dynamodb") {
    const { DynamoStore } = await import("./dynamo.js");
    return DynamoStore.create(options);
  }
  return JsonStore.create(options);
}
