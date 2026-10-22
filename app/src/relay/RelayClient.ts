import { LensSettings } from '../engine/types';

export interface LensPerson {
  name: string;
  settings: LensSettings;
}

/** Companion to TV: who is on the couch tonight, and the combined lens. */
export interface LensMessage {
  t: 'lens';
  people: LensPerson[];
  settings: LensSettings;
}

/** The relay contract allows at most 25 s between pings. */
const PING_MS = 20000;
/** A link that has said nothing for this long is dropped and rebuilt. */
const DEAD_AFTER_MS = 50000;
/** A connection attempt that has not opened by then is abandoned. */
const CONNECT_TIMEOUT_MS = 10000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;
/** A line longer than this is a broken stream, not a message. */
const MAX_LINE_CHARS = 1024 * 1024;

/**
 * Splits text chunks into lines. A message over about 8 KB can arrive in several pieces, and two
 * messages can arrive in one, so a line is complete only at its `\n`.
 */
export class LineFramer {
  private pending = '';

  push(chunk: string): string[] {
    this.pending += chunk;
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    if (this.pending.length > MAX_LINE_CHARS) {
      this.pending = '';
      throw new RangeError('relay line too long');
    }
    return lines
      .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
      .filter((line) => line !== '');
  }
}

const isOneOf = (value: unknown, allowed: string[]): boolean =>
  typeof value === 'string' && allowed.includes(value);

const readSettings = (value: any): LensSettings | null =>
  value &&
  isOneOf(value.flashes, ['soften', 'off']) &&
  isOneOf(value.loud, ['cap', 'off']) &&
  isOneOf(value.scares, ['headsup', 'off']) &&
  isOneOf(value.ad, ['on', 'off'])
    ? {
        flashes: value.flashes,
        loud: value.loud,
        scares: value.scares,
        ad: value.ad,
      }
    : null;

/** A lens message with valid settings throughout, or null. */
export const readLensMessage = (value: any): LensMessage | null => {
  if (!value || value.t !== 'lens' || !Array.isArray(value.people)) {
    return null;
  }
  const settings = readSettings(value.settings);
  if (!settings) {
    return null;
  }
  const people: LensPerson[] = [];
  for (const entry of value.people) {
    const personSettings = readSettings(entry?.settings);
    if (
      typeof entry?.name !== 'string' ||
      entry.name.trim() === '' ||
      !personSettings
    ) {
      return null;
    }
    people.push({ name: entry.name.trim(), settings: personSettings });
  }
  return { t: 'lens', people, settings };
};

type Options = {
  url: string;
  household: string;
  onLens: (message: LensMessage) => void;
  onStatus?: (connected: boolean) => void;
};

/**
 * The TV's end of the relay: joins a household, answers pings, passes on lens messages and
 * reconnects when the link drops or goes quiet.
 */
export class RelayClient {
  private ws: WebSocket | null = null;
  private framer = new LineFramer();
  private stopped = true;
  private connected = false;
  private lastHeard = 0;
  private retryMs = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private options: Options) {}

  start() {
    if (this.stopped) {
      this.stopped = false;
      this.connect();
    }
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.drop();
    this.setConnected(false);
  }

  private connect() {
    if (this.stopped) {
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.options.url);
    } catch (e) {
      console.info('relay', 'cannot connect', String(e));
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.framer = new LineFramer();
    this.connectTimer = setTimeout(() => {
      console.info('relay', 'connection timed out');
      this.lose();
    }, CONNECT_TIMEOUT_MS);
    // Handlers of a socket that has been replaced do nothing.
    ws.onopen = () => {
      if (this.ws !== ws) {
        return;
      }
      this.clearConnectTimer();
      this.retryMs = RETRY_MIN_MS;
      this.lastHeard = Date.now();
      this.send({
        t: 'hello',
        role: 'tv',
        household: this.options.household,
      });
      this.pingTimer = setInterval(() => this.beat(), PING_MS);
      this.setConnected(true);
    };
    ws.onmessage = (event: any) => {
      if (this.ws !== ws || typeof event.data !== 'string') {
        return;
      }
      this.lastHeard = Date.now();
      try {
        this.framer.push(event.data).forEach((line) => this.receive(line));
      } catch (e) {
        console.info('relay', 'bad stream', String(e));
        this.lose();
      }
    };
    ws.onerror = (event: any) => {
      console.info('relay', 'socket error', String(event?.message ?? ''));
    };
    ws.onclose = (event: any) => {
      if (this.ws === ws) {
        console.info('relay', 'closed', String(event?.code ?? ''));
        this.lose();
      }
    };
  }

  private receive(line: string) {
    let json: any;
    try {
      json = JSON.parse(line);
    } catch (e) {
      console.info('relay', 'ignored a line that is not JSON');
      return;
    }
    if (json?.t === 'ping') {
      this.send({ t: 'pong' });
    } else if (json?.t === 'lens') {
      const lens = readLensMessage(json);
      if (lens) {
        this.options.onLens(lens);
      } else {
        console.info('relay', 'ignored an invalid lens message');
      }
    }
  }

  private send(message: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message) + '\n');
    }
  }

  private beat() {
    if (Date.now() - this.lastHeard > DEAD_AFTER_MS) {
      console.info('relay', 'no answer, reconnecting');
      this.lose();
    } else {
      this.send({ t: 'ping' });
    }
  }

  /** Forgets the current socket and tries again after a pause that grows to 10 s. */
  private lose() {
    this.clearTimers();
    this.drop();
    this.setConnected(false);
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.stopped || this.retryTimer) {
      return;
    }
    const wait = this.retryMs;
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, wait);
  }

  private drop() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch (e) {
        // The socket is already gone.
      }
    }
  }

  private clearConnectTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearTimers() {
    this.clearConnectTimer();
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setConnected(connected: boolean) {
    if (this.connected !== connected) {
      this.connected = connected;
      console.info('relay', connected ? 'connected' : 'disconnected');
      this.options.onStatus?.(connected);
    }
  }
}
