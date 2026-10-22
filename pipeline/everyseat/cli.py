"""`everyseat`: command-line entry point for the analysis pipeline."""

import argparse
import json
import sys
from pathlib import Path

from everyseat.detectors import tools
from everyseat.detectors.candidates import detect
from everyseat.detectors.cuts import SCENE_THRESHOLD
from everyseat.detectors.sheet import clock


def default_work_dir(video: Path, start: float, duration: float | None) -> Path:
    name = video.stem if not start and duration is None else f"{video.stem}_{start:g}_{duration:g}"
    return Path("build/work") / name


def _add_detector_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("video", type=Path, help="the film to analyze")
    parser.add_argument("--start", type=float, default=0.0, help="excerpt start, seconds")
    parser.add_argument("--duration", type=float, help="excerpt length, seconds (default: to end)")
    parser.add_argument("--work-dir", type=Path, help="where proxies and detector output go")
    parser.add_argument("--no-iris", action="store_true", help="skip the flash analysis")
    parser.add_argument("--scene", type=float, default=SCENE_THRESHOLD, help="shot-cut threshold")


def _candidates(args: argparse.Namespace) -> int:
    work_dir = args.work_dir or default_work_dir(args.video, args.start, args.duration)
    found = detect(
        args.video,
        work_dir,
        start=args.start,
        duration=args.duration,
        with_iris=not args.no_iris,
        scene_threshold=args.scene,
    )
    document = json.dumps(found.to_json(), indent=1) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(document)
    else:
        sys.stdout.write(document)
    print(
        f"{len(found.candidates)} candidates, flash verdict "
        f"{found.iris.verdict if found.iris else 'NOT_RUN'}",
        file=sys.stderr,
    )
    for c in found.candidates:
        print(
            f"  {c.id:>4} {c.type:5} {clock(c.start)} -> {clock(c.end)} "
            f"anchor={c.anchor} score={c.score}",
            file=sys.stderr,
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="everyseat", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    cand = commands.add_parser("candidates", help="run the detectors and write candidates JSON")
    _add_detector_options(cand)
    cand.add_argument("--out", type=Path, help="write the JSON here instead of stdout")
    cand.set_defaults(run=_candidates)

    args = parser.parse_args(argv)
    try:
        return args.run(args)
    except (tools.ToolError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
