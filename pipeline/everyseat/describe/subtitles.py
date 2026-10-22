"""Dialogue timing from subtitles, and the quiet windows between the lines."""

import math
import re
from dataclasses import dataclass
from pathlib import Path

from everyseat.describe import DescribeError

MIN_GAP_S = 10.0
EDGE_MARGIN_S = 0.5
MAX_WINDOW_S = 30.0

_TIMING = re.compile(
    r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})"
)
_TAGS = re.compile(r"<[^>]*>|\{\\[^}]*\}")


@dataclass(frozen=True)
class Line:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Window:
    """A stretch with no dialogue, on the frame grid, in seconds of film time."""

    index: int
    start: float
    end: float

    @property
    def duration(self) -> float:
        return round(self.end - self.start, 3)


def _seconds(hours: str, minutes: str, seconds: str, millis: str) -> float:
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis.ljust(3, "0")) / 1000


def parse_srt(text: str) -> list[Line]:
    """The cues of an SRT file, in time order, with markup removed."""
    lines: list[Line] = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").lstrip("\ufeff")):
        rows = [row for row in block.strip().split("\n") if row.strip()]
        for position, row in enumerate(rows):
            match = _TIMING.search(row)
            if not match:
                continue
            start = _seconds(*match.groups()[:4])
            end = _seconds(*match.groups()[4:])
            spoken = " ".join(_TAGS.sub("", r).strip() for r in rows[position + 1 :]).strip()
            if spoken and end > start:
                lines.append(Line(start, end, spoken))
            break
    if not lines:
        raise DescribeError("no subtitle lines found")
    return sorted(lines, key=lambda line: line.start)


def read_srt(path: Path) -> list[Line]:
    if not path.is_file():
        raise DescribeError(f"no such subtitle file: {path}")
    return parse_srt(path.read_text(encoding="utf-8", errors="replace"))


def _on_grid(seconds: float, fps: int, *, up: bool) -> float:
    frames = seconds * fps
    snapped = math.ceil(frames - 1e-6) if up else math.floor(frames + 1e-6)
    return round(snapped / fps, 3)


def find_windows(
    lines: list[Line],
    duration_s: float,
    fps: int,
    *,
    min_gap_s: float = MIN_GAP_S,
    margin_s: float = EDGE_MARGIN_S,
    max_window_s: float = MAX_WINDOW_S,
) -> list[Window]:
    """Quiet stretches of at least `min_gap_s` between dialogue lines (and before the first and
    after the last), trimmed by `margin_s` at each end. A stretch longer than `max_window_s` is
    split into equal windows no longer than that, so a description stays close to the picture it
    describes. Times lie on the `fps` frame grid, inside the stretch.
    """
    gaps: list[tuple[float, float]] = []
    cursor = 0.0
    for line in lines:
        if line.start - cursor >= min_gap_s:
            gaps.append((cursor, line.start))
        cursor = max(cursor, line.end)
    if duration_s - cursor >= min_gap_s:
        gaps.append((cursor, duration_s))

    windows: list[Window] = []
    for gap_start, gap_end in gaps:
        start = _on_grid(gap_start + margin_s, fps, up=True)
        end = _on_grid(gap_end - margin_s, fps, up=False)
        if end - start <= 0:
            continue
        pieces = max(1, math.ceil((end - start) / max_window_s - 1e-9))
        edges = [start]
        for piece in range(1, pieces):
            edges.append(_on_grid(start + (end - start) * piece / pieces, fps, up=False))
        edges.append(end)
        for left, right in zip(edges, edges[1:], strict=False):
            windows.append(Window(len(windows) + 1, left, right))
    return windows


def around(lines: list[Line], window: Window, count: int = 2) -> tuple[list[Line], list[Line]]:
    """Up to `count` dialogue lines that end before the window and that begin after it."""
    before = [line for line in lines if line.end <= window.start][-count:]
    after = [line for line in lines if line.start >= window.end][:count]
    return before, after
