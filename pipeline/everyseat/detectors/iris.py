"""Flash analysis with EA IRIS, run in a local linux/amd64 container (or a Fargate task).

IRIS always exits 0, so the verdict comes from `result.json`. It rotates and appends
`framedata*.csv`, so the output directory is cleared before every run and all the CSV parts are
merged afterwards.
"""

import csv
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from everyseat.detectors import tools
from everyseat.detectors.proxy import Proxy

IMAGE_ENV = "EVERYSEAT_IRIS_IMAGE"
BACKEND_ENV = "EVERYSEAT_IRIS_BACKEND"
DEFAULT_IMAGE = "iris-cpp:1.1.0"
MERGE_GAP_S = 0.5

_VERDICTS = {"Pass": "PASS", "PassWithWarning": "PASS_WITH_WARNING", "Fail": "FAIL"}
_LEVELS = {1: "warning", 2: "extended_fail", 3: "flash_fail"}
_CHANNELS = (
    ("luminance", "LuminanceFrameResult", "LuminanceTransitions", "AverageLuminanceDiff"),
    ("red", "RedFrameResult", "RedTransitions", "AverageRedDiff"),
)


@dataclass(frozen=True)
class FlashRun:
    """A stretch of flagged frames, in seconds on the proxy's own timeline."""

    channel: str
    start: float
    end: float
    worst: str
    max_transitions: int
    peak_swing: float
    flagged_frames: int


@dataclass(frozen=True)
class IrisResult:
    verdict: str
    runs: list[FlashRun]
    frames: int
    flagged: dict[str, int]
    elapsed_s: float

    @property
    def max_luminance_swing(self) -> float:
        """Largest frame-to-frame luminance swing inside a flagged run (0 when none)."""
        return max((r.peak_swing for r in self.runs if r.channel == "luminance"), default=0.0)


def image_name() -> str:
    return os.environ.get(IMAGE_ENV, DEFAULT_IMAGE)


def _docker(*args: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["docker", *args], capture_output=True, text=True, check=False)
    except FileNotFoundError as exc:
        raise tools.ToolError("docker not found: the flash analyzer runs in a container") from exc


def _check_image(image: str) -> None:
    result = _docker("image", "inspect", image)
    if result.returncode != 0:
        detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else ""
        raise tools.ToolError(
            f"container image {image} is not available ({detail}). Build it with: "
            f"docker build --platform linux/amd64 -t {image} pipeline/iris"
        )


def _clear(out_dir: Path, keep: Path) -> None:
    out_dir = out_dir.resolve()
    if out_dir in (Path("/"), Path.home(), Path.cwd().resolve()) or keep.resolve().is_relative_to(
        out_dir
    ):
        raise ValueError(f"refusing to clear {out_dir}")
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    out_dir.chmod(0o777)  # the container runs as an unprivileged user


def _read_frames(directory: Path) -> list[dict[str, str]]:
    # IRIS rotates the CSV: only the first part has the header, and rows carry stray NUL bytes.
    tables = [
        list(csv.reader(part.read_text().replace("\x00", "").splitlines()))
        for part in directory.glob("framedata*.csv")
    ]
    header = next((r for t in tables for r in t if r and r[0].strip() == "Frame"), None)
    if header is None:
        raise tools.ToolError("the flash analyzer wrote no frame data")
    names = [name.strip() for name in header]
    rows = [
        dict(zip(names, (value.strip() for value in row), strict=False))
        for table in tables
        for row in table
        if row and row[0].strip().isdigit()
    ]
    rows.sort(key=lambda r: int(r["Frame"]))
    return rows


def _runs(rows: list[dict[str, str]], fps: int) -> list[FlashRun]:
    runs: list[FlashRun] = []
    frame_s = 1 / fps
    merge_gap = MERGE_GAP_S * fps
    numbers = [int(r["Frame"]) for r in rows]
    for channel, result_col, transitions_col, swing_col in _CHANNELS:
        flagged = [i for i, r in enumerate(rows) if int(r[result_col]) > 0]
        groups: list[list[int]] = []
        for i in flagged:
            if groups and numbers[i] - numbers[groups[-1][-1]] <= merge_gap:
                groups[-1].append(i)
            else:
                groups.append([i])
        floor = 0
        for group in groups:
            first = group[0]
            # The transition counter covers the trailing second: the run began where it left 0.
            while first > max(floor, group[0] - fps) and int(rows[first - 1][transitions_col]) > 0:
                first -= 1
            floor = group[-1] + 1
            span = rows[first : group[-1] + 1]
            worst = max(int(rows[i][result_col]) for i in group)
            runs.append(
                FlashRun(
                    channel=channel,
                    start=(numbers[first] - 1) * frame_s,
                    end=numbers[group[-1]] * frame_s,
                    worst=_LEVELS.get(worst, f"level_{worst}"),
                    max_transitions=max(int(r[transitions_col]) for r in span),
                    peak_swing=round(max(abs(float(r[swing_col])) for r in span), 4),
                    flagged_frames=len(group),
                )
            )
    return sorted(runs, key=lambda run: (run.start, run.channel))


def _elapsed(text: str) -> float:
    match = re.fullmatch(r"(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not match:
        return 0.0
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _run_docker(media: Path, out_dir: Path) -> None:
    image = image_name()
    _check_image(image)
    _clear(out_dir, keep=media)
    command = [
        *("run", "--rm", "--platform", "linux/amd64", "--network", "none"),
        *("-v", f"{media.parent}:/media:ro", "-v", f"{out_dir.resolve()}:/out"),
        image,
        f"/media/{media.name}",
    ]
    result = _docker(*command)
    (out_dir / "run.log").write_text(result.stdout + result.stderr)
    if result.returncode != 0 or not (out_dir / media.name / "result.json").is_file():
        tail = "\n".join((result.stdout + result.stderr).strip().splitlines()[-6:])
        raise tools.ToolError(f"the flash analyzer failed ({result.returncode}):\n{tail}")


def _run_fargate(media: Path, out_dir: Path) -> None:
    from everyseat.cloud import fargate

    _clear(out_dir, keep=media)
    fargate.run(media, out_dir)
    if not (out_dir / media.name / "result.json").is_file():
        raise tools.ToolError("the flash analyzer wrote no result")


def run_iris(proxy: Proxy, out_dir: Path) -> IrisResult:
    """Analyze the proxy and return the verdict plus the flagged runs.

    The proxy must be at the source resolution: a resized proxy changes the verdict. The analyzer
    runs in a local container, or as a Fargate task when EVERYSEAT_IRIS_BACKEND is `fargate`.
    """
    media = proxy.path.resolve()
    backend = os.environ.get(BACKEND_ENV, "docker")
    if backend == "fargate":
        _run_fargate(media, out_dir)
    elif backend == "docker":
        _run_docker(media, out_dir)
    else:
        raise tools.ToolError(f"unknown flash analyzer backend {backend!r}: use docker or fargate")
    produced = out_dir / media.name

    summary = json.loads((produced / "result.json").read_text())
    verdict = _VERDICTS.get(summary["OverallResult"])
    if verdict is None:
        raise tools.ToolError(f"unknown flash verdict {summary['OverallResult']!r}")
    rows = _read_frames(produced)
    luminance = summary["TotalLuminanceIncidents"]
    red = summary["TotalRedIncidents"]
    return IrisResult(
        verdict=verdict,
        runs=_runs(rows, proxy.fps),
        frames=int(summary["TotalFrame"]),
        flagged={
            "warning": luminance["PassWithWarningFrames"] + red["PassWithWarningFrames"],
            "extended_fail": luminance["ExtendedFailFrames"] + red["ExtendedFailFrames"],
            "flash_fail": luminance["FlashFailFrames"] + red["FlashFailFrames"],
        },
        elapsed_s=_elapsed(summary.get("AnalyzeTime", "")),
    )
