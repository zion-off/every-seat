const RETRY_MS = [500, 1000, 2000, 4000, 8000];

/**
 * @typedef {object} RelayLinkOptions
 * @property {string} url
 * @property {string} household
 * @property {(message: Record<string, any>) => void} onMessage
 * @property {(open: boolean) => void} onState
 */

/**
 * The phone's end of the relay: newline-delimited JSON over a WebSocket, answering pings and
 * reconnecting when the connection drops (a phone loses it whenever the screen sleeps).
 */
export class RelayLink {
  /** @param {RelayLinkOptions} options */
  constructor(options) {
    this.options = options;
    /** @type {WebSocket | undefined} */
    this.ws = undefined;
    this.attempt = 0;
    /** @type {number | undefined} */
    this.retryTimer = undefined;
  }

  start() {
    window.clearTimeout(this.retryTimer);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(this.options.url);
    this.ws = ws;
    let pending = "";

    ws.onopen = () => {
      this.attempt = 0;
      this.send({ t: "hello", role: "phone", household: this.options.household });
      this.options.onState(true);
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      pending += event.data;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) this.receive(line.trim());
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.options.onState(false);
      const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)] ?? 8000;
      this.attempt += 1;
      this.retryTimer = window.setTimeout(() => this.start(), wait);
    };
    ws.onerror = () => ws.close();
  }

  /** @param {string} line */
  receive(line) {
    if (!line) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.t === "ping") this.send({ t: "pong" });
    else this.options.onMessage(message);
  }

  /** @param {Record<string, unknown>} message */
  send(message) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message) + "\n");
    return true;
  }
}
