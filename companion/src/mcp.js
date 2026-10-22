import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { buildComfortReport } from "./comfort.js";
import { NO_SETTINGS, applyPatch, combineLens, personKey, settingsPatchSchema, settingsSchema } from "./lens.js";
import { CARD_HTML, CARD_META, CARD_URI } from "./ui/card.js";
import { VERSION } from "./version.js";

/** @typedef {import("./contracts.d.ts").LensPerson} LensPerson */
/** @typedef {import("./contracts.d.ts").LensMessage} LensMessage */
/** @typedef {import("./catalog.js").Catalog} Catalog */
/** @typedef {import("./relay.js").Relay} Relay */
/** @typedef {import("./store/index.js").PreferenceStore} PreferenceStore */

const INSTRUCTIONS = [
  "Comfort settings for films, per person: flashing images, sudden loud sounds and scares.",
  "Use check_title_comfort to answer whether a film suits the people watching.",
  "Use set_tonight_lens to change what the TV does for tonight's couch, and remember_preference to save a person's settings for good.",
  "These are comfort settings, not medical advice.",
].join(" ");

const personName = z.string().trim().min(1).max(60);

const momentSchema = z.object({
  id: z.string(),
  type: z.enum(["flash", "loud", "scare"]),
  start: z.number(),
  end: z.number(),
  intensity: z.number(),
  preview: z.string(),
  handling: z.array(z.enum(["dim", "comfort-audio", "heads-up"])),
  by: z.array(z.string()),
});

const comfortOutput = {
  found: z.boolean(),
  summary: z.string(),
  title: z
    .object({ id: z.string(), name: z.string(), durationS: z.number(), iris: z.string() })
    .optional(),
  viewers: z.array(z.object({ name: z.string(), settings: settingsSchema })).optional(),
  unknownViewers: z.array(z.string()).optional(),
  lens: settingsSchema.optional(),
  moments: z.array(momentSchema).optional(),
  counts: z
    .object({
      moments: z.number(),
      handled: z.number(),
      notHandled: z.number(),
      peakIntensity: z.number(),
    })
    .optional(),
  available: z.array(z.string()).optional(),
};

const lensOutput = {
  people: z.array(z.object({ name: z.string(), settings: settingsSchema })),
  settings: settingsSchema,
  tvConnected: z.boolean(),
  summary: z.string(),
};

const preferenceOutput = {
  name: z.string(),
  settings: settingsSchema,
  created: z.boolean(),
  summary: z.string(),
};

/**
 * One tool result: the structured content, the same content as text for clients that only
 * read text, and optionally the card that renders it.
 * @param {Record<string, unknown>} structured
 * @param {{ card?: boolean, isError?: boolean }} [options]
 */
function result(structured, { card = false, isError = false } = {}) {
  return {
    content: [{ type: /** @type {const} */ ("text"), text: JSON.stringify(structured) }],
    structuredContent: structured,
    ...(isError && { isError }),
    ...(card && { _meta: { ui: { resourceUri: CARD_URI } } }),
  };
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
function problem(message, extra = {}) {
  return {
    content: [{ type: /** @type {const} */ ("text"), text: message }],
    isError: true,
    ...(Object.keys(extra).length > 0 && { structuredContent: { ...extra, summary: message } }),
  };
}

/**
 * Logs how long a tool took, so the response-time budget can be watched.
 * @template {unknown[]} A
 * @template R
 * @param {string} name
 * @param {(...args: A) => Promise<R>} handler
 * @returns {(...args: A) => Promise<R>}
 */
function timed(name, handler) {
  return async (...args) => {
    const started = performance.now();
    try {
      return await handler(...args);
    } finally {
      console.info(`tool ${name} took ${Math.round(performance.now() - started)} ms`);
    }
  };
}

/**
 * Builds an MCP server. Servers are cheap, so the HTTP layer makes one per request.
 * @param {{ catalog: Catalog, store: PreferenceStore, relay: Relay, household: string }} deps
 */
export function createMcpServer({ catalog, store, relay, household }) {
  const server = new McpServer(
    { name: "everyseat-companion", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerAppResource(
    server,
    "Comfort check card",
    CARD_URI,
    { description: "Intensity timeline for a film and who it suits tonight", mimeType: RESOURCE_MIME_TYPE },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: CARD_HTML, _meta: { ui: CARD_META } },
      ],
    }),
  );

  /**
   * People by name: tonight's settings when they are on tonight's couch, otherwise their
   * saved ones.
   * @param {string[]} names
   */
  async function resolvePeople(names) {
    const tonight = await store.getTonight(household);
    /** @type {LensPerson[]} */
    const found = [];
    /** @type {string[]} */
    const unknown = [];
    for (const name of names) {
      const onCouch = tonight?.people.find((person) => personKey(person.name) === personKey(name));
      const person = onCouch ?? (await store.getPerson(household, name));
      if (person) found.push(person);
      else unknown.push(name);
    }
    return { found, unknown, tonight };
  }

  registerAppTool(
    server,
    "check_title_comfort",
    {
      title: "Check a title's comfort",
      description:
        "Says whether a film suits the people watching: its flashing, sudden loud and scary moments, " +
        "and which of them each person's comfort settings already cover. Shows an intensity timeline card. " +
        "Use the names the person gave; leave viewers out to use tonight's couch.",
      inputSchema: {
        title: z.string().trim().min(1).max(200).describe("The film's name, as the person said it."),
        viewers: z
          .array(personName)
          .max(12)
          .optional()
          .describe("Names of the people watching, such as Leo. Leave out to use tonight's couch."),
      },
      outputSchema: comfortOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: CARD_URI } },
    },
    timed("check_title_comfort", async ({ title: query, viewers }) => {
      const title = catalog.find(query);
      if (!title) {
        const available = catalog.titles.map((entry) => entry.name);
        return result(
          {
            found: false,
            summary: `There is no comfort analysis for "${query}" yet. Available: ${available.join(", ")}.`,
            available,
          },
          { card: true },
        );
      }

      let people;
      let unknown = /** @type {string[]} */ ([]);
      if (viewers && viewers.length > 0) {
        ({ found: people, unknown } = await resolvePeople(viewers));
      } else {
        people = (await store.getTonight(household))?.people ?? [];
      }
      return result(buildComfortReport(title, people, unknown), { card: true });
    }),
  );

  server.registerTool(
    "set_tonight_lens",
    {
      title: "Set tonight's comfort settings",
      description:
        "Changes what the TV does for tonight's couch, live. Name who is on the couch, and give any " +
        "settings to change for them tonight (flashes: soften or off; loud: cap or off; scares: headsup or off; " +
        "ad: on or off). Settings you leave out stay as they are. If the couch was set earlier tonight, " +
        "people can be left out.",
      inputSchema: {
        people: z.array(personName).max(12).optional().describe("Names of the people on the couch tonight."),
        settings: settingsPatchSchema
          .optional()
          .describe("Settings to change tonight for everyone named; others stay as they are."),
      },
      outputSchema: lensOutput,
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    timed("set_tonight_lens", async ({ people: names, settings }) => {
      const tonight = await store.getTonight(household);
      const wanted = names && names.length > 0 ? names : (tonight?.people.map((p) => p.name) ?? []);
      if (wanted.length === 0) {
        return problem("Who is on the couch tonight? Name the people, for example Leo.");
      }
      const { found, unknown } = await resolvePeople(wanted);
      if (unknown.length > 0) {
        const known = (await store.listPeople(household)).map((person) => person.name);
        return problem(
          `I don't have settings for ${unknown.join(", ")}. People I know: ${known.join(", ")}.`,
        );
      }

      /** @type {LensPerson[]} */
      const people = found.map((person) => ({
        name: person.name,
        settings: applyPatch(person.settings, settings),
      }));
      /** @type {LensMessage} */
      const lens = { t: "lens", people, settings: combineLens(people.map((p) => p.settings)) };
      await store.saveTonight(household, lens);
      const delivered = relay.sendLens(household, lens);

      const who = people.map((person) => person.name).join(", ");
      return result({
        people,
        settings: lens.settings,
        tvConnected: delivered > 0,
        summary:
          delivered > 0
            ? `Tonight's couch is ${who}. The TV is updated.`
            : `Tonight's couch is ${who}. The TV isn't connected right now, so it hasn't been updated.`,
      });
    }),
  );

  server.registerTool(
    "remember_preference",
    {
      title: "Remember a person's comfort settings",
      description:
        "Saves comfort settings for a person so they apply every time, not just tonight. " +
        "Settings you leave out stay as they were; a new person starts with everything off.",
      inputSchema: {
        person: personName.describe("The person's name."),
        settings: settingsPatchSchema.describe("The settings to save."),
      },
      outputSchema: preferenceOutput,
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    timed("remember_preference", async ({ person, settings }) => {
      const existing = await store.getPerson(household, person);
      const saved = {
        name: existing?.name ?? person,
        settings: applyPatch(existing?.settings ?? NO_SETTINGS, settings),
      };
      await store.savePerson(household, saved);
      return result({
        name: saved.name,
        settings: saved.settings,
        created: !existing,
        summary: `Saved ${saved.name}'s comfort settings.`,
      });
    }),
  );

  return server;
}
