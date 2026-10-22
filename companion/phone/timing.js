/** Milliseconds since the Unix epoch from the monotonic clock, so a clock change can't shift it. */
export function epochMs() {
  return performance.timeOrigin + performance.now();
}

const KEEP_SAMPLES = 12;
const SAMPLE_MAX_AGE_MS = 60_000;
/** The TV sends its clock at least every 2 s; past this silence its timeline is not trusted. */
const CLOCK_STALE_MS = 6000;

/**
 * The offset between this phone's clock and the relay's, which is the clock the TV stamps its
 * messages with. Each `sync?` probe gives one estimate (the relay's time minus the midpoint of
 * the round trip); the probe with the shortest round trip is the least distorted by a slow
 * network leg, so that one is used.
 */
export class RelayTime {
  /** @param {(message: Record<string, unknown>) => boolean} send */
  constructor(send) {
    this.send = send;
    /** @type {{ rtt: number, offset: number, at: number }[]} */
    this.samples = [];
    this.offsetMs = 0;
    /** @type {number | undefined} */
    this.rttMs = undefined;
  }

  get ready() {
    return this.rttMs !== undefined;
  }

  /** The relay's clock now, in milliseconds since the Unix epoch. */
  now() {
    return epochMs() + this.offsetMs;
  }

  /** Sends `count` probes `gapMs` apart. */
  burst(count = 8, gapMs = 120) {
    for (let i = 0; i < count; i += 1) window.setTimeout(() => this.probe(), i * gapMs);
  }

  probe() {
    this.send({ t: "sync?", c: Math.round(epochMs()) });
  }

  /** @param {{ c: number, s: number }} reply */
  receive(reply) {
    const received = epochMs();
    const rtt = received - reply.c;
    if (rtt < 0 || rtt > 5000) return;
    this.samples.push({ rtt, offset: reply.s - (reply.c + rtt / 2), at: received });
    this.samples = this.samples
      .filter((sample) => received - sample.at < SAMPLE_MAX_AGE_MS)
      .slice(-KEEP_SAMPLES);
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offsetMs = best.offset;
    this.rttMs = best.rtt;
  }
}

/**
 * @typedef {object} ClockMessage
 * @property {number} mediaTime
 * @property {number} wallClock
 * @property {number} rate
 * @property {string} title
 */

/**
 * Where the TV is in the film, extrapolated from its latest clock message. `wallClock` is the
 * relay's time when the TV read `mediaTime`.
 */
export class TvClock {
  constructor() {
    /** @type {ClockMessage | undefined} */
    this.last = undefined;
    this.heardAt = 0;
  }

  /** True when the TV has gone quiet, for example because it left the film or lost power. */
  get stale() {
    return this.last !== undefined && performance.now() - this.heardAt > CLOCK_STALE_MS;
  }

  /**
   * Media time at relay time `relayMs`, or undefined before the first message.
   * @param {number} relayMs
   */
  mediaTimeAt(relayMs) {
    if (!this.last) return undefined;
    return this.last.mediaTime + (this.last.rate * (relayMs - this.last.wallClock)) / 1000;
  }

  /**
   * Relay time at which the TV reaches `mediaS` if it keeps its rate.
   * @param {number} mediaS
   */
  relayTimeOf(mediaS) {
    if (!this.last || this.last.rate <= 0) return undefined;
    return this.last.wallClock + ((mediaS - this.last.mediaTime) * 1000) / this.last.rate;
  }

  /** True while the film plays at normal speed, the only speed the description can follow. */
  get playing() {
    return this.last !== undefined && !this.stale && Math.abs(this.last.rate - 1) < 0.01;
  }

  /**
   * Takes a clock message. Returns why the old timeline no longer holds (a different film, a
   * pause or resume, a seek), or undefined when the message only refines it.
   * @param {ClockMessage} message
   * @returns {"title" | "rate" | "seek" | undefined}
   */
  update(message) {
    const before = this.last;
    this.last = message;
    this.heardAt = performance.now();
    if (!before) return "title";
    if (before.title !== message.title) return "title";
    // A jump is checked first: a real seek arrives as a stopped clock at the new position.
    const expected = before.mediaTime + (before.rate * (message.wallClock - before.wallClock)) / 1000;
    if (Math.abs(message.mediaTime - expected) > 0.2) return "seek";
    return Math.abs(before.rate - message.rate) > 0.001 ? "rate" : undefined;
  }
}
