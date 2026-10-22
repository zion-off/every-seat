"""Validation of relay message streams against the JSON Schemas in `schemas/`."""

import json
from functools import cache
from importlib import resources
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from referencing import Registry, Resource
from sensevtt.format import Issue, load_json

_SCHEMAS = ("lens", "relay-message")


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
