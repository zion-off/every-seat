#!/usr/bin/env python3
"""Export a title's audio description clips as small mono AAC files.

`everyseat describe` writes one WAV per description cue under `build/ad/<title>/`. This turns
them into `.m4a` files (mono AAC, 48 kbps by default) under `generated/ad/<title>/`, which is
small enough to keep in the repository, and points the cue file at them: the only change to the
cue file is the extension in each `audio_ref.uri` (`ad/<title>/<id>.wav` -> `.m4a`).

The companion serves `/ad/...` from `generated/ad` first and falls back to `build/ad`, so a title
plays the same before and after the export.

Usage:
  tools/media/export_ad.py <title> [--src build/ad] [--out generated/ad]
                           [--cues generated/<title>.sensevtt] [--bitrate 48k] [--no-rewrite]

Needs ffmpeg on PATH (or FFMPEG set).
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def encode(ffmpeg: str, wav: Path, m4a: Path, bitrate: str) -> None:
    tmp = m4a.with_name(m4a.name + ".part.m4a")
    subprocess.run(
        [
            ffmpeg, "-y", "-v", "error", "-i", str(wav),
            "-vn", "-ac", "1", "-c:a", "aac", "-b:a", bitrate,
            "-movflags", "+faststart", str(tmp),
        ],
        check=True,
    )
    tmp.replace(m4a)


def rewrite_cues(path: Path, title: str, exported: set[str]) -> int:
    """Point the cue file's clip addresses at the exported files; returns how many changed."""
    pattern = re.compile(r'("uri":"ad/' + re.escape(title) + r'/([A-Za-z0-9._-]+))\.wav"')
    count = 0

    def swap(match: re.Match[str]) -> str:
        nonlocal count
        if match.group(2) not in exported:
            return match.group(0)
        count += 1
        return f'{match.group(1)}.m4a"'

    text = pattern.sub(swap, path.read_text())
    if count:
        path.write_text(text)
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("title")
    parser.add_argument("--src", type=Path, default=ROOT / "build" / "ad")
    parser.add_argument("--out", type=Path, default=ROOT / "generated" / "ad")
    parser.add_argument("--cues", type=Path, help="cue file to update (default generated/<title>.sensevtt)")
    parser.add_argument("--bitrate", default="48k")
    parser.add_argument("--no-rewrite", action="store_true", help="leave the cue file as it is")
    args = parser.parse_args()

    ffmpeg = os.environ.get("FFMPEG", "ffmpeg")
    if shutil.which(ffmpeg) is None:
        print("export_ad: ffmpeg not found on PATH", file=sys.stderr)
        return 1
    wavs = sorted((args.src / args.title).glob("*.wav"))
    if not wavs:
        print(f"export_ad: no .wav files under {args.src / args.title}", file=sys.stderr)
        return 1

    out_dir = args.out / args.title
    out_dir.mkdir(parents=True, exist_ok=True)
    for wav in wavs:
        encode(ffmpeg, wav, out_dir / f"{wav.stem}.m4a", args.bitrate)
    for stale in out_dir.glob("*.m4a"):
        if not (args.src / args.title / f"{stale.stem}.wav").exists():
            stale.unlink()
    size = sum(f.stat().st_size for f in out_dir.glob("*.m4a"))
    print(f"export_ad: {len(wavs)} clips, {size / 1024:.0f} KiB in {out_dir}")

    if not args.no_rewrite:
        cues = args.cues or ROOT / "generated" / f"{args.title}.sensevtt"
        if cues.exists():
            changed = rewrite_cues(cues, args.title, {w.stem for w in wavs})
            print(f"export_ad: {changed} clip addresses updated in {cues}")
        else:
            print(f"export_ad: no cue file at {cues}; nothing rewritten")
    return 0


if __name__ == "__main__":
    sys.exit(main())
