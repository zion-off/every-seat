"""The picture for a window: one frame per shot, tiled on a contact sheet labelled in seconds."""

from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from everyseat.describe.subtitles import Window
from everyseat.detectors import sheet

MIN_TILES, MAX_TILES = 4, 12
TILE_WIDTH = 320
COLUMNS = 4
# A frame this close to a cut can still show the old shot, so frames are taken just after it.
AFTER_CUT_S = 0.1


@dataclass(frozen=True)
class WindowPicture:
    times: list[float]
    image: Image.Image

    @property
    def jpeg(self) -> bytes:
        return sheet.jpeg_bytes(self.image)


def pick_times(cuts: list[float], window: Window) -> list[float]:
    """Frame times for a window: its first frame, the start of each shot inside it, and a last
    frame. A window with few shots is filled out evenly to `MIN_TILES`; one with more than
    `MAX_TILES` shots keeps an even selection.
    """
    first = bisect_right(cuts, window.start)
    shots = [round(c + AFTER_CUT_S, 3) for c in cuts[first:] if c + AFTER_CUT_S < window.end]
    last = round(window.end - AFTER_CUT_S, 3)
    times = [window.start, *shots, last]
    if len(times) > MAX_TILES:
        step = (len(times) - 1) / (MAX_TILES - 1)
        times = [times[round(i * step)] for i in range(MAX_TILES)]
    if len(times) < MIN_TILES:
        times = sheet.evenly(window.start, last, MIN_TILES)
    return sorted(set(times))


def window_picture(media: Path, cuts: list[float], window: Window) -> WindowPicture:
    times = pick_times(cuts, window)
    image = sheet.contact_sheet(
        media, times, tile_width=TILE_WIDTH, columns=COLUMNS, label=sheet.plain_seconds
    )
    return WindowPicture(times, image)
