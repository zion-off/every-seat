"""Checks on the agent's drafted cues: the file validator plus the rules a player relies on."""

import math
from bisect import bisect_right

from everyseat.agent.session import STRONG_FLASH, Session
from everyseat.compose import writer
from everyseat.compose.cues import Cue
from everyseat.compose.merge import MIN_LOUD_GAP_S
from everyseat.contracts.validate import validate_sensevtt

MIN_FLASH_INTENSITY_FAIL = 4


def problems(session: Session) -> list[str]:
    """Everything that stops the drafted cues from being final; an empty list means done."""
    cues = writer.finalize(session.title, session.cues())
    rendered = writer.render(session.head, cues)
    found = []
    for issue in validate_sensevtt(rendered.text):
        index = bisect_right(rendered.cue_lines, issue.line) - 1
        where = f"cue {cues[index].ref} ({cues[index].type}): " if index >= 0 else "file header: "
        found.append(where + issue.message)
    found += _undecided(session)
    found += _flash_intensity(session)
    found += _lead_times(cues)
    found += _card_spacing(cues)
    return found


def _undecided(session: Session) -> list[str]:
    return [
        f"candidate {c.id} ({c.type}, {c.start:g} s to {c.end:g} s) has no decision: "
        "submit a cue for it or skip it with a reason"
        for c in session.unresolved()
    ]


def _flash_intensity(session: Session) -> list[str]:
    found = []
    for cue in session.cues():
        candidate = session.candidates.get(cue.ref)
        if cue.type != "flash" or candidate is None:
            continue
        if candidate.evidence.get("worst") in STRONG_FLASH:
            if cue.intensity < MIN_FLASH_INTENSITY_FAIL:
                found.append(
                    f"cue {cue.ref} (flash): the flash analyzer failed this run, so its "
                    f"intensity must be {MIN_FLASH_INTENSITY_FAIL} or 5, not {cue.intensity}"
                )
    return found


def _lead_times(cues: list[Cue]) -> list[str]:
    return [
        f"cue {cue.ref} ({cue.type}): the heads-up lead of {cue.lead:g} s would start before "
        "the film does; lower lead_s"
        for cue in cues
        if cue.type != "flash" and cue.start - cue.lead < 0
    ]


def _card_spacing(cues: list[Cue]) -> list[str]:
    """A heads-up card must not appear while the previous loud or scary moment is still on."""
    events: dict[float, list[Cue]] = {}
    for cue in cues:
        if cue.type != "flash":
            events.setdefault(cue.start, []).append(cue)
    found = []
    previous: list[Cue] | None = None
    for start in sorted(events):
        current = events[start]
        if previous is not None:
            ends = max(cue.end for cue in previous)
            lead = max(cue.lead for cue in current)
            if start - lead < ends:
                room = math.floor((start - ends) * 10) / 10
                found.append(
                    f"cue {current[0].ref}: its card would appear at {start - lead:g} s, "
                    f"before the previous moment ({previous[0].ref}) ends at {ends:g} s; "
                    + (
                        f"set lead_s to {room:g} or less on each cue at that moment"
                        if room >= MIN_LOUD_GAP_S
                        else "the moments are too close for separate cards: skip one of them"
                    )
                )
        previous = current
    return found
