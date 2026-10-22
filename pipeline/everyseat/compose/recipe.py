"""The comfort audio recipe: gain-ride windows around the loud moments."""

from everyseat.compose.cues import Cue

DEFAULTS = {"gain_db": -18, "pre_s": 0.4, "ramp_s": 0.3, "release_s": 1.0, "limiter": 0.25}


def comfort_recipe(cues: list[Cue]) -> dict:
    """A recipe with one window per `loud` cue (overlapping windows are merged).

    The comfort rendition lowers the gain from `onset - pre_s` to `end`. A scare cue whose sound
    is the scare shares its onset with a loud cue, so scares add no windows of their own.
    """
    windows: list[dict] = []
    for cue in sorted((c for c in cues if c.type == "loud"), key=lambda c: c.start):
        if windows and cue.start <= windows[-1]["end"]:
            windows[-1]["end"] = max(windows[-1]["end"], cue.end)
        else:
            windows.append({"onset": cue.start, "end": cue.end})
    return {**DEFAULTS, "windows": windows}
