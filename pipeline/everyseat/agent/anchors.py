"""Snapping a proposed time to the nearest detector anchor, or marking it approximate."""

from dataclasses import dataclass

from everyseat.detectors.candidates import Detection

ONSET_SNAP_S = 1.0
CUT_SNAP_S = 0.5
DEFAULT_LENGTH_S = 3.0


@dataclass(frozen=True)
class Snapped:
    start: float
    end: float
    anchor: str  # onset | cut | approx
    note: str  # the candidate id an onset snap landed on


def _nearest(values: list[float], target: float, within: float) -> float | None:
    near = [v for v in values if abs(v - target) <= within]
    return min(near, key=lambda v: abs(v - target)) if near else None


def snap(detection: Detection, start: float, end: float | None) -> Snapped:
    """Fix a loud or scary moment's `start` to a loud onset, else to a shot cut.

    The end keeps its proposed value (or a default length) unless it lies close to the onset's own
    end. With nothing in range the moment is `approx`: the player then widens its margins.
    """
    proxy = detection.proxy
    grid = proxy.snap
    end = start + DEFAULT_LENGTH_S if end is None else end

    onsets = [c for c in detection.candidates if c.type == "loud"]
    hit = _nearest([c.start for c in onsets], start, ONSET_SNAP_S)
    if hit is not None:
        onset = next(c for c in onsets if c.start == hit)
        tail = _nearest([onset.end], end, ONSET_SNAP_S)
        return Snapped(onset.start, grid(tail if tail is not None else end), "onset", onset.id)
    one_frame = 1 / proxy.fps
    cut = _nearest([proxy.source_time(c) for c in detection.cuts], start, CUT_SNAP_S)
    if cut is not None:
        return Snapped(grid(cut), grid(max(end, cut + one_frame)), "cut", "shot cut")
    first = grid(start)
    return Snapped(first, max(grid(end), round(first + one_frame, 3)), "approx", "no anchor")
