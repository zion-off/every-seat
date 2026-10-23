"""The picture for a window: numbered stills tiled on a contact sheet, each labelled in seconds.

Every shot gets a still, and no stretch of a shot lasts more than `PERIOD_S` without one, so the
writer can cite a still that shows what it describes at the moment it is on screen. A still that
is black or one flat colour has nothing to describe and is marked so.
"""

import math
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageStat

from everyseat.describe.subtitles import Window
from everyseat.detectors import sheet

MAX_TILES = 16  # four rows of four: a sheet stays small enough to read
TILE_WIDTH = 320
COLUMNS = 4
# A frame this close to a cut can still show the old shot, so frames are taken just after it.
AFTER_CUT_S = 0.1
PERIOD_S = 3.0  # a stretch of a shot longer than this gets frames inside it
MIN_SPACING_S = 0.5  # two frames closer than this show the same thing
MIN_LUMA = 12.0  # a frame with a lower mean luma (0 to 255) is black
MIN_SPREAD = 5.0  # a frame whose luma varies less than this (standard deviation) is flat


@dataclass(frozen=True)
class Tile:
    """One still on the sheet: its number (from 1, in reading order), its time and how much there
    is to see in it.
    """

    number: int
    time: float
    luma: float  # mean luma, 0 to 255
    spread: float  # standard deviation of the luma

    @property
    def problem(self) -> str | None:
        """Why nothing can be described from this still, or None when it can be."""
        if self.luma < MIN_LUMA:
            return "black"
        if self.spread < MIN_SPREAD:
            return "one flat colour"
        return None

    @property
    def usable(self) -> bool:
        return self.problem is None

    def label(self) -> str:
        return f"{self.number}: {sheet.plain_seconds(self.time)}"

    def measured(self) -> str:
        text = f"{self.time:g} s, luma {self.luma:.1f}, spread {self.spread:.1f}"
        return text if self.usable else f"{text}: not describable, {self.problem}"


@dataclass(frozen=True)
class WindowPicture:
    tiles: list[Tile]
    image: Image.Image

    @property
    def jpeg(self) -> bytes:
        return sheet.jpeg_bytes(self.image)


def pick_times(cuts: list[float], window: Window) -> list[float]:
    """Frame times for a window: its first frame, the start of each shot inside it and a last
    frame, with frames added inside any stretch longer than `PERIOD_S`. A window with more than
    `MAX_TILES` frames loses those with the closest neighbours.
    """
    first = bisect_right(cuts, window.start)
    shots = [round(c + AFTER_CUT_S, 3) for c in cuts[first:] if c + AFTER_CUT_S < window.end]
    last = round(window.end - AFTER_CUT_S, 3)
    return _capped(_filled(_spaced([window.start, *shots, last])))


def _spaced(times: list[float]) -> list[float]:
    kept = [times[0]]
    for time in times[1:]:
        if time - kept[-1] >= MIN_SPACING_S:
            kept.append(time)
        elif len(kept) == 1:  # the window's first frame is the old shot for a moment only
            kept[0] = time
    return kept


def _filled(times: list[float]) -> list[float]:
    filled = [times[0]]
    for time in times[1:]:
        previous = filled[-1]
        parts = math.ceil((time - previous) / PERIOD_S - 1e-9)
        filled += [round(previous + (time - previous) * k / parts, 3) for k in range(1, parts)]
        filled.append(time)
    return filled


def _capped(times: list[float]) -> list[float]:
    times = list(times)
    while len(times) > MAX_TILES:
        crowded = min(range(1, len(times) - 1), key=lambda i: times[i + 1] - times[i - 1])
        del times[crowded]
    return times


def measure(frame: Image.Image) -> tuple[float, float]:
    """The mean and the standard deviation of a frame's luma."""
    stat = ImageStat.Stat(frame.convert("L"))
    return stat.mean[0], stat.stddev[0]


def window_picture(media: Path, cuts: list[float], window: Window) -> WindowPicture:
    times = pick_times(cuts, window)
    frames = [sheet.frame_at(media, t, TILE_WIDTH) for t in times]
    tiles = [Tile(n, t, *measure(f)) for n, (t, f) in enumerate(zip(times, frames, strict=True), 1)]
    image = sheet.tile_frames(frames, [t.label() for t in tiles], columns=COLUMNS)
    return WindowPicture(tiles, image)
