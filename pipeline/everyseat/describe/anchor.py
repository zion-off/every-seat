"""Anchoring spoken items to the shots they describe.

The writer says which contact-sheet frame each sentence is about; this module, not the writer,
decides when the sentence is spoken: at that frame's time, pulled back to the start of its shot
only when the shot began just before it (a long shot is not narrated before its action), after a
small lag so the speech follows the picture, kept inside the window, with the clips kept apart.
"""

from bisect import bisect_right
from dataclasses import dataclass

from everyseat.describe.review import MIN_WORDS
from everyseat.describe.subtitles import Window

CLIP_GAP_S = 0.3  # a clip ends at least this long before the next one starts
WORDS_PER_SECOND = 2.5
SAME_TIME_S = 0.0005
SNAP_BACK_S = 0.5  # an item is pulled back to its shot's start only when it began this close
LAG_S = 0.2  # speech starts this long after the picture it describes
MIN_SLOT_S = 2.5  # an item with less time than this is dropped, not squeezed
MAX_CLIP_S = 8.0  # one item never runs longer, however much quiet follows it
SECONDS_PER_ITEM = 5.0  # pace: at most one item per this much window


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


def on_grid(seconds: float, fps: int) -> float:
    return round(round(seconds * fps) / fps, 3)


def shot_start(cuts: list[float], time: float, window: Window) -> float:
    """The start of the shot that contains `time`, no earlier than the window's start."""
    i = bisect_right(cuts, time + 1e-6)
    return max(window.start, cuts[i - 1] if i else window.start)


def anchor_time(
    cuts: list[float], time: float, window: Window, fps: int
) -> tuple[float, float, str]:
    """When an item about the frame at `time` starts, the anchor before the lag and the reason.

    The anchor is `time`, or its shot's start when that is within `SNAP_BACK_S` before it; the
    item never moves earlier than that. The start is on the frame grid, after `LAG_S`, and inside
    the window.
    """
    shot = shot_start(cuts, time, window)
    if time - shot <= SNAP_BACK_S:
        anchor, reason = shot, f"snapped to its shot start, {time - shot:.2f} s before"
    else:
        anchor, reason = time, f"kept at its frame: its shot began {time - shot:.1f} s earlier"
    return max(window.start, on_grid(anchor + LAG_S, fps)), anchor, reason


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
        start, anchor, reason = anchor_time(cuts, time, window, fps)
        if time == item.at_s:
            kind = "snapped" if anchor != time else "kept"
            decisions.append(
                {"kind": kind, "at_s": item.at_s, "to": start, "reason": reason, "text": item.text}
            )
        if placed and abs(placed[-1].start - start) <= SAME_TIME_S:
            last = placed[-1]
            placed[-1] = Placed(start, f"{last.text} {item.text}", (*last.at_s, item.at_s))
            decisions.append(
                {"kind": "merged", "at_s": item.at_s, "into": start, "reason": "same shot"}
            )
        else:
            placed.append(Placed(start, item.text, (item.at_s,)))
    placed = _pace(placed, window, fps, decisions)
    return placed, decisions


def max_items(window: Window) -> int:
    return max(1, int(window.duration / SECONDS_PER_ITEM))


def _drop(placed: list[Placed], index: int, reason: str, decisions: list[dict]) -> None:
    item = placed.pop(index)
    decisions.append({"kind": "dropped", "start": item.start, "text": item.text, "reason": reason})


def _minor(placed: list[Placed], a: int, b: int) -> int:
    """Which of two items says less: the one with fewer words, the later one on a tie."""
    return a if len(placed[a].text.split()) < len(placed[b].text.split()) else b


def _pace(placed: list[Placed], window: Window, fps: int, decisions: list[dict]) -> list[Placed]:
    """Let the film breathe: drop the minor one of two items too close for a slot of
    `MIN_SLOT_S`, an item too near the window's end, and the minor items beyond `max_items`.
    """
    placed = list(placed)
    need = MIN_SLOT_S + CLIP_GAP_S + 1 / fps
    while True:
        close = [i for i in range(len(placed) - 1) if placed[i + 1].start - placed[i].start < need]
        if close:
            i = close[0]
            _drop(
                placed,
                _minor(placed, i, i + 1),
                f"less than {need:.1f} s to the next item",
                decisions,
            )
        elif placed and window.end - placed[-1].start < MIN_SLOT_S + 1 / fps:
            _drop(placed, len(placed) - 1, "too close to the window's end", decisions)
        else:
            break
    cap = max_items(window)
    while len(placed) > cap:
        minor = min(range(len(placed)), key=lambda i: (len(placed[i].text.split()), -i))
        _drop(
            placed,
            minor,
            f"pace: at most {cap} items in a {window.duration:.0f} s window",
            decisions,
        )
    return placed


def slot_limit_s(start: float, next_start: float | None, window: Window, fps: int) -> float:
    """Seconds a clip starting at `start` may last: it must end `CLIP_GAP_S` before the next
    clip starts, or a frame before the window ends, which leaves room for the frame rounding.
    """
    end = window.end if next_start is None else next_start - CLIP_GAP_S
    return round(min(end - start, MAX_CLIP_S) - 1 / fps, 3)


def slot_words(limit_s: float) -> int:
    return int(limit_s * WORDS_PER_SECOND)


def fits_any(limit_s: float) -> bool:
    """Whether a slot is long enough for a natural sentence at all."""
    return limit_s >= MIN_SLOT_S - 1e-6 and slot_words(limit_s) >= MIN_WORDS
