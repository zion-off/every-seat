const LOOKAHEAD_S = 4;
const LOAD_BEHIND_S = 3;
const LOAD_AHEAD_S = 90;
const KEEP_AHEAD_S = 150;
const MAX_LATE_S = 1;
const RESUME_WINDOW_S = 0.6;
const START_LEAD_S = 0.04;
const RESCHEDULE_S = 0.015;
const RETRY_LOAD_MS = 5000;

/**
 * @typedef {object} Clip
 * @property {string} id
 * @property {number} start Media time in seconds when the description starts.
 * @property {number} duration
 * @property {string} text
 * @property {string} url
 */

/**
 * @typedef {object} Entry
 * @property {Clip} clip
 * @property {AudioBuffer | undefined} buffer
 * @property {boolean} loading
 * @property {number} retryAt
 * @property {"idle" | "scheduled" | "playing" | "done" | "skipped"} state
 * @property {AudioBufferSourceNode | undefined} source
 * @property {GainNode | undefined} gain
 * @property {number} startCtx Audio-context time the clip was told to start at.
 * @property {number} offsetS How far into the clip it started (a late start).
 * @property {number | undefined} resumeFrom Media time the clip was cut off at by a pause.
 */

/**
 * @typedef {object} Report
 * @property {Clip} clip
 * @property {number} errorMs
 * @property {number} lateMs
 * @property {number} userOffsetMs
 * @property {number} relayOffsetMs
 * @property {number} rttMs
 * @property {number} latencyMs
 * @property {string} note
 */

/**
 * @typedef {object} PlayerOptions
 * @property {AudioContext} ctx
 * @property {import("./timing.js").TvClock} tv
 * @property {import("./timing.js").RelayTime} relayTime
 * @property {() => number} userOffsetMs How much later (positive) or earlier the description should sound.
 * @property {Record<string, string>} headers Sent with each clip request.
 * @property {(report: Report) => void} onReport
 */

/**
 * Plays the description clips against the TV's clock. A clip is handed to the audio clock a few
 * seconds before it is due, with the exact instant it should sound, so the browser starts it
 * on the audio hardware's schedule rather than on a timer's.
 */
export class AdPlayer {
  /** @param {PlayerOptions} options */
  constructor(options) {
    this.options = options;
    /** @type {Entry[]} */
    this.entries = [];
    /** True when the browser reports the audio output's position; false when it is estimated. */
    this.exactOutput = true;
  }

  get ctx() {
    return this.options.ctx;
  }

  /** @param {Clip[]} clips */
  setClips(clips) {
    this.stopAll(false);
    this.entries = [...clips]
      .sort((a, b) => a.start - b.start)
      .map((clip) => ({
        clip,
        buffer: undefined,
        loading: false,
        retryAt: 0,
        state: "idle",
        source: undefined,
        gain: undefined,
        startCtx: 0,
        offsetS: 0,
        resumeFrom: undefined,
      }));
  }

  get loadedCount() {
    return this.entries.filter((entry) => entry.buffer).length;
  }

  /** The clip sounding now, if any. */
  get playingEntry() {
    return this.entries.find((entry) => entry.state === "playing");
  }

  /** @param {number} mediaNow */
  nextEntry(mediaNow) {
    return this.entries.find((entry) => entry.clip.start > mediaNow);
  }

  /** The audio context time and the performance time at which that audio reaches the output. */
  outputPoint() {
    const { ctx } = this.options;
    const stamp = ctx.getOutputTimestamp?.();
    if (stamp && stamp.contextTime && stamp.performanceTime) {
      this.exactOutput = true;
      return { contextTime: stamp.contextTime, perfMs: stamp.performanceTime };
    }
    this.exactOutput = false;
    return { contextTime: ctx.currentTime - this.latencyMs / 1000, perfMs: performance.now() };
  }

  get latencyMs() {
    const { ctx } = this.options;
    return ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
  }

  /** @param {number} relayMs */
  ctxTimeAt(relayMs) {
    const point = this.outputPoint();
    const perfMs = relayMs - this.options.relayTime.offsetMs - performance.timeOrigin;
    return point.contextTime + (perfMs - point.perfMs) / 1000;
  }

  /** @param {number} contextTime */
  relayTimeAt(contextTime) {
    const point = this.outputPoint();
    const perfMs = point.perfMs + (contextTime - point.contextTime) * 1000;
    return perfMs + performance.timeOrigin + this.options.relayTime.offsetMs;
  }

  /**
   * Called for every clock message after it updates the TV clock.
   * @param {"title" | "rate" | "seek" | undefined} reason
   */
  clockChanged(reason) {
    if (reason === "seek" || reason === "title") this.reset();
    this.tick();
  }

  /** Cuts everything off and forgets where clips were interrupted, as after a seek. */
  reset() {
    this.stopAll(false);
    for (const entry of this.entries) {
      entry.state = "idle";
      entry.resumeFrom = undefined;
    }
  }

  /** Runs every 200 ms and on each clock message. */
  tick() {
    const { ctx, tv, relayTime } = this.options;
    this.promote();
    const mediaNow = relayTime.ready ? tv.mediaTimeAt(relayTime.now()) : undefined;
    if (mediaNow === undefined) return;
    this.loadNear(mediaNow);
    if (!tv.playing || ctx.state !== "running") {
      this.stopAll(true, mediaNow);
      return;
    }
    for (const entry of this.entries) {
      const { clip } = entry;
      if (clip.start > mediaNow + LOOKAHEAD_S) break;
      if (clip.start + clip.duration <= mediaNow) continue;
      if (entry.state === "idle" || entry.state === "scheduled") this.place(entry, mediaNow);
    }
  }

  /** Marks clips whose start has passed as playing, and reports how they landed. */
  promote() {
    const { ctx } = this.options;
    for (const entry of this.entries) {
      if (entry.state === "scheduled" && ctx.currentTime >= entry.startCtx) {
        entry.state = "playing";
        this.report(entry);
      }
    }
  }

  /**
   * @param {Entry} entry
   * @param {number} mediaNow
   */
  place(entry, mediaNow) {
    const { ctx, tv, userOffsetMs } = this.options;
    const { clip, buffer } = entry;
    if (!buffer) return;
    const due = tv.relayTimeOf(clip.start);
    if (due === undefined) return;
    const when = this.ctxTimeAt(due + userOffsetMs());

    if (entry.state === "scheduled") {
      if (Math.abs(when - entry.startCtx) <= RESCHEDULE_S) return;
      this.cancel(entry, false);
      entry.state = "idle";
    }

    let startAt = when;
    let offsetS = 0;
    const earliest = ctx.currentTime + START_LEAD_S;
    if (when < earliest) {
      // Late: join the clip part-way through if that is still useful, otherwise leave it.
      offsetS = earliest - when;
      startAt = earliest;
      const resumed =
        entry.resumeFrom !== undefined && Math.abs(mediaNow - entry.resumeFrom) < RESUME_WINDOW_S;
      if (offsetS >= buffer.duration - 0.1 || (offsetS > MAX_LATE_S && !resumed)) {
        entry.state = "skipped";
        return;
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    source.onended = () => {
      gain.disconnect();
      if (entry.source !== source) return;
      entry.source = undefined;
      entry.gain = undefined;
      entry.state = "done";
    };
    source.start(startAt, offsetS);
    entry.source = source;
    entry.gain = gain;
    entry.startCtx = startAt;
    entry.offsetS = offsetS;
    entry.state = "scheduled";
  }

  /**
   * @param {Entry} entry
   * @param {boolean} fade
   */
  cancel(entry, fade) {
    const { ctx } = this.options;
    const { source, gain } = entry;
    entry.source = undefined;
    entry.gain = undefined;
    if (!source || !gain) return;
    try {
      if (fade) {
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.03);
        source.stop(now + 0.04);
      } else {
        source.stop();
      }
    } catch {
      // Already stopped.
    }
  }

  /**
   * Stops every clip that is scheduled or sounding. A clip cut off by a pause remembers where,
   * so that resuming at the same spot carries on with it.
   * @param {boolean} paused
   * @param {number} [mediaNow]
   */
  stopAll(paused, mediaNow) {
    for (const entry of this.entries) {
      if (!entry.source) continue;
      if (entry.state === "playing" && paused && mediaNow !== undefined) entry.resumeFrom = mediaNow;
      this.cancel(entry, entry.state === "playing");
      entry.state = "idle";
    }
  }

  /** @param {number} mediaNow */
  loadNear(mediaNow) {
    const now = performance.now();
    for (const entry of this.entries) {
      const { clip } = entry;
      const end = clip.start + clip.duration;
      const wanted = end > mediaNow - LOAD_BEHIND_S && clip.start < mediaNow + LOAD_AHEAD_S;
      if (wanted && !entry.buffer && !entry.loading && now >= entry.retryAt) {
        void this.load(entry);
      } else if (
        entry.buffer &&
        !entry.source &&
        (end < mediaNow - 15 || clip.start > mediaNow + KEEP_AHEAD_S)
      ) {
        entry.buffer = undefined;
      }
    }
  }

  /** @param {Entry} entry */
  async load(entry) {
    entry.loading = true;
    try {
      const response = await fetch(entry.clip.url, { headers: this.options.headers });
      if (!response.ok) throw new Error(`clip ${entry.clip.id}: ${response.status}`);
      entry.buffer = await decode(this.ctx, await response.arrayBuffer());
    } catch (error) {
      console.warn(error);
      entry.retryAt = performance.now() + RETRY_LOAD_MS;
    } finally {
      entry.loading = false;
    }
  }

  /** @param {Entry} entry */
  report(entry) {
    const { tv, relayTime, userOffsetMs } = this.options;
    const sounding = this.relayTimeAt(entry.startCtx);
    const media = tv.mediaTimeAt(sounding);
    if (media === undefined) return;
    this.options.onReport({
      clip: entry.clip,
      errorMs: (media - (entry.clip.start + entry.offsetS)) * 1000 - userOffsetMs(),
      lateMs: entry.offsetS * 1000,
      userOffsetMs: userOffsetMs(),
      relayOffsetMs: relayTime.offsetMs,
      rttMs: relayTime.rttMs ?? 0,
      latencyMs: this.latencyMs,
      note: this.exactOutput ? "output timestamp" : "estimated output delay",
    });
  }

  /** A short tone, so the phone's volume can be set before the film starts. */
  beep() {
    const { ctx } = this.options;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.03);
    gain.gain.linearRampToValueAtTime(0, now + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.55);
  }
}

/**
 * Safari's older callback form and the promise form both work with this.
 * @param {AudioContext} ctx
 * @param {ArrayBuffer} data
 * @returns {Promise<AudioBuffer>}
 */
function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    const result = ctx.decodeAudioData(data, resolve, reject);
    if (result && typeof result.catch === "function") result.catch(reject);
  });
}
