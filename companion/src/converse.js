import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createMcpServer } from "./mcp.js";

/** @typedef {import("./config.js").Config} Config */
/** @typedef {import("@aws-sdk/client-bedrock-runtime").Message} Message */
/** @typedef {import("@aws-sdk/client-bedrock-runtime").ContentBlock} ContentBlock */
/** @typedef {import("@modelcontextprotocol/sdk/types.js").CallToolResult} CallToolResult */

/** Model calls per request: one to pick tools, and up to two more if a tool reports a failure. */
const MAX_MODEL_CALLS = 3;
const MAX_OUTPUT_TOKENS = 600;

export const converseRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(1000),
  history: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(2000),
      }),
    )
    .max(20)
    .default([]),
});

const SYSTEM_PROMPT = `You are the voice assistant for a living-room TV's comfort feature. The TV has already analysed each film for flashing lights, sudden loud moments and scares, and softens or warns about each one for whoever is on the couch.

Your replies are spoken aloud: one or two short sentences, plain words, no lists, no markdown, no emoji.

Use the tools for anything about a film or the TV. Never guess what is in a film.
- check_title_comfort: when asked whether a film is okay or suitable for someone. Pass the names the person gave. If no name was given, leave viewers out.
- set_tonight_lens: when asked to change what the TV does tonight, or who is watching. Change only the settings the person asked about and leave the rest out. "Heads-ups" or "warn me" means scares: headsup. "No warnings" means scares: off. "Dim the flashes" means flashes: soften. "Quieter loud moments" means loud: cap. The TV never skips scenes, so "don't skip anything" needs no setting.
- remember_preference: only when asked to remember something for good ("always", "from now on").

Who is meant: use the names in the request. If none, use the people already discussed in this conversation. If none, use tonight's couch below. If you still don't know, ask who is watching.

When a tool reports a problem, fix the call if you can (for example a mistyped name) and try again; otherwise explain it plainly in one sentence. Talk about comfort and what is covered; never call a film safe, and make no medical claims.`;

/**
 * Orders chat turns the way the model needs them: starting with the person, alternating roles.
 * @param {{ role: "user" | "assistant", text: string }[]} history
 * @param {string} message
 * @returns {Message[]}
 */
function toMessages(history, message) {
  /** @type {Message[]} */
  const messages = [];
  for (const turn of [...history, { role: /** @type {const} */ ("user"), text: message }]) {
    const last = messages.at(-1);
    if (last?.role === turn.role) {
      last.content = [{ text: `${last.content?.[0]?.text ?? ""}\n${turn.text}` }];
    } else if (last || turn.role === "user") {
      messages.push({ role: turn.role, content: [{ text: turn.text }] });
    }
  }
  return messages;
}

/**
 * JSON Schema as the model API wants it: no `$schema` marker.
 * @param {Record<string, unknown>} schema
 */
function modelSchema(schema) {
  const copy = { ...schema };
  delete copy.$schema;
  return copy;
}

/** @param {Message | undefined} message */
function textOf(message) {
  const text = (message?.content ?? [])
    .map((block) => block.text ?? "")
    .join(" ")
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .trim();
  return text;
}

/**
 * The sentence a tool wrote for the person to hear.
 * @param {CallToolResult} result
 */
function summaryOf(result) {
  const summary = result.structuredContent?.summary;
  if (typeof summary === "string") return summary;
  const first = result.content[0];
  return first && first.type === "text" ? first.text : "Done.";
}

/**
 * What the model sees of a tool result. It only gets what it needs to word an answer; the
 * card gets the rest.
 * @param {CallToolResult} result
 * @returns {import("@aws-sdk/client-bedrock-runtime").ToolResultContentBlock}
 */
function forModel(result) {
  const first = result.content[0];
  const text = first && first.type === "text" ? first.text : "Done.";
  const structured = result.structuredContent;
  if (result.isError || !structured || typeof structured !== "object") return { text };
  const brief = { .../** @type {Record<string, unknown>} */ (structured) };
  const moments = brief.moments;
  delete brief.lens;
  delete brief.viewers;
  delete brief.moments;
  if (Array.isArray(moments)) brief.momentCount = moments.length;
  return { json: /** @type {any} */ (brief) };
}

/**
 * The credentials guard stops the SDK from quietly falling back to a default profile.
 * @param {NodeJS.ProcessEnv} env
 */
export function hasAwsCredentials(env) {
  return Boolean(
    env.AWS_PROFILE ||
      env.AWS_ACCESS_KEY_ID ||
      env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      env.AWS_WEB_IDENTITY_TOKEN_FILE,
  );
}

/**
 * Turns a sentence into tool calls and a spoken answer: a Bedrock Converse tool loop over the
 * companion's own MCP tools, connected in-process.
 * @param {{
 *   config: Config,
 *   catalog: import("./catalog.js").Catalog,
 *   store: import("./store/index.js").PreferenceStore,
 *   relay: import("./relay.js").Relay,
 * }} deps
 */
export function createConverse({ config, catalog, store, relay }) {
  const { modelId, region } = config.converse;
  if (!/(^|\.)amazon\.nova-/.test(modelId)) {
    throw new Error(`the conversation model must be an Amazon Nova model, not ${modelId}`);
  }
  /** @type {BedrockRuntimeClient | undefined} */
  let bedrock;

  /** @param {string} text */
  async function context(text) {
    const [tonight, people] = await Promise.all([
      store.getTonight(config.household),
      store.listPeople(config.household),
    ]);
    const couch = tonight
      ? tonight.people.map((p) => `${p.name} (${JSON.stringify(p.settings)})`).join(", ")
      : "not set yet";
    return [
      text,
      "",
      `Tonight's couch on the TV: ${couch}.`,
      `People in this household: ${people.length > 0 ? people.map((p) => p.name).join(", ") : "nobody yet"}.`,
      `Films with an analysis: ${catalog.titles.map((t) => t.name).join(", ")}.`,
    ].join("\n");
  }

  /**
   * @param {{ message: string, history: { role: "user" | "assistant", text: string }[] }} request
   */
  return async function converse({ message, history }) {
    const started = performance.now();
    bedrock ??= new BedrockRuntimeClient({ region });

    const server = createMcpServer({ catalog, store, relay, household: config.household });
    const mcp = new Client({ name: "everyseat-converse", version: "0.1.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);

    try {
      const { tools } = await mcp.listTools();
      const toolConfig = {
        tools: tools.map((tool) => ({
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: /** @type {any} */ (modelSchema(tool.inputSchema)) },
          },
        })),
      };
      const system = [{ text: await context(SYSTEM_PROMPT) }];
      const messages = toMessages(history, message);

      /** @type {{ name: string, arguments: Record<string, unknown>, result: CallToolResult }[]} */
      const toolCalls = [];
      const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0 };
      let reply = "";

      for (let call = 0; call < MAX_MODEL_CALLS; call++) {
        const response = await bedrock.send(
          new ConverseCommand({
            modelId,
            system,
            messages,
            toolConfig,
            inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS, temperature: 0 },
          }),
        );
        usage.modelCalls += 1;
        usage.inputTokens += response.usage?.inputTokens ?? 0;
        usage.outputTokens += response.usage?.outputTokens ?? 0;
        usage.totalTokens += response.usage?.totalTokens ?? 0;

        const answer = response.output?.message;
        if (!answer) break;
        messages.push(answer);
        if (response.stopReason !== "tool_use") {
          reply = textOf(answer);
          break;
        }

        /** @type {ContentBlock[]} */
        const results = [];
        /** @type {string[]} */
        const spoken = [];
        let failed = false;
        for (const block of answer.content ?? []) {
          const use = block.toolUse;
          if (!use?.toolUseId || !use.name) continue;
          const args = /** @type {Record<string, unknown>} */ (use.input ?? {});
          try {
            const result = /** @type {CallToolResult} */ (
              await mcp.callTool({ name: use.name, arguments: args })
            );
            toolCalls.push({ name: use.name, arguments: args, result });
            failed ||= Boolean(result.isError);
            spoken.push(summaryOf(result));
            results.push({
              toolResult: {
                toolUseId: use.toolUseId,
                status: result.isError ? "error" : "success",
                content: [forModel(result)],
              },
            });
          } catch (error) {
            console.error(`converse: tool ${use.name} failed`, error);
            failed = true;
            results.push({
              toolResult: {
                toolUseId: use.toolUseId,
                status: "error",
                content: [{ text: "That tool is not available right now." }],
              },
            });
          }
        }
        if (results.length === 0) break;
        // Each tool's summary is already worded for speech, so when everything worked the loop
        // ends here and saves a second model call. A failure goes back to the model.
        if (!failed) {
          reply = spoken.join(" ");
          break;
        }
        messages.push({ role: "user", content: results });
      }

      const latencyMs = Math.round(performance.now() - started);
      console.info(
        `converse: ${usage.modelCalls} model calls, ${usage.inputTokens} in / ${usage.outputTokens} out tokens, ` +
          `${toolCalls.map((c) => c.name).join("+") || "no tools"}, ${latencyMs} ms`,
      );
      return {
        reply: reply || "Sorry, I couldn't work that out. Could you say it another way?",
        toolCalls,
        usage,
        model: modelId,
        latencyMs,
      };
    } finally {
      await Promise.allSettled([mcp.close(), server.close()]);
    }
  };
}
