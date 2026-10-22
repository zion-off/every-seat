"""`everyseat eval`: score cue files against labelled events and compare models.

Labels live in one JSON file per film excerpt. Runs live in `<runs>/<model>/<run>/<name>.*`, where
`<name>` is a label file's name and the files are what `everyseat analyze` wrote.
"""

import json
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from everyseat.contracts.sensevtt import parse

CueType = Literal["flash", "loud", "scare"]
DEFAULT_TOLERANCE_S = {"flash": 1.0, "loud": 0.5, "scare": 0.5}
TYPES: tuple[CueType, ...] = ("flash", "loud", "scare")


class EvalError(RuntimeError):
    pass


class Event(BaseModel):
    """One labelled moment: where the viewer first needs the comfort cue."""

    model_config = ConfigDict(extra="forbid")

    type: CueType
    start_s: float = Field(ge=0)
    end_s: float | None = Field(default=None, ge=0)
    intensity: int | None = Field(default=None, ge=1, le=5)
    source: str = Field(default="hand", min_length=1)
    note: str = ""


class Excerpt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_s: float = Field(ge=0)
    duration_s: float = Field(gt=0)


class Labels(BaseModel):
    """The labelled events of one excerpt. `complete` says that every event is listed."""

    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    name: str = Field(pattern=r"^[A-Za-z0-9_.-]+$")
    film: str
    excerpt: Excerpt
    complete: bool = False
    tolerance_s: dict[CueType, float] = Field(default_factory=dict)
    events: list[Event]

    def tolerance(self, cue_type: CueType) -> float:
        return self.tolerance_s.get(cue_type, DEFAULT_TOLERANCE_S[cue_type])


@dataclass(frozen=True)
class Cue:
    type: str
    start: float
    end: float
    intensity: int | None


@dataclass(frozen=True)
class Match:
    event: Event
    cue: Cue

    @property
    def start_error(self) -> float:
        return self.cue.start - self.event.start_s

    @property
    def intensity_error(self) -> int | None:
        if self.event.intensity is None or self.cue.intensity is None:
            return None
        return self.cue.intensity - self.event.intensity


@dataclass
class Scored:
    """One run of one model on one excerpt, scored."""

    labels: Labels
    model: str
    run: str
    ok: bool
    cues: list[Cue]
    matches: list[Match]
    cost_usd: float
    input_tokens: int
    output_tokens: int
    model_calls: int
    elapsed_s: float

    def found(self, event: Event) -> Match | None:
        return next((m for m in self.matches if m.event is event), None)

    @property
    def extra(self) -> int:
        return len(self.cues) - len(self.matches)


@dataclass
class Results:
    scored: list[Scored] = field(default_factory=list)

    def models(self) -> list[str]:
        return sorted({s.model for s in self.scored})


def load_labels(path: Path) -> Labels:
    try:
        labels = Labels.model_validate_json(path.read_text())
    except (ValidationError, ValueError) as exc:
        raise EvalError(f"{path.name}: {exc}") from exc
    if labels.name != path.stem:
        raise EvalError(f"{path.name}: name {labels.name!r} must equal the file name")
    return labels


def load_label_set(path: Path) -> list[Labels]:
    files = sorted(path.glob("*.json")) if path.is_dir() else [path]
    if not files:
        raise EvalError(f"no label files in {path.name}")
    return [load_labels(p) for p in files]


def read_cues(path: Path) -> list[Cue]:
    document = parse(path.read_text())
    if document.issues:
        raise EvalError(f"{path.name}: {document.issues[0].message}")
    cues = []
    for block in document.cues:
        data = block.payload
        if data["type"] in TYPES:
            cues.append(Cue(data["type"], data["start"], data["end"], data.get("intensity")))
    return cues


def match_events(labels: Labels, cues: list[Cue]) -> list[Match]:
    """Pair events with cues of the same type, nearest start first, each used at most once."""
    pairs = sorted(
        (abs(cue.start - event.start_s), i, j)
        for i, event in enumerate(labels.events)
        for j, cue in enumerate(cues)
        if event.type == cue.type and abs(cue.start - event.start_s) <= labels.tolerance(event.type)
    )
    used_events: set[int] = set()
    used_cues: set[int] = set()
    matches = []
    for _error, i, j in pairs:
        if i in used_events or j in used_cues:
            continue
        used_events.add(i)
        used_cues.add(j)
        matches.append(Match(labels.events[i], cues[j]))
    return matches


def score_run(labels: Labels, model: str, run: str, folder: Path) -> Scored:
    log_path = folder / f"{labels.name}.run.json"
    cue_path = folder / f"{labels.name}.sensevtt"
    if not log_path.exists():
        raise EvalError(f"{model}/{run}: no run log for {labels.name}")
    log = json.loads(log_path.read_text())
    source = log["source"]
    if (
        source["start_s"] != labels.excerpt.start_s
        or source["duration_s"] != labels.excerpt.duration_s
    ):
        raise EvalError(
            f"{model}/{run}/{labels.name}: the run covers {source['start_s']:g} s for "
            f"{source['duration_s']:g} s, the labels {labels.excerpt.start_s:g} s for "
            f"{labels.excerpt.duration_s:g} s"
        )
    ok = bool(log["ok"]) and cue_path.exists()
    cues = read_cues(cue_path) if ok else []
    usage = log["usage"]
    return Scored(
        labels=labels,
        model=model,
        run=run,
        ok=ok,
        cues=cues,
        matches=match_events(labels, cues),
        cost_usd=usage["cost_usd"],
        input_tokens=usage["input_tokens"],
        output_tokens=usage["output_tokens"],
        model_calls=log["model_calls"],
        elapsed_s=log["elapsed_s"],
    )


def evaluate(labels: list[Labels], runs: Path) -> Results:
    by_name = {item.name: item for item in labels}
    results = Results()
    for model_dir in sorted(p for p in runs.iterdir() if p.is_dir()):
        for run_dir in sorted(p for p in model_dir.iterdir() if p.is_dir()):
            for name, item in by_name.items():
                if (run_dir / f"{name}.run.json").exists():
                    results.scored.append(score_run(item, model_dir.name, run_dir.name, run_dir))
    if not results.scored:
        raise EvalError(f"no runs under {runs.name} match the label files")
    return results


def _ratio(found: int, total: int) -> str:
    return "n/a" if total == 0 else f"{found}/{total} ({100 * found / total:.0f}%)"


def _seconds(value: float) -> str:
    return f"{value:+.3f}"


def _errors(items: list[Scored]) -> list[float]:
    return [m.start_error for s in items for m in s.matches]


def _error_summary(errors: list[float]) -> str:
    if not errors:
        return "n/a"
    ordered = [abs(e) for e in errors]
    return (
        f"mean {_seconds(statistics.fmean(errors))}, "
        f"median abs {statistics.median(ordered):.3f}, max abs {max(ordered):.3f}"
    )


def _intensity_summary(items: list[Scored]) -> str:
    errors = [m.intensity_error for s in items for m in s.matches if m.intensity_error is not None]
    if not errors:
        return "n/a"
    return f"mean abs {statistics.fmean(abs(e) for e in errors):.1f} (n={len(errors)})"


def _precision(items: list[Scored]) -> str:
    complete = [s for s in items if s.labels.complete and s.ok]
    if not complete:
        return "n/a (labels not complete)"
    return _ratio(sum(len(s.matches) for s in complete), sum(len(s.cues) for s in complete))


def _event_count(items: list[Scored]) -> int:
    return sum(len(s.labels.events) for s in items)


def render(labels: list[Labels], results: Results) -> str:
    events = sum(len(item.events) for item in labels)
    hand = sum(1 for item in labels for e in item.events if e.source == "hand")
    tolerances = ", ".join(f"{t} {DEFAULT_TOLERANCE_S[t]:g} s" for t in TYPES)
    lines = [
        "# Evaluation results",
        "",
        f"{events} labelled events in {len(labels)} excerpts ({hand} hand-labelled). A cue finds "
        f"an event when it has the same type and starts within the tolerance ({tolerances}); "
        "each cue and event is used once. Start error is the cue start minus the labelled start, "
        "in seconds. Precision needs every event of an excerpt to be labelled, so it is only "
        "computed for label files marked complete; other cues are counted as extra, not as wrong.",
    ]
    if hand == 0:
        lines += [
            "",
            "No event is hand-labelled yet: the events come from instrument readings and a "
            "reference cue file, so this table checks the harness and the timing, not how well "
            "the cues match what a viewer would want.",
        ]
    lines += [
        "",
        "## Models",
        "",
        "| Model | Excerpt runs | Events found | Start error (s) | Intensity error | Precision | "
        "Extra cues per run | Cost per run (USD) | Input / output tokens per run | "
        "Model calls per run |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for model in results.models():
        items = [s for s in results.scored if s.model == model]
        runs = len(items)
        found = sum(len(s.matches) for s in items)
        failed = sum(1 for s in items if not s.ok)
        lines.append(
            f"| {model} | {runs}{f' ({failed} failed)' if failed else ''} "
            f"| {_ratio(found, _event_count(items))} | {_error_summary(_errors(items))} "
            f"| {_intensity_summary(items)} "
            f"| {_precision(items)} | {sum(s.extra for s in items) / runs:.1f} "
            f"| {sum(s.cost_usd for s in items) / runs:.4f} "
            f"| {sum(s.input_tokens for s in items) // runs:,} / "
            f"{sum(s.output_tokens for s in items) // runs:,} "
            f"| {sum(s.model_calls for s in items) / runs:.1f} |"
        )

    lines += [
        "",
        "## Events",
        "",
        "| Excerpt | Event | Source | " + " | ".join(f"{m} found" for m in results.models()) + " |",
        "|---|---|---|" + "---|" * len(results.models()),
    ]
    for item in labels:
        for event in item.events:
            cells = []
            for model in results.models():
                runs = [s for s in results.scored if s.model == model and s.labels is item]
                hits = [m for s in runs if (m := s.found(event))]
                if not runs:
                    cells.append("not run")
                    continue
                errors = ", ".join(_seconds(m.start_error) for m in hits)
                cells.append(f"{len(hits)}/{len(runs)}" + (f" ({errors} s)" if hits else ""))
            span = f"{event.start_s:g}" + (f"–{event.end_s:g}" if event.end_s is not None else "")
            lines.append(
                f"| {item.name} | {event.type} {span} s | {event.source} | "
                + " | ".join(cells)
                + " |"
            )

    lines += [
        "",
        "## Runs",
        "",
        "| Excerpt | Model | Run | Cues (flash / loud / scare) | Events found | Extra cues | "
        "Cost (USD) | Time (s) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for s in sorted(results.scored, key=lambda s: (s.labels.name, s.model, s.run)):
        counts = " / ".join(str(sum(1 for c in s.cues if c.type == t)) for t in TYPES)
        lines.append(
            f"| {s.labels.name} | {s.model} | {s.run} | {counts if s.ok else 'failed'} "
            f"| {len(s.matches)}/{len(s.labels.events)} | {s.extra} | {s.cost_usd:.4f} "
            f"| {s.elapsed_s:g} |"
        )
    total = sum(s.cost_usd for s in results.scored)
    lines += ["", f"Total model spend for these runs: about ${total:.2f}.", ""]
    return "\n".join(lines)
