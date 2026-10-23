import { LensSettings } from '../engine/types';

export interface LensPerson {
  name: string;
  settings: LensSettings;
}

/** Both directions: who is on the couch tonight, and the combined lens; the latest `updatedAt` wins. */
export interface LensMessage {
  t: 'lens';
  people: LensPerson[];
  settings: LensSettings;
  /** When the couch was set, in ms on the relay's clock; a lens without it is stamped by the relay. */
  updatedAt?: number;
}

/** Both directions: everyone in the household; the latest `updatedAt` wins. */
export interface HouseholdMessage {
  t: 'household';
  people: LensPerson[];
  updatedAt: number;
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
/** Probes sent on connecting, so the first clock message already carries a good offset. */
const SYNC_FIRST_PROBES = 8;
const SYNC_GAP_MS = 120;
/** Probes sent every SYNC_EVERY_MS afterwards, to follow the two clocks drifting apart. */
const SYNC_LATER_PROBES = 3;
const SYNC_EVERY_MS = 10000;
/** Only recent probes count, and the one with the shortest round trip wins. */
const SYNC_KEEP = 12;
const SYNC_MAX_AGE_MS = 60000;

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

export const readSettings = (value: any): LensSettings | null =>
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
  return Number.isFinite(value.updatedAt)
    ? { t: 'lens', people, settings, updatedAt: Math.round(value.updatedAt) }
    : { t: 'lens', people, settings };
};

/** A household message with valid people and a timestamp, or null. */
export const readHouseholdMessage = (value: any): HouseholdMessage | null => {
  if (
    !value ||
    value.t !== 'household' ||
    !Array.isArray(value.people) ||
    !Number.isFinite(value.updatedAt)
  ) {
    return null;
  }
  const people: LensPerson[] = [];
  for (const entry of value.people) {
    const settings = readSettings(entry?.settings);
    if (
      typeof entry?.name !== 'string' ||
      entry.name.trim() === '' ||
      !settings
    ) {
      return null;
    }
    people.push({ name: entry.name.trim(), settings });
  }
  return { t: 'household', people, updatedAt: Math.round(value.updatedAt) };
};

type Options = {
  url: string;
  household: string;
  onLens: (message: LensMessage) => void;
  onHousehold: (message: HouseholdMessage) => void;
  onStatus?: (connected: boolean) => void;
};

/**
 * The TV's end of the relay: joins a household, answers pings, passes lens messages both ways and
 * reconnects when the link drops or goes quiet. It also measures how far the TV's clock is from
 * the relay's, so the clock messages it sends are stamped in the relay's time.
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
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private samples: Array<{ rtt: number; offset: number; at: number }> = [];
  private offsetMs: number | null = null;
  /** A couch set while the link was down, sent once it is back. */
  private unsentLens: LensMessage | null = null;

  constructor(private options: Options) {}

  /** The relay's time, in ms since the epoch, as far as it is known; the TV's own until then. */
  now(): number {
    return Date.now() + (this.offsetMs ?? 0);
  }

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
      if (this.unsentLens) {
        this.send(this.unsentLens as unknown as Record<string, unknown>);
        this.unsentLens = null;
      }
      this.pingTimer = setInterval(() => this.beat(), PING_MS);
      this.samples = [];
      this.offsetMs = null;
      this.probes(SYNC_FIRST_PROBES);
      this.syncTimer = setInterval(
        () => this.probes(SYNC_LATER_PROBES),
        SYNC_EVERY_MS,
      );
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
    } else if (json?.t === 'sync!') {
      if (Number.isFinite(json.c) && Number.isFinite(json.s)) {
        this.onSyncReply(json.c, json.s);
      }
    } else if (json?.t === 'household') {
      const household = readHouseholdMessage(json);
      if (household) {
        console.info('relay', 'household', household.people.length);
        this.options.onHousehold(household);
      } else {
        console.info('relay', 'ignored an invalid household message');
      }
    } else if (json?.t === 'lens') {
      const lens = readLensMessage(json);
      if (lens) {
        console.info('relay', 'lens', lens.people.map((p) => p.name).join(','));
        if ((lens.updatedAt ?? 0) >= (this.unsentLens?.updatedAt ?? Infinity)) {
          this.unsentLens = null;
        }
        this.options.onLens(lens);
      } else {
        console.info('relay', 'ignored an invalid lens message');
      }
    }
  }

  /** Sends the couch to the relay; one set while the link is down is sent after the next hello. */
  sendLens(message: LensMessage): boolean {
    if (!this.ws || this.ws.readyState !== 1) {
      this.unsentLens = message;
      return false;
    }
    this.unsentLens = null;
    this.send(message as unknown as Record<string, unknown>);
    return true;
  }

  /** Sends the household to the relay; it is dropped when the link is down, and sent again on connecting. */
  sendHousehold(message: HouseholdMessage): boolean {
    if (!this.ws || this.ws.readyState !== 1) {
      return false;
    }
    this.send(message as unknown as Record<string, unknown>);
    return true;
  }

  private send(message: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message) + '\n');
    }
  }

  private probes(count: number) {
    for (let i = 0; i < count; i++) {
      setTimeout(
        () => this.send({ t: 'sync?', c: Date.now() }),
        i * SYNC_GAP_MS,
      );
    }
  }

  /** One probe gives the relay's time minus the middle of the round trip. */
  private onSyncReply(sent: number, relayTime: number) {
    const now = Date.now();
    const rtt = now - sent;
    if (rtt < 0 || rtt > 5000) {
      return;
    }
    this.samples = this.samples
      .concat({ rtt, offset: relayTime - (sent + rtt / 2), at: now })
      .filter((s) => now - s.at < SYNC_MAX_AGE_MS)
      .slice(-SYNC_KEEP);
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    if (this.offsetMs === null) {
      console.info('relay', 'clock offset', best.offset.toFixed(1), 'ms');
    }
    this.offsetMs = best.offset;
  }

  /**
   * Sends the playback clock to phones, stamped with the relay's time. Nothing is sent until the
   * offset to the relay's clock is known, since an unstamped time would be worse than none.
   */
  sendClock(mediaTime: number, rate: number, title: string): boolean {
    if (this.offsetMs === null || !this.ws || this.ws.readyState !== 1) {
      return false;
    }
    this.send({
      t: 'clock',
      mediaTime: Math.round(Math.max(0, mediaTime) * 1000) / 1000,
      wallClock: Math.round(Date.now() + this.offsetMs),
      rate,
      title,
    });
    return true;
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
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
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
