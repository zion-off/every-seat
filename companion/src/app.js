import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import { mountAd } from "./ad.js";
import { converseRequestSchema, createConverse, hasAwsCredentials } from "./converse.js";
import { createMcpServer } from "./mcp.js";

/** @typedef {import("./config.js").Config} Config */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** @param {string} host */
function isPrivateAddress(host) {
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".local")
  );
}

/**
 * Browsers must come from this machine, or from the local network when the server is
 * reachable from it, or be listed. Requests without an Origin header (apps, scripts) pass.
 * This keeps other websites from driving a server that listens on a local address.
 * @param {Config} config
 * @returns {(origin: string) => boolean}
 */
export function originPolicy(config) {
  const reachableFromNetwork = !["127.0.0.1", "localhost", "::1"].includes(config.host);
  return (origin) => {
    if (config.allowedOrigins.includes(origin)) return true;
    let hostname;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return false;
    }
    return LOOPBACK_HOSTS.has(hostname) || (reachableFromNetwork && isPrivateAddress(hostname));
  };
}

/**
 * Compares a presented key with the configured one without leaking where they differ.
 * @param {string | undefined} given
 * @param {string} expected
 */
function sameKey(given, expected) {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The key a request presents: `Authorization: Bearer <key>` or `X-API-Key`.
 * @param {import("node:http").IncomingMessage} request
 */
export function presentedKey(request) {
  const bearer = /^Bearer (.+)$/i.exec(request.headers.authorization ?? "");
  const header = request.headers["x-api-key"];
  return bearer?.[1] ?? (typeof header === "string" ? header : undefined);
}

/**
 * Whether a request may proceed. With no key configured everything may. A key can also be
 * given as a `key` query parameter, for WebSocket clients that cannot set headers.
 * @param {Config} config
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} [url]
 */
export function isAuthorized(config, request, url) {
  if (config.apiKey === undefined) return true;
  return sameKey(presentedKey(request) ?? url?.searchParams.get("key") ?? undefined, config.apiKey);
}

/**
 * @param {{
 *   config: Config,
 *   catalog: import("./catalog.js").Catalog,
 *   store: import("./store/index.js").PreferenceStore,
 *   relay: import("./relay.js").Relay,
 * }} deps
 */
export function createApp({ config, catalog, store, relay }) {
  const app = express();
  app.disable("x-powered-by");
  const originAllowed = originPolicy(config);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !originAllowed(origin)) {
      res.status(403).json({ error: "origin not allowed" });
      return;
    }
    next();
  });

  app.use(
    cors({
      origin: true,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "content-type",
        "accept",
        "authorization",
        "x-api-key",
        "mcp-protocol-version",
        "mcp-session-id",
        "last-event-id",
      ],
      exposedHeaders: ["Mcp-Session-Id"],
      maxAge: 86_400,
    }),
  );

  /** A missing or wrong key gets a bare 401: no `WWW-Authenticate`, so no sign-in prompt. */
  const requireKey = /** @type {express.RequestHandler} */ (
    (req, res, next) => {
      if (isAuthorized(config, req)) next();
      else res.status(401).json({ error: "unauthorized" });
    }
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, titles: catalog.titles.length, relay: relay.stats() });
  });

  // What the page needs to know before it connects.
  app.get("/api/config", (_req, res) => {
    res.json({
      household: config.household,
      sandboxPort: config.sandboxPort,
      keyRequired: config.apiKey !== undefined,
    });
  });

  const converse = createConverse({ config, catalog, store, relay });
  let converseInFlight = 0;
  app.post("/converse", requireKey, express.json({ limit: "64kb" }), async (req, res) => {
    if (!hasAwsCredentials(process.env)) {
      res.status(503).json({ error: "The conversation model has no AWS credentials. Start the server with AWS_PROFILE set." });
      return;
    }
    const parsed = converseRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Send { message, history? } with message up to 1000 characters." });
      return;
    }
    if (converseInFlight >= 4) {
      res.status(429).json({ error: "Busy, try again in a moment." });
      return;
    }
    converseInFlight += 1;
    try {
      res.json(await converse(parsed.data));
    } catch (error) {
      console.error("converse failed", error);
      res.status(502).json({ error: "The assistant couldn't be reached. Try again." });
    } finally {
      converseInFlight -= 1;
    }
  });

  // Stateless: each request gets its own server and transport, and a JSON reply, not a stream.
  app.post("/mcp", requireKey, express.json({ limit: "1mb" }), async (req, res) => {
    const server = createMcpServer({ catalog, store, relay, household: config.household });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("mcp request failed", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  for (const method of /** @type {const} */ (["get", "delete"])) {
    app[method]("/mcp", (_req, res) => {
      res
        .status(405)
        .set("Allow", "POST")
        .json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        });
    });
  }

  mountAd(app, { config, catalog, requireKey });

  if (existsSync(config.webDir)) app.use(express.static(config.webDir));

  app.use(
    /** @type {express.ErrorRequestHandler} */ (
      (error, _req, res, _next) => {
        const status = typeof error.status === "number" ? error.status : 500;
        res.status(status).json({
          jsonrpc: "2.0",
          error: { code: status === 400 ? -32700 : -32603, message: status === 400 ? "Parse error" : "Internal server error" },
          id: null,
        });
      }
    ),
  );

  return app;
}
