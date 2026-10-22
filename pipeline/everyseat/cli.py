"""`everyseat`: command-line entry point for the analysis pipeline."""

import argparse
import json
import re
import sys
from pathlib import Path

from everyseat.agent.model import NOVA_MODELS, ConfigError
from everyseat.analyze import AnalysisError, analyze, excerpt_name
from everyseat.describe import DescribeError
from everyseat.detectors import tools
from everyseat.detectors.candidates import detect
from everyseat.detectors.cuts import SCENE_THRESHOLD
from everyseat.detectors.sheet import clock
from everyseat.evaluate import EvalError, evaluate, load_label_set, render


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


def _describe(args: argparse.Namespace) -> int:
    from everyseat.describe.run import describe, read_plot
    from everyseat.describe.voices import StubVoice
    from everyseat.describe.writers import StubWriter, load_script

    title = args.title or re.sub(r"[^a-z0-9]+", "-", args.video.stem.lower()).strip("-")
    clips_dir = args.clips_dir / title
    if args.script and not args.dry_run:
        raise ValueError("--script needs --dry-run: it replaces the model's answers")
    plot = read_plot(args.plot) if args.plot else ""
    if args.dry_run:
        writer = StubWriter(load_script(args.script) if args.script else None)
        voice = StubVoice()
        default_cues = clips_dir / f"{title}.dry-run.sensevtt"
    else:
        # Imported here so a dry run never builds an AWS session.
        from everyseat.describe.nova import NovaWriter
        from everyseat.describe.polly import PollyVoice

        writer, voice = NovaWriter(args.model), PollyVoice(args.voice)
        default_cues = Path("generated") / f"{title}.sensevtt"
    cast = []
    for entry in args.cast:
        name, sep, who = entry.partition("=")
        if not sep or not name.strip() or not who.strip():
            raise ValueError(f"--cast takes NAME=WHO, got {entry!r}")
        cast.append(f"{name.strip()}: {who.strip()}")
    cues_path = args.cues or default_cues
    result = describe(
        args.video,
        args.subtitles,
        title=title,
        writer=writer,
        voice=voice,
        clips_dir=clips_dir,
        cues_path=cues_path,
        work_dir=args.work_dir or Path("build/work") / f"{args.video.stem}_ad",
        dry_run=args.dry_run,
        cast=cast,
        plot=plot,
        min_gap_s=args.min_gap,
        max_window_s=args.max_window,
        progress=lambda line: print(line, file=sys.stderr),
    )
    print(
        f"{result.cue_count} descriptions -> {result.sensevtt}\n"
        f"{len(result.clips)} clips in {clips_dir}; log {result.log}",
        file=sys.stderr,
    )
    if result.skipped:
        print(f"{len(result.skipped)} windows left without a description", file=sys.stderr)
    return 0


def _eval(args: argparse.Namespace) -> int:
    labels = load_label_set(args.labels)
    results = evaluate(labels, args.runs)
    document = render(labels, results)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(document)
        print(f"results for {len(results.scored)} runs -> {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(document)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="everyseat", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    cand = commands.add_parser("candidates", help="run the detectors and write candidates JSON")
    _add_detector_options(cand)
    cand.add_argument("--out", type=Path, help="write the JSON here instead of stdout")
    cand.set_defaults(run=_candidates)

    ana = commands.add_parser("analyze", help="assess candidates with Nova and write the cue file")
    _add_detector_options(ana)
    ana.add_argument("--model", choices=sorted(NOVA_MODELS), default="nova-pro")
    ana.add_argument("--title", help="title slug for the cue file (default: from the file name)")
    ana.add_argument("--name", help="output file stem (default: the file name and excerpt range)")
    ana.add_argument("--out-dir", type=Path, default=Path("generated"))
    ana.add_argument("--max-inspections", type=int, default=12, help="frame inspections allowed")
    ana.set_defaults(run=_analyze)

    des = commands.add_parser(
        "describe", help="write and voice audio descriptions for the dialogue-free stretches"
    )
    des.add_argument("video", type=Path, help="the film")
    des.add_argument("--subtitles", type=Path, required=True, help="SRT file with the dialogue")
    des.add_argument("--title", help="title slug for the cue file (default: from the file name)")
    des.add_argument("--dry-run", action="store_true", help="placeholder text and silent clips")
    des.add_argument(
        "--script",
        type=Path,
        help="with --dry-run, a JSON file of answers per window that stand in for the model's, "
        "to exercise the review",
    )
    des.add_argument("--model", choices=sorted(NOVA_MODELS), default="nova-pro")
    des.add_argument("--voice", default="Joanna", help="Polly neural voice")
    des.add_argument(
        "--cast",
        action="append",
        default=[],
        metavar="NAME=WHO",
        help="a character and who they are, for consistent names (repeatable)",
    )
    des.add_argument(
        "--plot",
        type=Path,
        metavar="FILE",
        help="a short plain-text synopsis of the film, given to the writer as background so it "
        "recognises characters and places (up to 2000 characters)",
    )
    des.add_argument("--min-gap", type=float, default=10.0, help="shortest quiet stretch, seconds")
    des.add_argument(
        "--max-window", type=float, default=30.0, help="longest single description window, seconds"
    )
    des.add_argument(
        "--clips-dir", type=Path, default=Path("build/ad"), help="clips go to <dir>/<title>/"
    )
    des.add_argument(
        "--cues",
        type=Path,
        help="cue file to write (default: generated/<title>.sensevtt; with --dry-run, next to "
        "the clips as <title>.dry-run.sensevtt)",
    )
    des.add_argument("--work-dir", type=Path, help="where the proxy and contact sheets go")
    des.set_defaults(run=_describe)

    ev = commands.add_parser("eval", help="score runs against labelled events and compare models")
    ev.add_argument(
        "--labels", type=Path, default=Path("pipeline/eval/labels"), help="file or folder"
    )
    ev.add_argument("--runs", type=Path, default=Path("pipeline/eval/runs"), help="<model>/<run>/*")
    ev.add_argument("--out", type=Path, help="write the Markdown table here instead of stdout")
    ev.set_defaults(run=_eval)

    args = parser.parse_args(argv)
    try:
        return args.run(args)
    except (
        tools.ToolError,
        ValueError,
        AnalysisError,
        ConfigError,
        DescribeError,
        EvalError,
    ) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
