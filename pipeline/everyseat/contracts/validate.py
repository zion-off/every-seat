"""Validation of SenseVTT files and relay messages: JSON Schema plus semantic checks."""

import json
from decimal import Decimal
from functools import cache
from importlib import resources
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from referencing import Registry, Resource

from everyseat.contracts.sensevtt import CueBlock, Document, Issue, load_json, parse

TIME_TOLERANCE_S = 0.0005
MAX_DECIMALS = 3
_EPSILON = 1e-9  # float noise, so values exactly on a tolerance boundary pass
_SCHEMAS = ("sensevtt-header", "sensevtt-cue", "lens", "relay-message")
_NON_AD_TYPES = ("flash", "loud", "scare")


@cache
def _schema(name: str) -> dict[str, Any]:
    path = resources.files("everyseat.contracts").joinpath("schemas", f"{name}.schema.json")
    return json.loads(path.read_text(encoding="utf-8"))


@cache
def _validator(name: str) -> Draft202012Validator:
    registry = Registry().with_resources(
        [(f"{schema}.schema.json", Resource.from_contents(_schema(schema))) for schema in _SCHEMAS]
    )
    return Draft202012Validator(_schema(name), registry=registry)


def _where(error: ValidationError) -> str:
    where = ""
    for part in error.absolute_path:
        where += f"[{part}]" if isinstance(part, int) else f".{part}"
    return where


def _schema_issues(name: str, instance: Any, line: int, label: str) -> list[Issue]:
    errors = sorted(
        _validator(name).iter_errors(instance), key=lambda e: [str(p) for p in e.absolute_path]
    )
    return [Issue(line, f"{label}{_where(error)}: {error.message}") for error in errors]


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _decimals(value: float) -> int:
    exponent = Decimal(repr(value)).as_tuple().exponent
    return -exponent if isinstance(exponent, int) and exponent < 0 else 0


def _check_grid(where: str, value: float, fps: int | None, line: int, issues: list[Issue]) -> None:
    if fps is None:
        return
    frames = value * fps
    if abs(frames - round(frames)) > TIME_TOLERANCE_S * fps + _EPSILON:
        issues.append(Issue(line, f"{where}: {value} is not on the {fps} fps frame grid"))


def _header_fps(header: Any) -> int | None:
    fps = header.get("fps") if isinstance(header, dict) else None
    if isinstance(fps, int) and not isinstance(fps, bool) and 1 <= fps <= 120:
        return fps
    return None


def _check_cue(cue: CueBlock, fps: int | None, ids: dict[str, int]) -> list[Issue]:
    issues: list[Issue] = []
    _check_grid("timing start", cue.start, fps, cue.timing_line, issues)
    _check_grid("timing end", cue.end, fps, cue.timing_line, issues)
    if not cue.payload_ok or cue.payload_line is None:
        return issues

    line = cue.payload_line
    payload = cue.payload
    issues += _schema_issues("sensevtt-cue", payload, line, "payload")
    if not isinstance(payload, dict):
        return issues

    times = {"start": payload.get("start"), "end": payload.get("end")}
    for key, timing in (("start", cue.start), ("end", cue.end)):
        value = times[key]
        if not _is_number(value):
            continue
        if abs(value - timing) > TIME_TOLERANCE_S + _EPSILON:
            message = f"{value} does not match the cue timing {key} ({timing:.3f})"
            issues.append(Issue(line, f"payload.{key}: {message}"))
        if _decimals(value) > MAX_DECIMALS:
            message = f"{value} has more than {MAX_DECIMALS} decimal places"
            issues.append(Issue(line, f"payload.{key}: {message}"))
        _check_grid(f"payload.{key}", value, fps, line, issues)
    start, end = times["start"], times["end"]
    if _is_number(start) and _is_number(end) and start >= end:
        issues.append(Issue(line, f"payload.start: {start} must be before end ({end})"))

    cue_id = payload.get("id")
    if isinstance(cue_id, str):
        if cue_id in ids:
            message = f"duplicate id '{cue_id}' (first on line {ids[cue_id]})"
            issues.append(Issue(line, f"payload.id: {message}"))
        else:
            ids[cue_id] = line
        if cue.identifier is not None and cue.identifier != cue_id:
            message = f"identifier '{cue.identifier}' does not match payload id '{cue_id}'"
            issues.append(Issue(cue.identifier_line or line, f"cue: {message}"))

    cue_type = payload.get("type")
    if cue_type == "ad" and "audio_ref" not in payload:
        issues.append(Issue(line, "payload.audio_ref: required on ad cues"))
    if cue_type in _NON_AD_TYPES and "audio_ref" in payload:
        issues.append(Issue(line, f"payload.audio_ref: only allowed on ad cues, not {cue_type}"))
    return issues


def _effective_start(cue: CueBlock) -> float:
    start = cue.payload.get("start") if cue.payload_ok and isinstance(cue.payload, dict) else None
    return start if _is_number(start) else cue.start


def validate_parsed(doc: Document) -> list[Issue]:
    issues = list(doc.issues)
    fps = None
    if doc.header is not None and doc.header.ok and doc.header.line is not None:
        issues += _schema_issues("sensevtt-header", doc.header.data, doc.header.line, "header")
        fps = _header_fps(doc.header.data)

    ids: dict[str, int] = {}
    previous: tuple[float, int] | None = None
    for cue in doc.cues:
        issues += _check_cue(cue, fps, ids)
        start = _effective_start(cue)
        line = cue.payload_line or cue.timing_line
        if previous is not None and start < previous[0]:
            message = (
                f"cue order: start {start} is before the previous cue's start {previous[0]} "
                f"(line {previous[1]}); cues must be sorted by start"
            )
            issues.append(Issue(line, message))
        previous = (start, line)
    return sorted(issues, key=lambda issue: issue.line)


def validate_sensevtt(text: str) -> list[Issue]:
    return validate_parsed(parse(text))


def relay_lines(text: str) -> list[tuple[int, str]]:
    """Non-blank lines of a newline-delimited relay stream, with 1-based line numbers."""
    return [(n, raw.rstrip("\r")) for n, raw in enumerate(text.split("\n"), 1) if raw.strip()]


def validate_relay(text: str) -> list[Issue]:
    issues: list[Issue] = []
    for number, raw in relay_lines(text):
        try:
            message = load_json(raw)
        except ValueError as exc:
            issues.append(Issue(number, f"malformed JSON: {exc}"))
            continue
        issues += _schema_issues("relay-message", message, number, "message")
    return issues
