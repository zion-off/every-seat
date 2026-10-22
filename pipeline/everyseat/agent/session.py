"""The agent's working state: drafted cues, decisions on candidates, and the tools it calls."""

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from everyseat.agent import anchors
from everyseat.compose.cues import Cue
from everyseat.detectors import sheet, strip
from everyseat.detectors.candidates import Candidate, Detection

MAX_SPAN_S = 20.0
MIN_TILES, MAX_TILES = 4, 12
TILE_WIDTH = 320
NO_VALUE = -1.0  # tool arguments cannot be optional, so "not given" is a negative number
STRONG_FLASH = ("flash_fail", "extended_fail")
MIN_LOUD_JUMP_DB = 15.0
LOUD_FLOOR_DBFS = -20.0


class CueProposal(BaseModel):
    """What the agent may decide about a cue. Everything else comes from a detector."""

    model_config = ConfigDict(extra="forbid")

    cue_type: Literal["flash", "loud", "scare"]
    intensity: int = Field(ge=1, le=5)
    preview: str = Field(min_length=8, max_length=140)
    reasoning: str = Field(min_length=8, max_length=600)
    candidate_id: str = ""
    start_s: float | None = Field(default=None, ge=0)
    end_s: float | None = Field(default=None, ge=0)
    lead_s: float | None = Field(default=None, ge=2, le=30)


@dataclass
class Session:
    detection: Detection
    title: str
    head: dict
    max_inspections: int = 12
    drafts: dict[str, Cue] = field(default_factory=dict)
    skipped: dict[str, str] = field(default_factory=dict)
    inspections: list[dict] = field(default_factory=list)
    tool_calls: int = 0
    _new_cues: int = 0

    @property
    def candidates(self) -> dict[str, Candidate]:
        return {c.id: c for c in self.detection.candidates}

    def unresolved(self) -> list[Candidate]:
        decided = {cue.ref for cue in self.drafts.values()} | set(self.skipped)
        return [c for c in self.detection.candidates if c.id not in decided]

    def cues(self) -> list[Cue]:
        return list(self.drafts.values())

    def _window(self, start: float, end: float) -> tuple[float, float]:
        proxy = self.detection.proxy
        return max(start, proxy.start_s), min(end, proxy.end_s)

    def inspect(self, start_s: float, end_s: float, tiles: int) -> dict:
        proxy = self.detection.proxy
        start, end = self._window(start_s, end_s)
        if end - start < 0.5:
            return _error(
                f"the film excerpt covers {_s(proxy.start_s)} to {_s(proxy.end_s)} (film time); "
                "pick a window of at least 0.5 s inside it, with times in seconds"
            )
        if end - start > MAX_SPAN_S:
            return _error(f"a window can span at most {MAX_SPAN_S:.0f} s; narrow it")
        if len(self.inspections) >= self.max_inspections:
            return _error("the inspection budget is used up; decide with what you have")
        tiles = max(MIN_TILES, min(MAX_TILES, tiles))

        local = (proxy.proxy_time(start), proxy.proxy_time(end))
        frames = sheet.evenly(local[0], max(local[0], local[1] - 0.05), tiles)
        contact = sheet.contact_sheet(
            proxy.path,
            frames,
            tile_width=TILE_WIDTH,
            label_offset=proxy.start_s,
            label=sheet.plain_seconds,
        )
        onset_times = [
            proxy.proxy_time(c.start) for c in self.detection.candidates if c.type == "loud"
        ]
        strip_image = strip.loudness_strip(
            self.detection.loudness.track,
            local[0],
            local[1],
            label_offset=proxy.start_s,
            onsets=onset_times,
            cuts=self.detection.cuts,
            label=sheet.plain_seconds,
        )
        record = {"start_s": round(start, 3), "end_s": round(end, 3), "tiles": tiles}
        self.inspections.append(record)
        return {
            "status": "success",
            "content": [
                {"text": self._describe(start, end, tiles)},
                {"image": {"format": "jpeg", "source": {"bytes": sheet.jpeg_bytes(contact)}}},
                {"image": {"format": "jpeg", "source": {"bytes": sheet.jpeg_bytes(strip_image)}}},
            ],
        }

    def _describe(self, start: float, end: float, tiles: int) -> str:
        proxy = self.detection.proxy
        cuts = [
            _s(round(proxy.source_time(c), 3))
            for c in self.detection.cuts
            if start <= proxy.source_time(c) <= end
        ]
        near = [
            f"{c.id} ({c.type}, {_s(c.start)} to {_s(c.end)})"
            for c in self.detection.candidates
            if c.start <= end and c.end >= start
        ]
        used = len(self.inspections)
        return "\n".join(
            [
                f"Window {_s(round(start, 3))} to {_s(round(end, 3))} (film time).",
                f"Image 1: {tiles} frames, evenly spaced, each labelled with its film time.",
                "Image 2: loudness over the window; red lines are loud onsets, cyan ticks are "
                "shot cuts.",
                f"Shot cuts in the window: {', '.join(cuts) if cuts else 'none'}.",
                f"Candidates in the window: {', '.join(near) if near else 'none'}.",
                f"Inspections used: {used} of {self.max_inspections}.",
            ]
        )

    def propose(self, proposal: CueProposal) -> str:
        """Turn a proposal into a drafted cue whose times come from a detector."""
        if proposal.candidate_id:
            candidate = self.candidates.get(proposal.candidate_id)
            if candidate is None:
                known = ", ".join(self.candidates) or "none"
                return f"error: unknown candidate_id {proposal.candidate_id!r}; known: {known}"
            problem = _type_mismatch(candidate, proposal.cue_type)
            if problem:
                return f"error: {problem}"
            start, end = candidate.start, candidate.end
        else:
            if proposal.cue_type == "flash":
                return "error: a flash cue must name a flash candidate_id; its times come from it"
            if proposal.start_s is None:
                return "error: give a candidate_id, or start_s for a moment no candidate covers"
            snapped = anchors.snap(self.detection, proposal.start_s, proposal.end_s)
            start, end = snapped.start, snapped.end
            candidate = self.candidates.get(snapped.note)
        problem = self._ungrounded(proposal.cue_type, candidate, start, end)
        if problem:
            return f"error: {problem}"
        if candidate is not None:
            anchor, ref, evidence = candidate.anchor, candidate.id, {**candidate.evidence}
        else:
            anchor, evidence = snapped.anchor, {}
            self._new_cues += 1
            ref = f"n{self._new_cues}"
        evidence["reasoning"] = proposal.reasoning
        cue = Cue(
            type=proposal.cue_type,
            start=start,
            end=end,
            anchor=anchor,
            intensity=proposal.intensity,
            preview=proposal.preview,
            lead_s=proposal.lead_s,
            evidence=evidence,
            ref=ref,
        )
        self.skipped.pop(ref, None)
        self.drafts[f"{ref}:{cue.type}"] = cue
        return (
            f"recorded {cue.type} cue {ref} at {_s(start)} to {_s(end)} "
            f"(anchor {anchor}, intensity {cue.intensity})"
        )

    def _inspected(self, start: float, end: float) -> bool:
        return any(i["start_s"] <= end and i["end_s"] >= start for i in self.inspections)

    def _ungrounded(
        self, cue_type: str, candidate: Candidate | None, start: float, end: float
    ) -> str | None:
        """Rules that keep a cue tied to what the detectors measured or the agent saw."""
        if cue_type == "loud" and candidate is not None and not _is_loud(candidate):
            return (
                f"{candidate.id} is not a loud sound: jump_db {_num(candidate, 'jump_db')} and "
                f"peak_db {_num(candidate, 'peak_db')} do not reach jump_db of "
                f"{MIN_LOUD_JUMP_DB:g} with peak_db above {LOUD_FLOOR_DBFS:g}; skip it with "
                "skip_candidate"
            )
        if _needs_a_look(cue_type, candidate) and not self._inspected(start, end):
            return (
                f"a {cue_type} cue is judged from the picture, but no inspected window covers "
                f"{_s(start)} to {_s(end)}; call inspect on it first"
            )
        return None

    def skip(self, candidate_id: str, reason: str) -> str:
        candidate = self.candidates.get(candidate_id)
        if candidate is None:
            return f"error: unknown candidate_id {candidate_id!r}"
        if candidate.type == "flash" and candidate.evidence.get("worst") in STRONG_FLASH:
            return "error: a flash that fails the flash analyzer cannot be skipped; submit it"
        if (
            candidate.type == "loud"
            and _is_loud(candidate)
            and not self._inspected(candidate.start, candidate.end)
        ):
            return (
                f"error: {candidate_id} passes the loud rule "
                f"(jump_db {_num(candidate, 'jump_db')}, peak_db {_num(candidate, 'peak_db')}). "
                "Submit it, or inspect the moment first if you think it is only music or "
                "effects building"
            )
        for key in [k for k, cue in self.drafts.items() if cue.ref == candidate_id]:
            del self.drafts[key]
        self.skipped[candidate_id] = reason.strip()
        return f"skipped {candidate_id}"

    def drop(self, ref: str, cue_type: str) -> str:
        if self.drafts.pop(f"{ref}:{cue_type}", None) is None:
            return f"error: no {cue_type} cue for {ref!r}"
        return f"dropped the {cue_type} cue for {ref}"


def _is_loud(candidate: Candidate) -> bool:
    jump = candidate.evidence.get("jump_db", 0.0)
    peak = candidate.evidence.get("peak_db", -90.0)
    return jump >= MIN_LOUD_JUMP_DB and peak > LOUD_FLOOR_DBFS


def _needs_a_look(cue_type: str, candidate: Candidate | None) -> bool:
    if cue_type == "scare":
        return True
    return (
        cue_type == "flash"
        and candidate is not None
        and candidate.evidence.get("worst") not in STRONG_FLASH
    )


def _num(candidate: Candidate, key: str) -> str:
    return f"{candidate.evidence.get(key, 0.0):g}"


def _type_mismatch(candidate: Candidate, cue_type: str) -> str | None:
    if candidate.type == "flash" and cue_type != "flash":
        return f"{candidate.id} is a flash candidate: submit it as a flash cue"
    if candidate.type == "loud" and cue_type == "flash":
        return f"{candidate.id} is a loud onset: submit it as a loud or scare cue"
    return None


def _error(message: str) -> dict:
    return {"status": "error", "content": [{"text": message}]}


def _s(seconds: float) -> str:
    return f"{seconds:g} s"
