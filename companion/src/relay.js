import { StringDecoder } from "node:string_decoder";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { MAX_PEOPLE, settingsSchema } from "./lens.js";

/** @typedef {import("./contracts.d.ts").RelayMessage} RelayMessage */
/** @typedef {import("./contracts.d.ts").LensMessage} LensMessage */
/** @typedef {import("./contracts.d.ts").HouseholdMessage} HouseholdMessage */
/** @typedef {import("./contracts.d.ts").RelayRole} RelayRole */

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const HELLO_TIMEOUT_MS = 10_000;

const person = z.strictObject({ name: z.string(), settings: settingsSchema });

export const relayMessageSchema = z.discriminatedUnion("t", [
  z.strictObject({
    t: z.literal("hello"),
    role: z.enum(["tv", "phone", "companion"]),
    household: z.string().min(1),
  }),
  z.strictObject({ t: z.literal("ping") }),
  z.strictObject({ t: z.literal("pong") }),
  z.strictObject({ t: z.literal("lens"), people: z.array(person), settings: settingsSchema }),
  z.strictObject({
    t: z.literal("household"),
    people: z.array(person).max(MAX_PEOPLE),
    updatedAt: z.number().int().min(0),
  }),
  z.strictObject({
    t: z.literal("clock"),
    mediaTime: z.number().min(0),
    wallClock: z.number().int(),
    rate: z.number(),
    title: z.string(),
  }),
  z.strictObject({ t: z.literal("sync?"), c: z.number().int() }),
  z.strictObject({ t: z.literal("sync!"), c: z.number().int(), s: z.number().int() }),
]);

/**
 * Splits a stream of text chunks into lines. A message can arrive split across several
 * WebSocket frames, or several messages in one, so a line is only complete at its `\n`.
 * Multi-byte characters cut at a chunk boundary are held back until they are whole.
 */
export class LineFramer {
  constructor() {
    this.decoder = new StringDecoder("utf8");
    this.pending = "";
  }

  /**
   * @param {Buffer} chunk
   * @returns {string[]} The lines completed by this chunk, without their line ends.
   */
  push(chunk) {
    this.pending += this.decoder.write(chunk);
    const lines = this.pending.split("\n");
    this.pending = /** @type {string} */ (lines.pop());
    if (Buffer.byteLength(this.pending) > MAX_LINE_BYTES) {
      throw new RangeError("relay message too long");
    }
    return lines.map((line) => line.replace(/\r$/, "")).filter((line) => line !== "");
  }
}

/**
 * @typedef {object} Connection
 * @property {import("ws").WebSocket} ws
 * @property {LineFramer} framer
 * @property {RelayRole | undefined} role
 * @property {string | undefined} household
 * @property {number} lastSeen
 * @property {NodeJS.Timeout | undefined} helloTimer
 */

/**
 * @typedef {object} RelayOptions
 * @property {number} [heartbeatMs] Interval between pings; the contract allows at most 25 s.
 * @property {number} [idleMs] A client silent for this long is dropped.
 * @property {boolean} [replayLens] Send the latest household and lens to a TV when it connects.
 * @property {(household: string, message: HouseholdMessage) => void} [onHousehold]
 *   Called when a TV or companion client sends a household that is newer than the latest one.
 * @property {(request: import("node:http").IncomingMessage, url: URL) => boolean} [authorize]
 * @property {(message: string) => void} [log]
 */

/**
 * Routes newline-delimited JSON messages between a household's TV, phones and companion.
 * Companion lens messages go to the TVs, a household from a TV or companion client goes to the
 * others when it is newer than the latest one (last writer wins; an older one is answered with the
 * latest), TV clock messages go to the phones, and a phone's or
 * TV's `sync?` is answered with the relay's own clock, which both sides stamp their times with.
 */
export class Relay {
  /** @param {RelayOptions} [options] */
  constructor(options = {}) {
    this.heartbeatMs = options.heartbeatMs ?? 20_000;
    this.idleMs = options.idleMs ?? this.heartbeatMs * 3;
    this.replayLens = options.replayLens ?? true;
    this.onHousehold = options.onHousehold ?? (() => {});
    this.authorize = options.authorize ?? (() => true);
    this.log = options.log ?? (() => {});
    /** @type {Set<Connection>} */
    this.connections = new Set();
    /** @type {Map<string, LensMessage>} */
    this.lastLens = new Map();
    /** @type {Map<string, HouseholdMessage>} */
    this.lastHousehold = new Map();
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    this.timer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    this.timer.unref();
  }

  /**
   * Accepts WebSocket upgrades on `path`.
   * @param {import("node:http").Server} server
   * @param {string} [path]
   */
  attach(server, path = "/relay") {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://relay.invalid");
      if (url.pathname !== path) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (!this.authorize(request, url)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws));
    });
  }

  /** @param {import("ws").WebSocket} ws */
  accept(ws) {
    /** @type {Connection} */
    const connection = {
      ws,
      framer: new LineFramer(),
      role: undefined,
      household: undefined,
      lastSeen: Date.now(),
      helloTimer: undefined,
    };
    this.connections.add(connection);
    connection.helloTimer = setTimeout(() => ws.close(1008, "hello expected"), HELLO_TIMEOUT_MS);

    ws.on("message", (data) => {
      connection.lastSeen = Date.now();
      try {
        for (const line of connection.framer.push(toBuffer(data))) this.receive(connection, line);
      } catch (error) {
        this.log(`relay: closing a connection: ${error instanceof Error ? error.message : error}`);
        ws.close(1009, "message too long");
      }
    });
    ws.on("close", () => {
      clearTimeout(connection.helloTimer);
      this.connections.delete(connection);
      if (connection.role) this.log(`relay: ${connection.role} left ${connection.household}`);
    });
    ws.on("error", () => ws.terminate());
  }

  /**
   * @param {Connection} from
   * @param {string} line
   */
  receive(from, line) {
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      this.log("relay: ignoring a line that is not JSON");
      return;
    }
    const parsed = relayMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.log(`relay: ignoring an invalid message: ${parsed.error.issues[0]?.message}`);
      return;
    }
    const message = parsed.data;

    if (message.t === "hello") {
      clearTimeout(from.helloTimer);
      from.role = message.role;
      from.household = message.household;
      this.log(`relay: ${message.role} joined ${message.household}`);
      if (message.role === "tv" && this.replayLens) {
        const household = this.lastHousehold.get(message.household);
        const lens = this.lastLens.get(message.household);
        if (household) this.send(from, household);
        if (lens) this.send(from, lens);
      }
      return;
    }
    if (message.t === "ping") {
      this.send(from, { t: "pong" });
      return;
    }
    if (message.t === "pong") return;
    if (!from.role || !from.household) {
      this.log(`relay: ignoring ${message.t} before hello`);
      return;
    }

    if (message.t === "lens" && from.role === "companion") {
      this.sendLens(from.household, message);
    } else if (message.t === "household" && (from.role === "tv" || from.role === "companion")) {
      this.receiveHousehold(from, message);
    } else if (message.t === "clock" && from.role === "tv") {
      this.broadcast(from.household, "phone", message);
    } else if (message.t === "sync?" && (from.role === "phone" || from.role === "tv")) {
      this.send(from, { t: "sync!", c: message.c, s: Date.now() });
    } else {
      this.log(`relay: ignoring ${message.t} from a ${from.role}`);
    }
  }

  /**
   * Keeps a household that is newer than the latest and passes it on to every other TV and
   * companion client; an older or equal one is dropped, and an older one is answered with the
   * latest so the sender catches up.
   * @param {Connection} from
   * @param {HouseholdMessage} message
   */
  receiveHousehold(from, message) {
    const household = /** @type {string} */ (from.household);
    const latest = this.lastHousehold.get(household);
    if (latest && message.updatedAt <= latest.updatedAt) {
      if (message.updatedAt < latest.updatedAt) this.send(from, latest);
      return;
    }
    this.onHousehold(household, message);
    this.sendHousehold(household, message, from);
  }

  /**
   * Makes a household the latest and delivers it to every TV and companion client but `except`.
   * @param {string} household
   * @param {HouseholdMessage} message
   * @param {Connection} [except]
   * @returns {number} How many TVs it went to.
   */
  sendHousehold(household, message, except) {
    this.lastHousehold.set(household, message);
    let tvs = 0;
    for (const connection of this.connections) {
      if (connection === except || connection.household !== household) continue;
      if (connection.role !== "tv" && connection.role !== "companion") continue;
      if (this.send(connection, message) && connection.role === "tv") tvs += 1;
    }
    return tvs;
  }

  /**
   * Delivers a lens to every TV in the household.
   * @param {string} household
   * @param {LensMessage} lens
   * @returns {number} How many TVs it went to.
   */
  sendLens(household, lens) {
    this.lastLens.set(household, lens);
    return this.broadcast(household, "tv", lens);
  }

  /**
   * @param {string} household
   * @param {RelayRole} role
   * @param {RelayMessage} message
   */
  broadcast(household, role, message) {
    let delivered = 0;
    for (const connection of this.connections) {
      if (connection.role === role && connection.household === household) {
        if (this.send(connection, message)) delivered += 1;
      }
    }
    return delivered;
  }

  /**
   * @param {Connection} connection
   * @param {RelayMessage} message
   */
  send(connection, message) {
    const { ws } = connection;
    if (ws.readyState !== ws.OPEN) return false;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      ws.terminate();
      return false;
    }
    ws.send(JSON.stringify(message) + "\n");
    return true;
  }

  /** Pings everyone, and drops clients that have said nothing for `idleMs`. */
  heartbeat() {
    const now = Date.now();
    for (const connection of this.connections) {
      if (now - connection.lastSeen > this.idleMs) {
        connection.ws.terminate();
      } else {
        this.send(connection, { t: "ping" });
      }
    }
  }

  /** How many clients of each role are connected. */
  stats() {
    const counts = { tv: 0, phone: 0, companion: 0, unidentified: 0 };
    for (const { role } of this.connections) counts[role ?? "unidentified"] += 1;
    return counts;
  }

  close() {
    clearInterval(this.timer);
    for (const connection of this.connections) connection.ws.terminate();
    this.wss.close();
  }
}

/**
 * @param {import("ws").RawData} data
 * @returns {Buffer}
 */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}
