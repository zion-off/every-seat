"""A loudness strip: the level over a stretch of film, with onsets and shot cuts marked."""

from collections.abc import Sequence

from PIL import Image, ImageDraw, ImageFont

from everyseat.detectors.loudness import FLOOR_DB, LoudnessTrack
from everyseat.detectors.sheet import clock

MARGIN_LEFT, MARGIN_RIGHT, MARGIN_TOP, MARGIN_BOTTOM = 52, 12, 20, 26
GRID_DB = (-60, -40, -20, 0)


def _tick_step(span: float) -> float:
    for step in (0.5, 1.0, 2.0, 5.0, 10.0):
        if span / step <= 12:
            return step
    return 30.0


def loudness_strip(
    track: LoudnessTrack,
    t0: float,
    t1: float,
    *,
    label_offset: float = 0.0,
    onsets: Sequence[float] = (),
    cuts: Sequence[float] = (),
    size: tuple[int, int] = (1280, 200),
) -> Image.Image:
    """Plot the dBFS level of [t0, t1] (seconds in the analyzed media).

    Onsets are red vertical lines and shot cuts are cyan ticks along the top. The time axis reads
    film time: `label_offset` is where the media starts on the film's clock.
    """
    if t1 <= t0:
        raise ValueError("t1 must be after t0")
    width, height = size
    image = Image.new("RGB", size, (16, 16, 20))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=13)
    left, right = MARGIN_LEFT, width - MARGIN_RIGHT
    top, bottom = MARGIN_TOP, height - MARGIN_BOTTOM

    def x_of(t: float) -> float:
        return left + (t - t0) / (t1 - t0) * (right - left)

    def y_of(db: float) -> float:
        return bottom - (max(db, FLOOR_DB) - FLOOR_DB) / -FLOOR_DB * (bottom - top)

    for db in GRID_DB:
        draw.line((left, y_of(db), right, y_of(db)), fill=(52, 52, 60))
        draw.text((4, y_of(db) - 7), f"{db} dB", fill=(170, 170, 180), font=font)
    step = _tick_step(t1 - t0)
    tick = -(-t0 // step) * step
    while tick <= t1:
        draw.line((x_of(tick), bottom, x_of(tick), bottom + 4), fill=(170, 170, 180))
        draw.text(
            (x_of(tick) - 18, bottom + 7),
            clock(tick + label_offset),
            fill=(170, 170, 180),
            font=font,
        )
        tick += step

    times, levels = track.between(t0, t1)
    points = [(x_of(t + 0.025), y_of(float(db))) for t, db in zip(times, levels, strict=True)]
    if len(points) > 1:
        draw.line(points, fill=(240, 200, 70), width=2)
    for cut in cuts:
        if t0 <= cut <= t1:
            draw.line((x_of(cut), top - 14, x_of(cut), top - 2), fill=(70, 200, 230), width=2)
    for onset in onsets:
        if t0 <= onset <= t1:
            draw.line((x_of(onset), top, x_of(onset), bottom), fill=(240, 70, 70), width=2)
    draw.text(
        (left, 2), "level (dBFS)  red: loud onset  cyan: shot cut", fill=(200, 200, 210), font=font
    )
    return image
