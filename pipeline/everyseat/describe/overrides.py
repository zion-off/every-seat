"""Human corrections applied to a finished description: replace the text of an item or drop it.

Works on the cue file and the clips, not on the film, so a correction needs no new model run:
only the changed items are checked, voiced and fitted again.
"""

import json
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError, model_validator
from sensevtt import format as cue_format
from sensevtt import writer as cue_writer
from sensevtt.validate import validate_sensevtt
from sensevtt.writer import Cue

from everyseat.describe import DescribeError, anchor
from everyseat.describe.review import Earlier, Review, excerpt
from everyseat.describe.run import _cue, _words, fit
from everyseat.describe.subtitles import Window
from everyseat.describe.voices import Voice, write_wav
from everyseat.describe.writers import Request, Writer

MATCH_WITHIN_S = 1.5  # an override applies to the nearest item this close to `near_s`
CHECK_WORDS = 60  # the review's length limit for a human text; fitting does the real shortening


class Override(BaseModel):
    model_config = ConfigDict(extra="forbid")

    near_s: float
    text: str | None = None
    drop: bool = False

    @model_validator(mode="after")
    def _one_action(self) -> "Override":
        if self.drop == (self.text is not None):
            raise ValueError('give either "text" or "drop": true')
        return self


def load_overrides(path: Path) -> list[Override]:
    """Read `[{"near_s": 12.5, "text": "..."}, {"near_s": 40, "drop": true}]`."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise DescribeError(f"cannot read the overrides {path}: {exc}") from exc
    if not isinstance(data, list):
        raise DescribeError(f"{path}: expected a list of overrides")
    try:
        return [Override.model_validate(entry) for entry in data]
    except ValidationError as exc:
        raise DescribeError(f"{path}: {exc}") from exc


def _read(cues_path: Path) -> tuple[dict, list[Cue]]:
    try:
        doc = cue_format.parse(cues_path.read_text())
    except OSError as exc:
        raise DescribeError(f"cannot read the cue file {cues_path}: {exc}") from exc
    if doc.issues or doc.header is None or not doc.header.ok:
        raise DescribeError(f"{cues_path} is not a valid cue file; validate it first")
    cues = []
    for block in doc.cues:
        p = block.payload
        cues.append(
            Cue(
                type=p["type"],
                start=p["start"],
                end=p["end"],
                anchor=p["anchor"],
                intensity=p["intensity"],
                preview=p["preview"],
                lead_s=p.get("lead_s"),
                pre_s=p.get("pre_s"),
                post_s=p.get("post_s"),
                evidence=p.get("evidence", {}),
                audio_ref=p.get("audio_ref"),
                id=p["id"],
            )
        )
    return doc.header.data, cues


def _slot(cues: list[Cue], index: int, fps: int) -> tuple[float, Window]:
    """The seconds the clip of `cues[index]` may last, and its window, from the cue file alone."""
    cue = cues[index]
    number = int(cue.evidence.get("window", 0))
    window = Window(number, cue.start, float(cue.evidence.get("window_end", cue.end)))
    following = [c for c in cues[index + 1 :] if c.evidence.get("window") == number]
    return anchor.slot_limit_s(
        cue.start, following[0].start if following else None, window, fps
    ), window


def apply_overrides(
    overrides: list[Override],
    cues_path: Path,
    *,
    clips_dir: Path,
    writer: Writer,
    voice: Voice,
    progress: Callable[[str], None] | None = None,
) -> list[dict]:
    """Apply `overrides` to the cue file, rewrite it and the changed clips, and return one record
    per override (also written to the run log). An override that matches nothing, or whose text
    fails the review or cannot be fitted, changes nothing and says why.
    """
    say = progress or (lambda _line: None)
    header, cues = _read(cues_path)
    fps = int(header["fps"])
    title = header["title"]
    records: list[dict] = []
    for override in overrides:
        near = [
            (abs(c.start - override.near_s), n)
            for n, c in enumerate(cues)
            if c.type == "ad" and abs(c.start - override.near_s) <= MATCH_WITHIN_S
        ]
        record: dict = {"near_s": override.near_s}
        records.append(record)
        if not near:
            record.update(status="no match", reason=f"no item within {MATCH_WITHIN_S} s")
            say(f"override near {override.near_s:g} s: no item within {MATCH_WITHIN_S} s")
            continue
        index = min(near)[1]
        old = cues[index]
        old_text = old.evidence.get("text", old.preview)
        record.update(cue=old.id, start=old.start, old_text=old_text)
        if override.drop:
            (clips_dir / f"{old.id}.wav").unlink(missing_ok=True)
            del cues[index]
            record.update(status="dropped")
            say(
                f"override near {override.near_s:g} s: dropped {old.id} at {old.start:g} s: "
                f'"{excerpt(old_text)}"'
            )
            continue
        text = override.text or ""
        limit, window = _slot(cues, index, fps)
        earlier = [Earlier(c.start, c.evidence.get("text", "")) for c in cues if c is not old]
        review = Review(earlier, say)
        request = Request(
            window=window,
            picture=b"",
            before=[],
            after=[],
            earlier=review.earlier,
            check=review.check,
            note=say,
        )
        verdict = review.check(text, CHECK_WORDS, "override")
        if not verdict.ok:
            record.update(status="rejected", reason=verdict.summary, new_text=verdict.text)
            say(
                f"override near {override.near_s:g} s: rejected, {old.id} unchanged "
                f"({verdict.summary})"
            )
            continue
        placed = anchor.Placed(old.start, verdict.text, (old.start,))
        result = fit(request, placed, limit, writer, voice, progress=say)
        if isinstance(result, str):
            record.update(status="rejected", reason=result, new_text=verdict.text)
            say(f"override near {override.near_s:g} s: {old.id} unchanged ({result})")
            continue
        new = replace(
            _cue(title, 0, result, fps, voice),
            id=old.id,
            audio_ref={**old.audio_ref, "duration_s": round(result.speech.duration_s, 6)},
        )
        new.evidence["override"] = True
        write_wav(clips_dir / f"{old.id}.wav", result.speech)
        cues[index] = new
        record.update(
            status="replaced",
            new_text=result.text,
            duration_s=round(result.speech.duration_s, 3),
            slot_s=limit,
            words=_words(result.text),
        )
        say(
            f"override near {override.near_s:g} s: replaced {old.id} at {old.start:g} s, "
            f"{_words(result.text)} words, {result.speech.duration_s:.2f} s of {limit:.1f} s"
        )
    text = cue_writer.render(header, cues)
    issues = validate_sensevtt(text)
    if issues:
        raise DescribeError("; ".join(f"line {i.line}: {i.message}" for i in issues))
    cues_path.write_text(text)
    _log(cues_path.with_suffix(".run.json"), records)
    return records


def _log(path: Path, records: list[dict]) -> None:
    """Add the overrides to the run log beside the cue file; a missing log is started."""
    try:
        log = json.loads(path.read_text())
    except (OSError, ValueError):
        log = {"version": 1}
    log.setdefault("overrides", []).extend(records)
    for record in records:
        for entry in log.get("windows", []):
            if entry.get("cue") != record.get("cue"):
                continue
            if record["status"] == "dropped":
                entry["dropped_by_override"] = True
            elif record["status"] == "replaced":
                entry.update(
                    text=record["new_text"], duration_s=record["duration_s"], overridden=True
                )
    path.write_text(json.dumps(log, indent=1) + "\n")
