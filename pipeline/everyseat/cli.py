"""`everyseat`: command-line entry point for the analysis pipeline."""

import argparse
import json
import re
import sys
from pathlib import Path

from everyseat.agent.model import NOVA_MODELS, ConfigError
from everyseat.analyze import AnalysisError, analyze, excerpt_name
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


def _analyze(args: argparse.Namespace) -> int:
    work_dir = args.work_dir or default_work_dir(args.video, args.start, args.duration)
    name = args.name or excerpt_name(args.video, args.start, args.duration)
    title = args.title or re.sub(r"[^a-z0-9]+", "-", args.video.stem.lower()).strip("-")
    result = analyze(
        args.video,
        args.out_dir,
        name=name,
        title=title,
        model_choice=args.model,
        work_dir=work_dir,
        start=args.start,
        duration=args.duration,
        with_iris=not args.no_iris,
        scene_threshold=args.scene,
        max_inspections=args.max_inspections,
        progress=lambda line: print(line, file=sys.stderr),
    )
    run = result.run
    print(
        f"{result.cue_count} cues -> {result.sensevtt}\n"
        f"model {run.model_id}: {run.input_tokens} input + {run.output_tokens} output tokens, "
        f"about ${run.cost_usd:.4f}; {run.model_calls} model calls, "
        f"{run.repair_rounds} repair rounds, {run.elapsed_s} s",
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

    ana = commands.add_parser("analyze", help="detect, judge with Nova and write the cue file")
    _add_detector_options(ana)
    ana.add_argument("--model", choices=sorted(NOVA_MODELS), default="nova-pro")
    ana.add_argument("--title", help="title slug for the cue file (default: from the file name)")
    ana.add_argument("--name", help="output file stem (default: the file name and excerpt range)")
    ana.add_argument("--out-dir", type=Path, default=Path("generated"))
    ana.add_argument("--max-inspections", type=int, default=12, help="frame inspections allowed")
    ana.set_defaults(run=_analyze)

    args = parser.parse_args(argv)
    try:
        return args.run(args)
    except (tools.ToolError, ValueError, AnalysisError, ConfigError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
