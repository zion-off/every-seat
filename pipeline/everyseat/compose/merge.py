"""Merging cues of one kind that sit too close together to be shown or softened separately."""

from dataclasses import replace

from everyseat.compose.cues import Cue

MIN_LOUD_GAP_S = 2.0  # a heads-up card needs this much room before the next moment


def _gap_needed(cue: Cue) -> float:
    """Flash ramps must not begin inside the previous run, so they need their margins between."""
    return cue.pre + cue.post if cue.type == "flash" else MIN_LOUD_GAP_S


def merge_close(cues: list[Cue]) -> list[Cue]:
    """Join same-type cues whose gap is smaller than the room that kind needs.

    The merged cue spans both events, takes the stronger intensity and preview, and keeps the
    first cue's anchor and margins. Its `ref` lists the candidates it covers, joined by `+`.
    """
    merged: list[Cue] = []
    by_type: dict[str, Cue] = {}
    for cue in sorted(cues, key=lambda c: (c.start, c.end)):
        last = by_type.get(cue.type)
        if last is None or cue.start - last.end >= _gap_needed(last):
            by_type[cue.type] = cue
            merged.append(cue)
            continue
        stronger = cue if cue.intensity > last.intensity else last
        joined = replace(
            last,
            end=max(last.end, cue.end),
            intensity=stronger.intensity,
            preview=stronger.preview,
            ref=f"{last.ref}+{cue.ref}",
            evidence={**stronger.evidence, "merged_from": [*last.refs, *cue.refs]},
        )
        merged[merged.index(last)] = joined
        by_type[cue.type] = joined
    return merged
