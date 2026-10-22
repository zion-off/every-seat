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
    store: {
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
  };
}

/** @typedef {ReturnType<typeof loadConfig>} Config */
