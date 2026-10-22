"""Constant-frame-rate analysis proxy.

Always analyze a proxy, never the source: sources can have a variable frame rate or a header
that misreports it, and the flash analyzer rounds the rate to an integer. The rate is measured
(video packets divided by stream duration) and snapped to an integer, so a 23.976 fps source
gets a 24 fps proxy and every detector time lies on one frame grid.

The proxy keeps the source resolution by default: resizing frames changes the flash verdict.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from everyseat.detectors import tools

STANDARD_FPS = (24, 25, 30, 48, 50, 60)
_META = "proxy.json"


@dataclass(frozen=True)
class Proxy:
    path: Path
    fps: int
    measured_fps: float
    width: int
    height: int
    duration_s: float
    start_s: float  # where the proxy's first frame sits in the source

    def source_time(self, proxy_time: float) -> float:
        return proxy_time + self.start_s

    def proxy_time(self, source_time: float) -> float:
        return source_time - self.start_s

    def snap(self, source_time: float) -> float:
        """Nearest frame time on the proxy's grid, rounded to milliseconds."""
        return round(round(source_time * self.fps) / self.fps, 3)

    @property
    def end_s(self) -> float:
        return self.start_s + self.duration_s


def nearest_standard_fps(measured: float) -> int:
    return min(STANDARD_FPS, key=lambda rate: abs(rate - measured))


def probe_source(src: Path) -> tuple[int, float]:
    """The integer proxy rate and the measured rate of the first video stream of `src`."""
    out = tools.run(
        [
            tools.ffprobe(),
            *("-v", "error", "-select_streams", "v:0", "-count_packets"),
            *("-show_entries", "stream=nb_read_packets,duration:format=duration", "-of", "json"),
            src,
        ]
    )
    data = json.loads(out.stdout)
    streams = data.get("streams") or []
    if not streams:
        raise tools.ToolError(f"no video stream in {src.name}")
    stream = streams[0]
    duration = stream.get("duration")
    if duration in (None, "N/A"):
        duration = data.get("format", {}).get("duration")
    packets = stream.get("nb_read_packets")
    if not packets or not duration or float(duration) <= 0:
        raise tools.ToolError(f"cannot read the frame rate of {src.name}")
    measured = int(packets) / float(duration)
    return nearest_standard_fps(measured), measured


def _describe(path: Path, fps: int, measured: float, start_s: float) -> Proxy:
    out = tools.run(
        [
            tools.ffprobe(),
            *("-v", "error", "-select_streams", "v:0"),
            *("-show_entries", "stream=width,height,nb_frames,duration", "-of", "json"),
            path,
        ]
    )
    stream = json.loads(out.stdout)["streams"][0]
    frames = stream.get("nb_frames")
    duration = int(frames) / fps if frames and frames != "N/A" else float(stream["duration"])
    return Proxy(
        path=path,
        fps=fps,
        measured_fps=measured,
        width=int(stream["width"]),
        height=int(stream["height"]),
        duration_s=duration,
        start_s=start_s,
    )


def _signature(src: Path, start: float, duration: float | None, width: int | None) -> dict:
    stat = src.stat()
    return {
        "source": src.name,
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "start": start,
        "duration": duration,
        "width": width,
    }


def build_proxy(
    src: Path,
    out_dir: Path,
    *,
    start: float = 0.0,
    duration: float | None = None,
    width: int | None = None,
    force: bool = False,
) -> Proxy:
    """Make `out_dir/proxy.mp4` from `src`, or reuse it when it was made from the same inputs.

    `start` and `duration` cut an excerpt; `start` must fall on a frame of the proxy grid so
    excerpt times map to source times exactly. `width` (even) scales to that width and is only
    for contact sheets: leave it unset for flash analysis.
    """
    src = Path(src)
    if not src.is_file():
        raise tools.ToolError(f"no such file: {src}")
    if width is not None and width % 2:
        raise ValueError("width must be even")
    if start < 0 or (duration is not None and duration <= 0):
        raise ValueError("start must be >= 0 and duration > 0")
    fps, measured = probe_source(src)
    if abs(start * fps - round(start * fps)) > 1e-6:
        raise ValueError(f"start {start} is not on the {fps} fps frame grid")

    out_dir.mkdir(parents=True, exist_ok=True)
    proxy_path = out_dir / "proxy.mp4"
    meta_path = out_dir / _META
    signature = _signature(src, start, duration, width)
    if not force and proxy_path.is_file() and meta_path.is_file():
        if json.loads(meta_path.read_text()) == signature:
            return _describe(proxy_path, fps, measured, start)

    if width is None:
        video_filter = "crop=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"
    else:
        video_filter = f"scale={width}:-2:flags=lanczos,format=yuv420p"
    meta_path.unlink(missing_ok=True)
    cmd: list[str | Path] = [tools.ffmpeg(), *("-v", "error", "-y", "-nostdin")]
    if start:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", src, *("-map", "0:v:0", "-map", "0:a:0?", "-vf", video_filter)]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-fps_mode", "cfr", "-r", str(fps)]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-g", str(2 * fps)]
    cmd += ["-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", proxy_path]
    tools.run(cmd)
    meta_path.write_text(json.dumps(signature))
    return _describe(proxy_path, fps, measured, start)
