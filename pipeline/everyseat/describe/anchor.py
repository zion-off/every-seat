"""Anchoring spoken items to the shots they describe.

The writer says which contact-sheet frame each sentence is about; this module, not the writer,
decides when the sentence is spoken: at the start of the shot that contains that frame, kept
inside the window, with the clips kept apart.
"""

from bisect import bisect_right
from dataclasses import dataclass

from everyseat.describe.review import MIN_WORDS
from everyseat.describe.subtitles import Window

CLIP_GAP_S = 0.3  # a clip ends at least this long before the next one starts
WORDS_PER_SECOND = 2.5
SAME_TIME_S = 0.0005


@dataclass(frozen=True)
class Item:
    """One sentence or two, and the time of the frame it describes."""

    at_s: float
    text: str


@dataclass(frozen=True)
class Placed:
    start: float  # the start of a shot, on the frame grid, inside the window
    text: str
    at_s: tuple[float, ...]  # the times the writer gave, one per merged item


def shot_start(cuts: list[float], time: float, window: Window, fps: int) -> float:
    """The start of the shot that contains `time`, no earlier than the window's start."""
    i = bisect_right(cuts, time + 1e-6)
    cut = cuts[i - 1] if i else window.start
    return max(window.start, round(round(cut * fps) / fps, 3))


def place(
    items: list[Item], window: Window, cuts: list[float], fps: int
) -> tuple[list[Placed], list[dict]]:
    """Snap each item to its shot, clamp to the window, sort and merge items on the same shot.

    Returns the placed items and a decision for each thing that was done to an item.
    """
    decisions: list[dict] = []
    placed: list[Placed] = []
    for item in sorted(items, key=lambda i: i.at_s):
        if item.at_s >= window.end:
            decisions.append(
                {
                    "kind": "rejected",
                    "at_s": item.at_s,
                    "text": item.text,
                    "reason": f"at {item.at_s:g} s, after the window ends at {window.end:g} s",
                }
            )
            continue
        time = item.at_s
        if time < window.start:
            decisions.append(
                {
                    "kind": "clamped",
                    "at_s": item.at_s,
                    "to": window.start,
                    "reason": f"at {item.at_s:g} s, before the window starts at {window.start:g} s",
                }
            )
            time = window.start
        start = shot_start(cuts, time, window, fps)
        if abs(start - item.at_s) > SAME_TIME_S and time == item.at_s:
            decisions.append({"kind": "snapped", "at_s": item.at_s, "to": start, "text": item.text})
        if placed and abs(placed[-1].start - start) <= SAME_TIME_S:
            last = placed[-1]
            placed[-1] = Placed(start, f"{last.text} {item.text}", (*last.at_s, item.at_s))
            decisions.append(
                {"kind": "merged", "at_s": item.at_s, "into": start, "reason": "same shot"}
            )
        else:
            placed.append(Placed(start, item.text, (item.at_s,)))
    return placed, decisions


def slot_limit_s(start: float, next_start: float | None, window: Window, fps: int) -> float:
    """Seconds a clip starting at `start` may last: it must end `CLIP_GAP_S` before the next
    clip starts, or a frame before the window ends, which leaves room for the frame rounding.
    """
    end = window.end if next_start is None else next_start - CLIP_GAP_S
    return round(end - start - 1 / fps, 3)


def slot_words(limit_s: float) -> int:
    return int(limit_s * WORDS_PER_SECOND)


def fits_any(limit_s: float) -> bool:
    """Whether a slot can hold the shortest acceptable description at all."""
    return slot_words(limit_s) >= MIN_WORDS
