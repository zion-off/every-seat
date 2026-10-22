"""Sudden-loudness onsets and an EBU R128 summary.

Audio is decoded to mono 48 kHz float, high-passed at 40 Hz (two 2-pole filters) so DC offsets and
infrasonic thumps do not register, and reduced to 10 ms hop energies; levels are 50 ms RMS windows
in dBFS (floor -80). A window is an onset when it is at least `RISE_DB` above the quietest window
of the previous 200 ms and above the median level of the 1.5 s before it, and its 300 ms peak is
audible (>= -40 dBFS). Nearby onsets are merged, keeping the one with the largest jump.

All times are seconds on the analyzed media's own clock.
"""

import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from everyseat.detectors import tools

SAMPLE_RATE = 48_000
HOP_S = 0.01
WINDOW_HOPS = 5  # 50 ms windows
FLOOR_DB = -80.0
RISE_DB = 15.0
AUDIBLE_DB = -40.0
SKIP_START_S = 3.0  # a start from digital silence is not an onset
SUPPRESS_HOPS = 200  # onsets closer than 2 s: keep the largest jump
PREV_HOPS = 20  # 200 ms look-back for the rise test
BASE_FAR_HOPS, BASE_NEAR_HOPS = 150, 26  # baseline window: [t - 1.5 s, t - 0.26 s]
PEAK_HOPS = 30
RETURN_MARGIN_DB = 6.0  # "back to baseline" = within this of the baseline level
MIN_HOLD_S, MAX_HOLD_S = 1.0, 3.0
_HOP_SAMPLES = round(SAMPLE_RATE * HOP_S)
_FILTER = "highpass=f=40:poles=2,highpass=f=40:poles=2"


@dataclass(frozen=True)
class LoudnessTrack:
    """`db[i]` is the level of the 50 ms window that starts at `i * HOP_S`."""

    db: np.ndarray

    def times(self) -> np.ndarray:
        return np.arange(len(self.db)) * HOP_S

    def between(self, t0: float, t1: float) -> tuple[np.ndarray, np.ndarray]:
        """The (times, levels) of the windows that start in [t0, t1)."""
        lo = max(0, int(round(t0 / HOP_S)))
        hi = min(len(self.db), int(round(t1 / HOP_S)))
        return np.arange(lo, hi) * HOP_S, self.db[lo:hi]


@dataclass(frozen=True)
class Onset:
    time: float  # first 10 ms of the sudden rise
    end: float  # time + the hold until the level returns near its baseline (1 to 3 s)
    baseline_db: float
    peak_db: float
    rise_db: float
    jump_db: float  # peak above baseline
    strongest_window: float  # start of the 50 ms window with the largest jump; can trail `time`


@dataclass(frozen=True)
class LoudnessResult:
    track: LoudnessTrack
    onsets: list[Onset]
    duration_s: float
    summary: dict[str, float]  # integrated_lufs, loudness_range_lu, true_peak_dbfs


def _hop_energies(media: Path) -> np.ndarray:
    """Mean-square energy of each full 10 ms hop of the decoded, filtered mono audio."""
    cmd = [
        tools.ffmpeg(),
        *("-v", "error", "-nostdin", "-i", str(media), "-map", "0:a:0", "-vn", "-af", _FILTER),
        *("-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"),
    ]
    block = 4 * _HOP_SAMPLES * 500
    energies: list[np.ndarray] = []
    leftover = b""
    with tempfile.TemporaryFile() as errors:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errors)
        assert proc.stdout is not None
        while chunk := proc.stdout.read(block):
            data = leftover + chunk
            usable = len(data) // 4 // _HOP_SAMPLES * _HOP_SAMPLES * 4
            leftover = data[usable:]
            samples = np.frombuffer(data[:usable], dtype=np.float32).astype(np.float64)
            energies.append((samples**2).reshape(-1, _HOP_SAMPLES).mean(axis=1))
        if proc.wait() != 0:
            errors.seek(0)
            raise tools.ToolError(f"cannot decode audio of {media.name}: {errors.read()[-300:]!r}")
    return np.concatenate(energies) if energies else np.zeros(0)


def _to_db(energy: np.ndarray) -> np.ndarray:
    return np.maximum(10 * np.log10(np.maximum(energy, 1e-8)), FLOOR_DB)


def _window_db(hops: np.ndarray) -> np.ndarray:
    csum = np.concatenate([[0.0], np.cumsum(hops)])
    return _to_db((csum[WINDOW_HOPS:] - csum[:-WINDOW_HOPS]) / WINDOW_HOPS)


def _rolling(db: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per window: the previous-200 ms minimum, the 1.5 s baseline median and the 300 ms peak."""
    count = len(db)
    prev = sliding_window_view(np.concatenate([np.full(PREV_HOPS, db[0]), db]), PREV_HOPS)
    prev_min = prev[:count].min(axis=1)
    span = BASE_FAR_HOPS - BASE_NEAR_HOPS + 1
    padded = np.concatenate([np.full(BASE_FAR_HOPS, db[0]), db])
    base = np.empty(count)
    for lo in range(0, count, 20_000):  # the median materializes its windows: do it in chunks
        hi = min(count, lo + 20_000)
        view = sliding_window_view(padded[lo : hi + span - 1], span)
        base[lo:hi] = np.median(view, axis=1)
    ahead = sliding_window_view(np.concatenate([db, np.full(PEAK_HOPS, db[-1])]), PEAK_HOPS)
    return prev_min, base, ahead[:count].max(axis=1)


def _hold_end(db: np.ndarray, onset_hop: int, baseline: float) -> float:
    """Onset plus the time to fall back near the baseline, held for 1 to 3 s."""
    after = db[onset_hop + PEAK_HOPS :]
    back = np.flatnonzero(after < baseline + RETURN_MARGIN_DB)
    fall_s = (PEAK_HOPS + (back[0] if len(back) else len(after))) * HOP_S
    return float(onset_hop * HOP_S + min(MAX_HOLD_S, max(MIN_HOLD_S, fall_s + 0.5)))


def find_onsets(hops: np.ndarray, rise_db: float = RISE_DB) -> tuple[LoudnessTrack, list[Onset]]:
    if len(hops) < WINDOW_HOPS + 1:
        return LoudnessTrack(np.zeros(0)), []
    db = _window_db(hops)
    hop_db = _to_db(hops)
    prev_min, base, peak = _rolling(db)
    rise = db - prev_min
    jump = peak - base
    window_end = (np.arange(len(db)) + WINDOW_HOPS) * HOP_S
    cand = np.flatnonzero(
        (rise >= rise_db)
        & (db - base >= rise_db)
        & (peak >= AUDIBLE_DB)
        & (window_end >= SKIP_START_S)
    )
    taken = np.zeros(len(db), bool)
    onsets: list[Onset] = []
    for i in cand[np.argsort(-jump[cand], kind="stable")]:
        if taken[max(0, i - SUPPRESS_HOPS) : i + SUPPRESS_HOPS].any():
            continue
        taken[i] = True
        # The strongest window can trail the rise: take the first window of the same rise.
        first = int(cand[(cand >= i - PREV_HOPS) & (cand <= i)][0])
        loud = np.flatnonzero(hop_db[first : first + WINDOW_HOPS] - prev_min[first] >= rise_db)
        hop = first + int(loud[0]) if len(loud) else first
        onsets.append(
            Onset(
                time=round(hop * HOP_S, 3),
                end=round(_hold_end(db, hop, float(base[i])), 3),
                baseline_db=round(float(base[i]), 1),
                peak_db=round(float(peak[i]), 1),
                rise_db=round(float(rise[i]), 1),
                jump_db=round(float(jump[i]), 1),
                strongest_window=round(int(i) * HOP_S, 3),
            )
        )
    onsets.sort(key=lambda o: o.time)
    return LoudnessTrack(db), onsets


def r128_summary(media: Path) -> dict[str, float]:
    """Integrated loudness, loudness range and true peak, as measured by ffmpeg's ebur128."""
    cmd = [tools.ffmpeg(), "-nostdin", "-hide_banner", "-i", str(media)]
    cmd += ["-map", "0:a:0", "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]
    stderr = tools.run(cmd).stderr
    summary: dict[str, float] = {}
    for key, pattern in (
        ("integrated_lufs", r"I:\s+(-?[\d.]+) LUFS"),
        ("loudness_range_lu", r"LRA:\s+(-?[\d.]+) LU"),
        ("true_peak_dbfs", r"Peak:\s+(-?[\d.]+) dBFS"),
    ):
        found = re.findall(pattern, stderr)
        if found:
            summary[key] = float(found[-1])
    return summary


def analyze(media: Path, rise_db: float = RISE_DB) -> LoudnessResult:
    media = Path(media)
    hops = _hop_energies(media)
    track, onsets = find_onsets(hops, rise_db)
    return LoudnessResult(
        track=track,
        onsets=onsets,
        duration_s=round(len(hops) * HOP_S, 3),
        summary=r128_summary(media),
    )
