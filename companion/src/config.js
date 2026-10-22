import path from "node:path";
import { fileURLToPath } from "node:url";

const companionRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(companionRoot, "..");

/** @param {string | undefined} value */
function list(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Settings come from the environment; every one has a default that works on a laptop.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadConfig(env = process.env) {
  return {
    port: Number(env.EVERYSEAT_PORT ?? 8787),
    /** Loopback by default. Use 0.0.0.0 to let a phone on the network reach it. */
    host: env.EVERYSEAT_HOST ?? "127.0.0.1",
    /** When set, MCP and conversation requests and relay connections must present it. */
    apiKey: env.EVERYSEAT_API_KEY || undefined,
    household: env.EVERYSEAT_HOUSEHOLD ?? "demo",
    /** Directories searched, in order, for `.sensevtt` files. */
    cueDirs: env.EVERYSEAT_CUES_DIR
      ? env.EVERYSEAT_CUES_DIR.split(path.delimiter)
      : [path.join(repoRoot, "fixtures"), path.join(repoRoot, "generated")],
    titlesFile: env.EVERYSEAT_TITLES_FILE ?? path.join(companionRoot, "data", "titles.json"),
    /** Local JSON by default; set a table name to keep settings in DynamoDB instead. */
    store: env.EVERYSEAT_DYNAMODB_TABLE
      ? {
          kind: /** @type {const} */ ("dynamodb"),
          table: env.EVERYSEAT_DYNAMODB_TABLE,
          region: env.AWS_REGION ?? "us-east-1",
          endpoint: env.EVERYSEAT_DYNAMODB_ENDPOINT || undefined,
          seedFile: path.join(companionRoot, "data", "household.json"),
        }
      : {
          kind: /** @type {const} */ ("json"),
          file:
            env.EVERYSEAT_STORE_FILE ??
            path.join(companionRoot, "node_modules", ".cache", "everyseat", "preferences.json"),
          seedFile: path.join(companionRoot, "data", "household.json"),
        },
    /** Browser origins allowed besides the local ones. */
    allowedOrigins: list(env.EVERYSEAT_ALLOWED_ORIGINS),
    heartbeatMs: Number(env.EVERYSEAT_HEARTBEAT_MS ?? 20_000),
    /** Send the last lens to a TV when it connects. */
    replayLens: env.EVERYSEAT_REPLAY_LENS === "1",
    /** The model behind `/converse`, which turns a sentence into tool calls. */
    converse: {
      modelId: env.EVERYSEAT_CONVERSE_MODEL ?? "us.amazon.nova-2-lite-v1:0",
      region: env.AWS_REGION ?? "us-east-1",
    },
    /** The sandbox for cards runs on its own port so it is a different origin from the page. */
    sandboxPort: Number(env.EVERYSEAT_SANDBOX_PORT ?? 8788),
    /** The built page (`npm run build` in `web/`), served at `/` when it exists. */
    webDir: env.EVERYSEAT_WEB_DIR ?? path.join(companionRoot, "web", "dist"),
  };
}

/** @typedef {ReturnType<typeof loadConfig>} Config */
