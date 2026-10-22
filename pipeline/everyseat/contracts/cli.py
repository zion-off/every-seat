"""`everyseat-validate`: check SenseVTT cue files and relay message streams."""

import argparse
import sys

from everyseat.contracts.sensevtt import Issue, parse
from everyseat.contracts.validate import relay_lines, validate_parsed, validate_relay

_STDIN = "-"


def _read(path: str) -> str:
    if path == _STDIN:
        return sys.stdin.read()
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _report(name: str, count: int, unit: str, issues: list[Issue]) -> bool:
    if not issues:
        print(f"OK {name} ({count} {unit})")
        return True
    for issue in issues:
        print(f"{name}:{issue.line}: {issue.message}")
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="everyseat-validate",
        description="Validate SenseVTT cue files, or relay message streams with --relay.",
    )
    parser.add_argument(
        "--relay",
        action="store_true",
        help="treat each FILE as newline-delimited relay messages",
    )
    parser.add_argument("files", nargs="+", metavar="FILE", help="a file to check; '-' is stdin")
    args = parser.parse_args(argv)

    all_valid, io_error = True, False
    for path in args.files:
        name = "<stdin>" if path == _STDIN else path
        try:
            text = _read(path)
        except (OSError, UnicodeDecodeError) as exc:
            print(f"error: cannot read {name}: {exc}", file=sys.stderr)
            io_error = True
            continue
        if args.relay:
            valid = _report(name, len(relay_lines(text)), "messages", validate_relay(text))
        else:
            doc = parse(text)
            valid = _report(name, len(doc.cues), "cues", validate_parsed(doc))
        all_valid = all_valid and valid
    if io_error:
        return 2
    return 0 if all_valid else 1
