"""Shot cuts: frames where the scene-change score passes a threshold.

Times are the presentation time of the first frame of each new shot, on the analyzed media's own
clock. The score is computed on a 320 px wide copy: it only needs the picture's layout, and
the narrower frame makes the scan several times faster.
"""

import re
from bisect import bisect_left, bisect_right
from pathlib import Path

from everyseat.detectors import tools

SCENE_THRESHOLD = 0.12


def find_cuts(media: Path, threshold: float = SCENE_THRESHOLD) -> list[float]:
    cmd = [tools.ffmpeg(), "-nostdin", "-hide_banner", "-i", str(media), "-an", "-sn"]
    cmd += ["-vf", f"scale=320:-2,select='gt(scene,{threshold})',showinfo", "-f", "null", "-"]
    stderr = tools.run(cmd).stderr
    return [round(float(t), 3) for t in re.findall(r"pts_time:([\d.]+)", stderr)]


def nearest(cuts: list[float], time: float, within: float) -> float | None:
    """The cut closest to `time` that lies within `within` seconds of it, if any."""
    i = bisect_left(cuts, time)
    near = [c for c in cuts[max(0, i - 1) : i + 1] if abs(c - time) <= within]
    return min(near, key=lambda c: abs(c - time)) if near else None


def count_between(cuts: list[float], start: float, end: float) -> int:
    return bisect_right(cuts, end) - bisect_left(cuts, start)
