"""Contact sheets: frames pulled from a proxy at chosen times, tiled and time-labelled.

Frames are never resized for flash analysis, but a sheet is only for a person or a vision model
to look at, so tiles are scaled down to `tile_width`.
"""

import io
from collections.abc import Sequence
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from everyseat.detectors import tools

LABEL_PAD = 3


def clock(seconds: float) -> str:
    """`h:mm:ss.s` (or `m:ss.s` under an hour), the way a player shows a position."""
    whole, tenths = divmod(round(seconds * 10), 10)
    minutes, secs = divmod(whole, 60)
    hours, minutes = divmod(minutes, 60)
    head = f"{hours}:{minutes:02d}" if hours else f"{minutes}"
    return f"{head}:{secs:02d}.{tenths}"


def evenly(start: float, end: float, count: int) -> list[float]:
    """`count` times spread over [start, end], including both ends when count > 1."""
    if count <= 1:
        return [round((start + end) / 2, 3)]
    step = (end - start) / (count - 1)
    return [round(start + i * step, 3) for i in range(count)]


def frame_at(media: Path, time: float, tile_width: int) -> Image.Image:
    cmd = [tools.ffmpeg(), *("-v", "error", "-nostdin", "-ss", f"{max(0.0, time):.3f}")]
    cmd += ["-i", str(media), *("-map", "0:v:0", "-frames:v", "1")]
    cmd += ["-vf", f"scale={tile_width}:-2", *("-f", "image2pipe", "-vcodec", "png", "pipe:1")]
    data = tools.run(cmd, binary=True).stdout
    if not data:
        raise tools.ToolError(f"no frame at {time:.3f} s in {media.name}")
    return Image.open(io.BytesIO(data)).convert("RGB")


def contact_sheet(
    media: Path,
    times: Sequence[float],
    *,
    tile_width: int = 320,
    columns: int = 4,
    label_offset: float = 0.0,
) -> Image.Image:
    """Tile the frames at `times` (seconds in `media`), each labelled with `time + label_offset`.

    `label_offset` is where the media starts on the film's clock, so labels read as film time.
    """
    if not times:
        raise ValueError("no times to show")
    frames = [frame_at(media, t, tile_width) for t in times]
    width, height = frames[0].size
    columns = max(1, min(columns, len(frames)))
    rows = -(-len(frames) // columns)
    sheet = Image.new("RGB", (columns * width, rows * height), "black")
    font = ImageFont.load_default(size=max(12, tile_width // 20))
    for index, (frame, time) in enumerate(zip(frames, times, strict=True)):
        x, y = (index % columns) * width, (index // columns) * height
        sheet.paste(frame.resize((width, height)), (x, y))
        draw = ImageDraw.Draw(sheet)
        text = clock(time + label_offset)
        left, top, right, bottom = draw.textbbox((x + LABEL_PAD, y + LABEL_PAD), text, font=font)
        draw.rectangle((left - 2, top - 2, right + 2, bottom + 2), fill="black")
        draw.text((x + LABEL_PAD, y + LABEL_PAD), text, fill="white", font=font)
    return sheet


def jpeg_bytes(image: Image.Image, quality: int = 80) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()
