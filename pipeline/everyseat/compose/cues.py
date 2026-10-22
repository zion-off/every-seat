"""The cue record shared by the agent and the writer."""

from dataclasses import dataclass, field

CUE_TYPES = ("flash", "loud", "scare")
TYPE_ORDER = {name: rank for rank, name in enumerate(CUE_TYPES)}
DEFAULT_LEAD_S = 5
FLASH_PRE_S = 1.5
FLASH_POST_S = 1.0


@dataclass
class Cue:
    type: str
    start: float
    end: float
    anchor: str
    intensity: int
    preview: str
    lead_s: float | None = None
    pre_s: float | None = None
    post_s: float | None = None
    evidence: dict = field(default_factory=dict)
    id: str = ""

    @property
    def lead(self) -> float:
        return DEFAULT_LEAD_S if self.lead_s is None else self.lead_s

    @property
    def pre(self) -> float:
        return FLASH_PRE_S if self.pre_s is None else self.pre_s

    @property
    def post(self) -> float:
        return FLASH_POST_S if self.post_s is None else self.post_s

    def payload(self) -> dict:
        """The cue's JSON payload; margins that the player would default are written out."""
        data: dict = {
            "id": self.id,
            "type": self.type,
            "start": self.start,
            "end": self.end,
            "anchor": self.anchor,
            "intensity": self.intensity,
        }
        if self.type == "flash":
            data["pre_s"] = self.pre
            data["post_s"] = self.post
        else:
            data["lead_s"] = self.lead
            if self.pre_s is not None:
                data["pre_s"] = self.pre_s
            if self.post_s is not None:
                data["post_s"] = self.post_s
        data["preview"] = self.preview
        if self.evidence:
            data["evidence"] = self.evidence
        return data


def ordered(cues: list[Cue]) -> list[Cue]:
    return sorted(cues, key=lambda cue: (cue.start, TYPE_ORDER[cue.type], cue.end))
