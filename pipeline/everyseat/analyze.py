"""`everyseat analyze`: detect, let the agent decide, then write the cue file, recipe and log."""

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from sensevtt import writer
from sensevtt.validate import validate_sensevtt

from everyseat import __version__
from everyseat.agent import model
from everyseat.agent.run import AgentRun, run_agent
from everyseat.agent.session import Session
from everyseat.compose.recipe import comfort_recipe
from everyseat.detectors.candidates import Detection, detect
from everyseat.detectors.cuts import SCENE_THRESHOLD

TITLE = re.compile(r"^[a-z0-9-]+$")


class AnalysisError(RuntimeError):
    pass


@dataclass(frozen=True)
class Analysis:
    sensevtt: Path
    recipe: Path
    log: Path
    cue_count: int
    run: AgentRun


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def excerpt_name(video: Path, start: float, duration: float | None) -> str:
    if not start and duration is None:
        return video.stem
    end = "end" if duration is None else f"{start + duration:g}"
    return f"{video.stem}_{start:g}-{end}"


def _log(session: Session, run: AgentRun, detection: Detection, ok: bool) -> dict:
    price_in, price_out = model.PRICES_PER_MILLION[run.model_id]
    return {
        "version": 1,
        "ok": ok,
        "model": run.model_id,
        "usage": {
            "input_tokens": run.input_tokens,
            "output_tokens": run.output_tokens,
            "cost_usd": run.cost_usd,
            "usd_per_million_tokens": {"input": price_in, "output": price_out},
        },
        "model_calls": run.model_calls,
        "tool_calls": session.tool_calls,
        "repair_rounds": run.repair_rounds,
        "elapsed_s": run.elapsed_s,
        "source": detection.to_json()["source"],
        "candidates": len(detection.candidates),
        "inspections": session.inspections,
        "skipped": session.skipped,
        "cues": [
            {"candidate": c.ref, **c.payload()}
            for c in writer.finalize(session.title, session.cues())
        ],
        "open_problems": run.leftover,
        "final_message": run.final_message,
    }


def analyze(
    video: Path,
    out_dir: Path,
    *,
    name: str,
    title: str,
    model_choice: str,
    work_dir: Path,
    start: float = 0.0,
    duration: float | None = None,
    with_iris: bool = True,
    scene_threshold: float = SCENE_THRESHOLD,
    max_inspections: int = 12,
    progress: Callable[[str], None] | None = None,
) -> Analysis:
    if not TITLE.match(title):
        raise AnalysisError(f"title {title!r} must use lowercase letters, digits and hyphens")
    model_id = model.model_id(model_choice)
    say = progress or (lambda _line: None)

    say("running detectors")
    detection = detect(
        video,
        work_dir,
        start=start,
        duration=duration,
        with_iris=with_iris,
        scene_threshold=scene_threshold,
    )
    iris = detection.iris
    head = writer.header(
        title=title,
        analyzer=f"everyseat {__version__} ({model_id})",
        source_sha256=file_sha256(video),
        fps=detection.proxy.fps,
        verdict=iris.verdict if iris else "NOT_RUN",
        max_luminance_swing=iris.max_luminance_swing if iris else None,
    )
    say(f"{len(detection.candidates)} candidates; asking {model_id}")
    session = Session(detection, title, head, max_inspections)
    run = run_agent(session, model_choice, progress=progress)

    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / f"{name}.run.json"
    ok = not run.leftover
    log_path.write_text(json.dumps(_log(session, run, detection, ok), indent=1) + "\n")
    if not ok:
        raise AnalysisError(
            "the agent left problems open (details in the run log):\n"
            + "\n".join(f"- {line}" for line in run.leftover)
        )

    cues = writer.finalize(title, session.cues())
    text = writer.render(head, cues)
    issues = validate_sensevtt(text)
    if issues:
        raise AnalysisError("; ".join(f"line {i.line}: {i.message}" for i in issues))
    sensevtt_path = out_dir / f"{name}.sensevtt"
    recipe_path = out_dir / f"{name}.recipe.json"
    sensevtt_path.write_text(text)
    recipe_path.write_text(json.dumps(comfort_recipe(cues), indent=1) + "\n")
    return Analysis(sensevtt_path, recipe_path, log_path, len(cues), run)
