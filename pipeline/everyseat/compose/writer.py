"""SenseVTT writer: a WebVTT file whose cue payloads are one line of JSON each."""

import json
from dataclasses import dataclass, replace

from everyseat.compose.cues import Cue, ordered
from everyseat.compose.merge import merge_close

HEADER_MARK = "NOTE everyseat-header"


@dataclass(frozen=True)
class Rendered:
    text: str
    cue_lines: list[int]  # 1-based line of each cue's first line, in cue order


def timestamp(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, rest = divmod(millis, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    return f"{hours:02d}:{minutes:02d}:{rest // 1000:02d}.{rest % 1000:03d}"


def header(
    *,
    title: str,
    analyzer: str,
    source_sha256: str,
    fps: int,
    verdict: str,
    max_luminance_swing: float | None = None,
) -> dict:
    iris: dict = {"verdict": verdict}
    if max_luminance_swing is not None:
        iris["max_luminance_swing"] = max_luminance_swing
    return {
        "version": 1,
        "title": title,
        "analyzer": analyzer,
        "source_sha256": source_sha256,
        "fps": fps,
        "iris": iris,
    }


def finalize(title: str, cues: list[Cue]) -> list[Cue]:
    """Merge cues that are too close, sort by start and number them: `<title>-<type>-<n>`."""
    counts: dict[str, int] = {}
    out = []
    for cue in ordered(merge_close(cues)):
        counts[cue.type] = counts.get(cue.type, 0) + 1
        out.append(replace(cue, id=f"{title}-{cue.type}-{counts[cue.type]}"))
    return out


def _line(data: dict) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def render(head: dict, cues: list[Cue]) -> Rendered:
    """The file text for already finalized `cues`."""
    lines = ["WEBVTT", "", HEADER_MARK, _line(head), ""]
    first_lines = []
    for cue in cues:
        first_lines.append(len(lines) + 1)
        timing = f"{timestamp(cue.start)} --> {timestamp(cue.end)}"
        lines += [cue.id, timing, _line(cue.payload()), ""]
    return Rendered("\n".join(lines), first_lines)
