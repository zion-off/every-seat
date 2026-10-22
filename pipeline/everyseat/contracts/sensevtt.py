"""Parser for the SenseVTT serialization: a WebVTT file with JSON cue payloads.

Layout:
    WEBVTT

    NOTE everyseat-header
    {one line of JSON}

    [identifier]
    HH:MM:SS.mmm --> HH:MM:SS.mmm
    {one line of JSON}

The parser only checks structure and records source line numbers. Whether the JSON matches the
schemas is `validate.py`'s job.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Any, NamedTuple

HEADER_NOTE = "NOTE everyseat-header"

_TIMING = re.compile(
    r"^(\d{2,}):(\d{2}):(\d{2})\.(\d{3})[ \t]+-->[ \t]+(\d{2,}):(\d{2}):(\d{2})\.(\d{3})$"
)


class Issue(NamedTuple):
    line: int
    message: str


@dataclass
class HeaderBlock:
    note_line: int
    line: int | None  # line of the JSON; None when the block has no JSON line
    data: Any = None
    ok: bool = False  # True when `data` holds successfully parsed JSON


@dataclass
class CueBlock:
    timing_line: int
    start: float  # seconds, from the timing line
    end: float
    identifier: str | None = None
    identifier_line: int | None = None
    payload_line: int | None = None
    payload: Any = None
    payload_ok: bool = False  # True when `payload` holds successfully parsed JSON


@dataclass
class Document:
    header: HeaderBlock | None = None
    cues: list[CueBlock] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)


def _reject_constant(name: str) -> None:
    raise ValueError(f"{name} is not valid JSON")


def load_json(raw: str) -> Any:
    return json.loads(raw, parse_constant=_reject_constant)


def _blocks(lines: list[str], first: int) -> list[list[tuple[int, str]]]:
    blocks: list[list[tuple[int, str]]] = []
    current: list[tuple[int, str]] = []
    for index in range(first, len(lines)):
        if lines[index].strip():
            current.append((index + 1, lines[index]))
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    return blocks


def _parse_timing(text: str) -> tuple[float, float] | str:
    match = _TIMING.match(text)
    if not match:
        return "bad timing line, expected 'HH:MM:SS.mmm --> HH:MM:SS.mmm'"
    values = [int(group) for group in match.groups()]
    millis = []
    for offset in (0, 4):
        hours, minutes, seconds, ms = values[offset : offset + 4]
        if minutes > 59 or seconds > 59:
            return "bad timing line, minutes and seconds must be below 60"
        millis.append(((hours * 60 + minutes) * 60 + seconds) * 1000 + ms)
    if millis[0] >= millis[1]:
        return "bad timing line, the end must be after the start"
    return millis[0] / 1000, millis[1] / 1000


def _parse_header(block: list[tuple[int, str]], doc: Document, seen_cue: bool) -> None:
    note_line = block[0][0]
    if doc.header is not None:
        doc.issues.append(
            Issue(note_line, f"duplicate header (first on line {doc.header.note_line})")
        )
        return
    if seen_cue:
        doc.issues.append(Issue(note_line, "header must appear before the first cue"))
    header = HeaderBlock(note_line=note_line, line=None)
    doc.header = header
    if len(block) == 1:
        doc.issues.append(Issue(note_line, "header block has no JSON line"))
        return
    header.line = block[1][0]
    if len(block) > 2:
        doc.issues.append(Issue(block[2][0], "header JSON must be exactly one line"))
    try:
        header.data = load_json(block[1][1])
        header.ok = True
    except ValueError as exc:
        doc.issues.append(Issue(header.line, f"malformed JSON in header: {exc}"))


def _parse_cue(block: list[tuple[int, str]], doc: Document) -> None:
    timing_index = next((i for i, (_, text) in enumerate(block[:2]) if "-->" in text), None)
    if timing_index is None:
        doc.issues.append(Issue(block[0][0], "cue block has no timing line"))
        return
    timing_line, timing_text = block[timing_index]
    identifier = block[0] if timing_index == 1 else None
    parsed = _parse_timing(timing_text.strip())
    if isinstance(parsed, str):
        doc.issues.append(Issue(timing_line, parsed))
        return
    cue = CueBlock(
        timing_line=timing_line,
        start=parsed[0],
        end=parsed[1],
        identifier=identifier[1].strip() if identifier else None,
        identifier_line=identifier[0] if identifier else None,
    )
    doc.cues.append(cue)
    payload = block[timing_index + 1 :]
    if not payload:
        doc.issues.append(Issue(timing_line, "cue has no JSON payload line"))
        return
    cue.payload_line = payload[0][0]
    if len(payload) > 1:
        doc.issues.append(Issue(payload[1][0], "cue payload must be exactly one line of JSON"))
    try:
        cue.payload = load_json(payload[0][1])
        cue.payload_ok = True
    except ValueError as exc:
        doc.issues.append(Issue(cue.payload_line, f"malformed JSON in cue payload: {exc}"))


def parse(text: str) -> Document:
    doc = Document()
    text = text.removeprefix("\ufeff")
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines[0] != "WEBVTT":
        doc.issues.append(Issue(1, "first line must be exactly 'WEBVTT'"))
    # A first line that doesn't start with WEBVTT is treated as content, not as the signature.
    first_block = 1 if lines[0].startswith("WEBVTT") else 0
    if first_block == 1 and len(lines) > 1 and lines[1].strip():
        doc.issues.append(Issue(2, "expected a blank line after 'WEBVTT'"))

    seen_cue = False
    for block in _blocks(lines, first_block):
        first_text = block[0][1]
        if first_text.rstrip() == HEADER_NOTE:
            _parse_header(block, doc, seen_cue)
        elif first_text == "NOTE" or first_text.startswith(("NOTE ", "NOTE\t")):
            continue
        else:
            seen_cue = True
            _parse_cue(block, doc)

    if doc.header is None:
        doc.issues.append(Issue(1, f"missing '{HEADER_NOTE}' block"))
    return doc
