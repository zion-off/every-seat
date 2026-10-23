import { loadDemoHousehold } from "./store/seed.js";

/** @typedef {import("./relay.js").Relay} Relay */
/** @typedef {import("./store/index.js").PreferenceStore} PreferenceStore */

/**
 * Sends the stored household to the TVs and makes it the one the relay replays.
 * @param {{ store: PreferenceStore, relay: Relay, household: string }} deps
 * @returns {Promise<number>} How many TVs it went to.
 */
export async function pushHousehold({ store, relay, household }) {
  const { people, updatedAt } = await store.getHousehold(household);
  return relay.sendHousehold(household, { t: "household", people, updatedAt });
}

/**
 * At start: gives the relay what the store holds, so a TV that connects before anyone edits
 * still receives it. With the demo option, an empty household that has never been edited is
 * first filled from the demo file.
 * @param {{ store: PreferenceStore, relay: Relay, household: string, demoFile?: string }} deps
 */
export async function restoreHousehold({ store, relay, household, demoFile }) {
  let state = await store.getHousehold(household);
  if (demoFile && state.people.length === 0 && state.updatedAt === 0) {
    await store.setHousehold(household, await loadDemoHousehold(demoFile), Date.now());
    state = await store.getHousehold(household);
  }
  if (state.updatedAt > 0) {
    relay.lastHousehold.set(household, { t: "household", people: state.people, updatedAt: state.updatedAt });
  }
  const tonight = await store.getTonight(household);
  if (tonight) relay.lastLens.set(household, tonight);
}
