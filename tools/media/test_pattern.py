#!/usr/bin/env python3
"""Generate a timecode test stream as HLS with a main and a comfort audio rendition.

Video: 1280x720 at a constant frame rate (30 by default) with 1 s GOPs. Each frame carries the
burnt-in media time and frame number, a 16-bit frame-number barcode (most significant bit first,
white block to its left and black block to its right), a moving sweep bar, and a gray (128) and a
white (255) reference patch for measuring dimming on screen.
Audio: a 440 Hz tone as the main rendition and an 880 Hz tone as the comfort rendition, both
sine at -6 dBFS peak.

Frames are drawn in pure Python with a built-in bitmap font because many ffmpeg builds lack the
drawtext filter; only ffmpeg is required.

Usage: test_pattern.py --out DIR [--duration SECONDS] [--fps N]
Environment: FFMPEG overrides the ffmpeg path.
"""

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

W, H = 1280, 720
BAR_Y0, BAR_Y1 = 120, 170
BIT_W, NBITS, BAR_X0 = 64, 16, 128
SWEEP_Y0, SWEEP_Y1, SWEEP_W = 190, 450, 20
GRAY_PATCH = (1000, 470, 1160, 630)
WHITE_PATCH = (820, 470, 980, 630)
COLOR_BARS = [
    (192, 192, 192),
    (192, 192, 0),
    (0, 192, 192),
    (0, 192, 0),
    (192, 0, 192),
    (192, 0, 0),
    (0, 0, 192),
]
TEXT_X, TEXT_Y, TIMECODE_SCALE = 20, 27, 8
LABEL_X, LABEL_SCALE = 20, 5

GLYPHS = {
    "0": ".###. #...# #..## #.#.# ##..# #...# .###.",
    "1": "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.",
    "2": ".###. #...# ....# ...#. ..#.. .#... #####",
    "3": "##### ...#. ..#.. ...#. ....# #...# .###.",
    "4": "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
    "5": "##### #.... ####. ....# ....# #...# .###.",
    "6": "..##. .#... #.... ####. #...# #...# .###.",
    "7": "##### ....# ...#. ..#.. .#... .#... .#...",
    "8": ".###. #...# #...# .###. #...# #...# .###.",
    "9": ".###. #...# #...# .#### ....# ...#. .##..",
    ":": "..... ..#.. ..#.. ..... ..#.. ..#.. .....",
    ".": "..... ..... ..... ..... ..... .##.. .##..",
    " ": "..... ..... ..... ..... ..... ..... .....",
    "A": ".###. #...# #...# ##### #...# #...# #...#",
    "E": "##### #.... #.... ####. #.... #.... #####",
    "F": "##### #.... #.... ####. #.... #.... #....",
    "G": ".###. #...# #.... #.### #...# #...# .###.",
    "H": "#...# #...# #...# ##### #...# #...# #...#",
    "I": ".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
    "N": "#...# ##..# #.#.# #..## #...# #...# #...#",
    "P": "####. #...# #...# ####. #.... #.... #....",
    "R": "####. #...# #...# ####. #.#.. #..#. #...#",
    "S": ".#### #.... #.... .###. ....# ....# ####.",
    "T": "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
    "W": "#...# #...# #...# #.#.# #.#.# ##.## #...#",
    "Y": "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
}


def glyph_rows(char: str, scale: int, color: tuple[int, int, int]) -> list[bytes]:
    """Rows of one character (5x7 cells plus a one-cell gap), scaled and as rgb24 bytes."""
    on, off = bytes(color) * scale, bytes(3) * scale
    rows = []
    for line in GLYPHS[char].split():
        row = b"".join(on if cell == "#" else off for cell in line) + off
        rows.extend([row] * scale)
    return rows


class Frame:
    def __init__(self, data: bytearray | None = None) -> None:
        self.data = data if data is not None else bytearray(W * H * 3)

    def copy(self) -> "Frame":
        return Frame(bytearray(self.data))

    def fill(self, x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int]) -> None:
        row = bytes(color) * (x1 - x0)
        for y in range(y0, y1):
            start = (y * W + x0) * 3
            self.data[start : start + len(row)] = row

    def text(self, x: int, y: int, text: str, scale: int, glyphs: dict[str, list[bytes]]) -> None:
        for i, char in enumerate(text):
            cell_w = 6 * scale * 3
            for dy, row in enumerate(glyphs[char]):
                start = ((y + dy) * W + x) * 3 + i * cell_w
                self.data[start : start + cell_w] = row


def build_base(label_glyphs: dict[str, list[bytes]]) -> Frame:
    base = Frame()
    bar_w = W // len(COLOR_BARS)
    for i, color in enumerate(COLOR_BARS):
        base.fill(i * bar_w, SWEEP_Y0, (i + 1) * bar_w, SWEEP_Y1, color)
    base.fill(0, SWEEP_Y1, W, H, (40, 40, 40))
    base.fill(*GRAY_PATCH, (128, 128, 128))
    base.fill(*WHITE_PATCH, (255, 255, 255))
    base.fill(BAR_X0 - BIT_W, BAR_Y0, BAR_X0, BAR_Y1, (255, 255, 255))
    base.fill(BAR_X0 + NBITS * BIT_W, BAR_Y0, BAR_X0 + NBITS * BIT_W + BIT_W, BAR_Y1, (0, 0, 0))
    for y, label in ((470, "TEST PATTERN"), (520, "GRAY 128"), (570, "WHITE 255")):
        base.text(LABEL_X, y, label, LABEL_SCALE, label_glyphs)
    return base


def draw_frame(
    base: Frame, n: int, fps: int, glyphs: dict[str, list[bytes]], bit_block: bytes
) -> bytes:
    frame = base.copy()
    sweep_x = int((n % fps) / fps * (W - SWEEP_W))
    frame.fill(sweep_x, SWEEP_Y0, sweep_x + SWEEP_W, SWEEP_Y1, (255, 255, 255))
    for bit in range(NBITS):
        if (n >> (NBITS - 1 - bit)) & 1:
            x = BAR_X0 + bit * BIT_W
            for y in range(BAR_Y0, BAR_Y1):
                start = (y * W + x) * 3
                frame.data[start : start + len(bit_block)] = bit_block
    ms = n * 1000 // fps
    timecode = f"{ms // 60000:02d}:{ms % 60000 // 1000:02d}.{ms % 1000:03d}  F{n:05d}"
    frame.text(TEXT_X, TEXT_Y, timecode, TIMECODE_SCALE, glyphs)
    return bytes(frame.data)


def run_ffmpeg(ffmpeg: str, *args: str) -> None:
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-nostdin", *args], check=True
    )


def write_tone(ffmpeg: str, path: Path, hz: int, duration: int) -> None:
    expr = f"0.5*sin(2*PI*{hz}*t)"
    run_ffmpeg(
        ffmpeg,
        *("-f", "lavfi", "-i", f"aevalsrc={expr}|{expr}:s=48000:d={duration}"),
        *("-c:a", "pcm_s16le", str(path)),
    )


def write_video(ffmpeg: str, path: Path, duration: int, fps: int) -> None:
    timecode_glyphs = {c: glyph_rows(c, TIMECODE_SCALE, (255, 255, 255)) for c in "0123456789:. F"}
    label_glyphs = {c: glyph_rows(c, LABEL_SCALE, (200, 200, 200)) for c in GLYPHS}
    base = build_base(label_glyphs)
    bit_block = bytes((255, 255, 255)) * BIT_W
    command = [
        ffmpeg,
        *("-hide_banner", "-loglevel", "error", "-y"),
        *("-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-"),
        *("-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"),
        *("-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"),
        *("-c:v", "ffv1", str(path)),
    ]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for n in range(duration * fps):
            encoder.stdin.write(draw_frame(base, n, fps, timecode_glyphs, bit_block))
    except BrokenPipeError:
        pass
    finally:
        encoder.stdin.close()
    if encoder.wait() != 0:
        raise SystemExit("error: ffmpeg failed while encoding the frames")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the timecode test stream as HLS.")
    parser.add_argument("--out", required=True, type=Path, help="output directory")
    parser.add_argument("--duration", type=int, default=120, help="length in seconds (default 120)")
    parser.add_argument("--fps", type=int, default=30, help="frame rate (default 30)")
    args = parser.parse_args()
    if args.duration < 1 or not 1 <= args.fps <= 60 or args.fps * args.duration >= 1 << NBITS:
        print(f"error: need duration >= 1, 1 <= fps <= 60, and fewer than {1 << NBITS} frames")
        return 2

    ffmpeg = os.environ.get("FFMPEG", "ffmpeg")
    packager = Path(__file__).resolve().parent / "hls_package.sh"
    try:
        with tempfile.TemporaryDirectory(prefix="test-pattern-") as tmp:
            video, main_audio, comfort_audio = (Path(tmp) / n for n in ("v.mkv", "m.wav", "c.wav"))
            write_tone(ffmpeg, main_audio, 440, args.duration)
            write_tone(ffmpeg, comfort_audio, 880, args.duration)
            write_video(ffmpeg, video, args.duration, args.fps)
            subprocess.run(
                [
                    str(packager),
                    *("--video", str(video)),
                    *("--audio", str(main_audio)),
                    *("--comfort", str(comfort_audio)),
                    *("--out", str(args.out)),
                    *("--fps", str(args.fps)),
                ],
                check=True,
            )
    except FileNotFoundError:
        print("error: ffmpeg not found (set FFMPEG to its path)", file=sys.stderr)
        return 2
    except subprocess.CalledProcessError as err:
        return err.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())
