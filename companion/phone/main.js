import { AdPlayer } from "./player.js";
import { RelayLink } from "./relayLink.js";
import { RelayTime, TvClock } from "./timing.js";

const OFFSET_KEY = "everyseat.ad.offsetMs";
const TICK_MS = 200;

const params = new URLSearchParams(location.search);
const key = params.get("key");
/** @type {Record<string, string>} */
const headers = key ? { "X-API-Key": key } : {};

/** @param {string} id */
function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
}
const ui = {
  title: el("title"),
  lead: el("lead"),
  settings: el("settings"),
  status: el("status"),
  start: /** @type {HTMLButtonElement} */ (el("start")),
  banner: el("banner"),
  live: el("live"),
  position: el("position"),
  now: el("now"),
  aiLabel: el("ai-label"),
  caption: el("caption"),
  controls: el("controls"),
  offset: /** @type {HTMLInputElement} */ (el("offset")),
  offsetValue: el("offset-value"),
  details: el("details"),
};

const state = {
  relayOpen: false,
  /** @type {string | undefined} */
  title: undefined,
  /** @type {string | undefined} */
  name: undefined,
  /** @type {import("./player.js").Clip[]} */
  clips: [],
  clipsLoaded: false,
  /** True when the last clip list request failed, so it is asked for again. */
  clipsFailed: false,
  /** @type {AudioContext | undefined} */
  ctx: undefined,
  /** @type {AdPlayer | undefined} */
  player: undefined,
  skewMs: /** @type {number | undefined} */ (undefined),
  lastReport: "none yet",
  userOffsetMs: 0,
};

try {
  state.userOffsetMs = Number(localStorage.getItem(OFFSET_KEY)) || 0;
} catch {
  // Storage can be blocked; the offset then lasts for this visit only.
}

const tv = new TvClock();
/** @type {RelayLink} */
let link;
const relayTime = new RelayTime((message) => link?.send(message) ?? false);

/** @param {number} seconds */
function clockText(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/** @param {number} ms */
function offsetText(ms) {
  if (ms === 0) return "on time";
  return ms > 0 ? `${ms} ms later` : `${-ms} ms earlier`;
}

/** @param {number} ms */
function setOffset(ms) {
  state.userOffsetMs = Math.max(-500, Math.min(500, Math.round(ms)));
  ui.offset.value = String(state.userOffsetMs);
  ui.offset.setAttribute("aria-valuetext", offsetText(state.userOffsetMs));
  ui.offsetValue.textContent = offsetText(state.userOffsetMs);
  try {
    localStorage.setItem(OFFSET_KEY, String(state.userOffsetMs));
  } catch {
    // See above.
  }
  state.player?.tick();
}

/** @param {string} id */
async function loadTitle(id) {
  state.title = id;
  state.clips = [];
  state.clipsLoaded = false;
  state.clipsFailed = false;
  state.player?.setClips([]);
  try {
    const response = await fetch(`/api/ad/${encodeURIComponent(id)}`, { headers });
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.json();
    if (state.title !== id) return;
    state.name = body.name;
    state.clips = body.clips;
  } catch {
    if (state.title !== id) return;
    state.name = undefined;
    state.clipsFailed = true;
  }
  state.clipsLoaded = true;
  state.player?.setClips(state.clips);
  state.player?.tick();
  render();
}

/** @param {Record<string, any>} message */
function onMessage(message) {
  if (message.t === "sync!") {
    relayTime.receive(/** @type {{ c: number, s: number }} */ (message));
  } else if (message.t === "clock") {
    const clock = /** @type {import("./timing.js").ClockMessage} */ (message);
    if (clock.title === "") {
      // The TV left the player: stop speaking and wait for the next film.
      tv.stop();
      state.player?.reset();
      state.title = undefined;
      state.name = undefined;
      state.clips = [];
      state.clipsLoaded = false;
      state.player?.setClips([]);
      state.skewMs = undefined;
      render();
      return;
    }
    const reason = tv.update(clock);
    state.skewMs = relayTime.ready ? clock.wallClock - relayTime.now() : undefined;
    if (clock.title !== state.title) void loadTitle(clock.title);
    else if (state.clipsFailed && state.clipsLoaded) void loadTitle(clock.title);
    state.player?.clockChanged(reason);
  }
  render();
}

/** @param {import("./player.js").Report} report */
function onReport(report) {
  state.lastReport = `${report.clip.id}: ${report.errorMs.toFixed(0)} ms`;
  const numbers = [
    report.errorMs,
    report.lateMs,
    report.userOffsetMs,
    report.relayOffsetMs,
    report.rttMs,
    report.latencyMs,
  ];
  if (!state.title || !numbers.every(Number.isFinite)) return;
  fetch("/api/ad/report", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      title: state.title,
      clip: report.clip.id,
      plannedMediaS: report.clip.start,
      errorMs: report.errorMs,
      lateMs: report.lateMs,
      userOffsetMs: report.userOffsetMs,
      relayOffsetMs: report.relayOffsetMs,
      rttMs: report.rttMs,
      latencyMs: report.latencyMs,
      note: report.note,
    }),
    keepalive: true,
  }).catch(() => {});
}

/** A second of silence in a looping element: on iOS before 17 it lets Web Audio ignore the silent switch. */
function startSilentLoop() {
  const rate = 8000;
  const bytes = new Uint8Array(44 + rate).fill(0x80);
  const view = new DataView(bytes.buffer);
  const text = (/** @type {number} */ at, /** @type {string} */ s) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + rate, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, rate, true);
  const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })));
  audio.loop = true;
  audio.setAttribute("playsinline", "");
  audio.play().catch(() => {});
}

async function holdScreen() {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Not available or refused; the page asks to keep the screen on, nothing more.
  }
}

function start() {
  if (state.ctx) return;
  const nav = /** @type {Navigator & { audioSession?: { type: string } }} */ (navigator);
  if (nav.audioSession) nav.audioSession.type = "playback";
  else startSilentLoop();

  const Context =
    window.AudioContext ??
    /** @type {typeof AudioContext} */ (/** @type {any} */ (window).webkitAudioContext);
  const ctx = new Context({ latencyHint: "interactive" });
  state.ctx = ctx;
  ctx.addEventListener("statechange", render);
  // Inside the tap: a silent sound is what unlocks Safari's audio. The player is made at once,
  // because on iOS resume() can stay pending until the audio session is free, and the page
  // must keep following the TV meanwhile.
  const unlock = ctx.createBufferSource();
  unlock.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  unlock.connect(ctx.destination);
  unlock.start();
  void ctx.resume().catch(() => {});

  state.player = new AdPlayer({
    ctx,
    tv,
    relayTime,
    userOffsetMs: () => state.userOffsetMs,
    headers,
    onReport,
  });
  // Clips may still be loading or not named yet; loadTitle hands them over when they arrive.
  state.player.setClips(state.clips);
  window.setInterval(() => state.player?.tick(), TICK_MS);
  void holdScreen();
  render();
}

function resumeAudio() {
  if (state.ctx && state.ctx.state !== "running") void state.ctx.resume().catch(() => {});
}

function render() {
  const { ctx, player } = state;
  const started = ctx !== undefined;
  ui.start.hidden = started;
  ui.lead.hidden = started;
  ui.settings.hidden = started;
  ui.controls.hidden = !started;
  ui.banner.hidden = !(started && ctx.state !== "running");

  const mediaNow = relayTime.ready ? tv.mediaTimeAt(relayTime.now()) : undefined;
  const playing = player?.playingEntry;
  const film = state.name ?? state.title;
  ui.title.textContent = started && film ? film : "Audio description";
  let text;
  if (!state.relayOpen) text = started ? "Lost the connection. Reconnecting…" : "Connecting…";
  else if (tv.stopped) text = "The TV isn't playing a film right now.";
  else if (mediaNow === undefined) text = "Connected. Waiting for the TV to start a film.";
  else if (state.clipsLoaded && state.clips.length === 0) text = `No audio description for ${film} yet.`;
  else if (!started) text = `Connected. ${film} is ready.`;
  else if (tv.stale) text = "The TV has gone quiet. Descriptions continue when it plays again.";
  else if (!tv.playing && tv.last?.rate === 0) text = "The TV is paused.";
  else if (!tv.playing) text = "The TV is not playing at normal speed, so descriptions are off.";
  else text = "Following the TV.";
  if (ui.status.textContent !== text) ui.status.textContent = text;

  ui.live.hidden = !started || mediaNow === undefined;
  if (mediaNow !== undefined) {
    const next = player?.nextEntry(mediaNow);
    const paused = !tv.playing && tv.last?.rate === 0;
    ui.position.textContent = `TV at ${clockText(mediaNow)}, ${paused ? "paused" : "playing"}`;
    let now = "No more descriptions";
    if (playing) now = "Speaking now";
    else if (next) now = `Next description in ${Math.max(0, Math.round(next.clip.start - mediaNow))} s`;
    if (ui.now.textContent !== now) ui.now.textContent = now;
    ui.live.toggleAttribute("data-speaking", Boolean(playing));
    const caption = playing?.clip.text ?? "";
    if (ui.caption.textContent !== caption) ui.caption.textContent = caption;
    ui.aiLabel.hidden = !caption;
  }

  const rows = [
    ["Clock offset", relayTime.ready ? `${relayTime.offsetMs.toFixed(1)} ms` : "not measured"],
    ["Round trip", relayTime.rttMs === undefined ? "–" : `${relayTime.rttMs.toFixed(1)} ms`],
    ["TV clock skew", state.skewMs === undefined ? "–" : `${state.skewMs.toFixed(0)} ms`],
    ["Output delay", ctx ? `${(player?.latencyMs ?? 0).toFixed(0)} ms` : "–"],
    ["Output timing", ctx ? (player?.exactOutput ? "reported" : "estimated") : "–"],
    ["Descriptions ready", `${player?.loadedCount ?? 0} of ${state.clips.length}`],
    ["Last description", state.lastReport],
  ];
  ui.details.replaceChildren(
    ...rows.flatMap(([name, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = name ?? "";
      const dd = document.createElement("dd");
      dd.textContent = value ?? "";
      return [dt, dd];
    }),
  );
}

function connect() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const query = key ? `?key=${encodeURIComponent(key)}` : "";
  return fetch("/api/config")
    .then((response) => response.json())
    .catch(() => ({ household: "demo" }))
    .then((config) => {
      link = new RelayLink({
        url: `${scheme}://${location.host}/relay${query}`,
        household: params.get("household") ?? config.household,
        onMessage,
        onState: (open) => {
          state.relayOpen = open;
          if (open) relayTime.burst();
          render();
        },
      });
      link.start();
    });
}

ui.start.addEventListener("click", start);
ui.offset.addEventListener("input", () => setOffset(Number(ui.offset.value)));
el("resume").addEventListener("click", resumeAudio);
el("earlier").addEventListener("click", () => setOffset(state.userOffsetMs - 10));
el("later").addEventListener("click", () => setOffset(state.userOffsetMs + 10));
el("resync").addEventListener("click", () => {
  relayTime.burst();
  state.player?.reset();
  resumeAudio();
});
el("beep").addEventListener("click", () => {
  resumeAudio();
  state.player?.beep();
});
document.addEventListener("pointerdown", resumeAudio);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  link?.start();
  relayTime.burst(3);
  resumeAudio();
  if (state.ctx) void holdScreen();
});

setOffset(state.userOffsetMs);
window.setInterval(() => relayTime.burst(3), 10_000);
window.setInterval(render, 500);
void connect();
render();
