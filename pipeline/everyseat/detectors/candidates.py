"""Candidate moments: what the detectors found, on the film's clock and on its frame grid.

A candidate is a place for the scene agent to look, never a verdict. Flash candidates come from
the flash analyzer's flagged runs, loud candidates from loudness onsets; each carries the numbers
the detector measured. Times are seconds in the source film, rounded to the proxy's frame grid.
"""

from dataclasses import asdict, dataclass, field
from pathlib import Path

from everyseat.detectors import cuts as cutlib
from everyseat.detectors import iris as irislib
from everyseat.detectors import loudness as loudlib
from everyseat.detectors.proxy import Proxy, build_proxy

SEVERITY = {"warning": 1, "extended_fail": 2, "flash_fail": 3}
FLASH_SCORE = {"warning": 20.0, "extended_fail": 90.0, "flash_fail": 100.0}
CUT_NEAR_S = 0.6  # a cut this close to an onset makes it a likely jump-scare
CUT_BURST_S = 2.0  # rapid editing after an onset


@dataclass
class Candidate:
    id: str
    type: str  # "flash" | "loud"
    start: float
    end: float
    anchor: str  # "iris" | "onset"
    score: float
    evidence: dict = field(default_factory=dict)


@dataclass
class Detection:
    proxy: Proxy
    source: str
    iris: irislib.IrisResult | None
    loudness: loudlib.LoudnessResult
    cuts: list[float]  # proxy time
    scene_threshold: float
    candidates: list[Candidate]

    def to_json(self) -> dict:
        p = self.proxy
        return {
            "version": 1,
            "source": {
                "file": self.source,
                "start_s": p.start_s,
                "duration_s": round(p.duration_s, 3),
                "fps": p.fps,
                "measured_fps": round(p.measured_fps, 3),
                "width": p.width,
                "height": p.height,
            },
            "iris": self._iris_json(),
            "loudness": {
                "summary": self.loudness.summary,
                "onsets": [
                    {
                        "time": p.snap(p.source_time(o.time)),
                        "time_exact": round(p.source_time(o.time), 3),
                        "end": p.snap(p.source_time(o.end)),
                        "baseline_db": o.baseline_db,
                        "peak_db": o.peak_db,
                        "rise_db": o.rise_db,
                        "jump_db": o.jump_db,
                        "strongest_window": round(p.source_time(o.strongest_window), 3),
                    }
                    for o in self.loudness.onsets
                ],
            },
            "cuts": {
                "threshold": self.scene_threshold,
                "times": [round(p.source_time(c), 3) for c in self.cuts],
            },
            "candidates": [asdict(c) for c in self.candidates],
        }

    def _iris_json(self) -> dict:
        if self.iris is None:
            return {"verdict": "NOT_RUN"}
        p = self.proxy
        return {
            "verdict": self.iris.verdict,
            "max_luminance_swing": self.iris.max_luminance_swing,
            "frames": self.iris.frames,
            "flagged_frames": self.iris.flagged,
            "elapsed_s": self.iris.elapsed_s,
            "runs": [
                {
                    "channel": r.channel,
                    "start": p.snap(p.source_time(r.start)),
                    "end": p.snap(p.source_time(r.end)),
                    "worst": r.worst,
                    "max_transitions": r.max_transitions,
                    "peak_swing": r.peak_swing,
                    "flagged_frames": r.flagged_frames,
                }
                for r in self.iris.runs
            ],
        }


def _flash_candidates(proxy: Proxy, result: irislib.IrisResult) -> list[Candidate]:
    """One candidate per stretch of flagged frames, merging the luminance and red channels."""
    merged: list[dict] = []
    for run in sorted(result.runs, key=lambda r: r.start):
        start, end = (
            proxy.snap(proxy.source_time(run.start)),
            proxy.snap(proxy.source_time(run.end)),
        )
        if merged and start <= merged[-1]["end"]:
            group = merged[-1]
            group["end"] = max(group["end"], end)
            group["channels"].append(run.channel)
            group["runs"].append(run)
        else:
            merged.append({"start": start, "end": end, "channels": [run.channel], "runs": [run]})
    out = []
    for group in merged:
        runs = group["runs"]
        worst = max((r.worst for r in runs), key=SEVERITY.__getitem__)
        out.append(
            Candidate(
                id="",
                type="flash",
                start=group["start"],
                end=group["end"],
                anchor="iris",
                score=FLASH_SCORE[worst],
                evidence={
                    "worst": worst,
                    "channels": sorted(set(group["channels"])),
                    "max_transitions": max(r.max_transitions for r in runs),
                    "peak_swing": max(r.peak_swing for r in runs),
                    "flagged_frames": sum(r.flagged_frames for r in runs),
                },
            )
        )
    return out


def _loud_candidates(
    proxy: Proxy, onsets: list[loudlib.Onset], cuts: list[float]
) -> list[Candidate]:
    out = []
    for onset in onsets:
        near = cutlib.nearest(cuts, onset.time, CUT_NEAR_S)
        burst = cutlib.count_between(cuts, onset.time - 0.1, onset.time + CUT_BURST_S)
        score = (
            onset.jump_db
            + (5 if near is not None else 0)
            + 2 * min(3, max(0, burst - 1))
            + 0.5 * (onset.peak_db + 20)
        )
        start = proxy.snap(proxy.source_time(onset.time))
        end = max(proxy.snap(proxy.source_time(onset.end)), round(start + 1 / proxy.fps, 3))
        out.append(
            Candidate(
                id="",
                type="loud",
                start=start,
                end=end,
                anchor="onset",
                score=round(score, 1),
                evidence={
                    "baseline_db": onset.baseline_db,
                    "peak_db": onset.peak_db,
                    "jump_db": onset.jump_db,
                    "rise_db": onset.rise_db,
                    "cut_offset_s": None if near is None else round(near - onset.time, 2),
                    "cuts_next_2s": burst,
                },
            )
        )
    return out


def detect(
    src: Path,
    work_dir: Path,
    *,
    start: float = 0.0,
    duration: float | None = None,
    with_iris: bool = True,
    scene_threshold: float = cutlib.SCENE_THRESHOLD,
) -> Detection:
    """Run every detector on `src` (or an excerpt of it) and merge the findings."""
    src = Path(src)
    proxy = build_proxy(src, work_dir, start=start, duration=duration)
    flash = irislib.run_iris(proxy, work_dir / "iris") if with_iris else None
    loud = loudlib.analyze(proxy.path)
    cuts = cutlib.find_cuts(proxy.path, scene_threshold)
    candidates = _loud_candidates(proxy, loud.onsets, cuts)
    if flash is not None:
        candidates += _flash_candidates(proxy, flash)
    candidates.sort(key=lambda c: (c.start, c.type))
    for number, candidate in enumerate(candidates, 1):
        candidate.id = f"c{number}"
    return Detection(proxy, src.name, flash, loud, cuts, scene_threshold, candidates)
