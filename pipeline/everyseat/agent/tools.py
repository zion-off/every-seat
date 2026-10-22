"""The Strands tools the scene agent calls; each is a thin wrapper over the session."""

from pydantic import ValidationError
from strands import tool

from everyseat.agent import checks
from everyseat.agent.session import NO_VALUE, CueProposal, Session


def _optional(value: float) -> float | None:
    return None if value < 0 else value


def build_tools(session: Session) -> list:
    @tool
    def inspect(start_s: float, end_s: float, tiles: int = 8) -> dict:
        """Look at a stretch of the film: a contact sheet of frames plus a loudness plot.

        Args:
            start_s: Window start, in film time (seconds).
            end_s: Window end, in film time (seconds). At most 20 s after start_s.
            tiles: How many frames to tile, 4 to 12.
        """
        session.tool_calls += 1
        return session.inspect(start_s, end_s, tiles)

    @tool
    def submit_cue(
        cue_type: str,
        intensity: int,
        preview: str,
        reasoning: str,
        candidate_id: str = "",
        start_s: float = NO_VALUE,
        end_s: float = NO_VALUE,
        lead_s: float = NO_VALUE,
    ) -> str:
        """Record a comfort cue for a moment. The times always come from a detector.

        Submitting again for the same candidate and type replaces the earlier cue.

        Args:
            cue_type: "flash" (candidate type flash), or "loud" or "scare" (candidate type loud).
            intensity: 1 (mild) to 5 (severe), as described in the instructions.
            preview: What a viewer will see in a heads-up card, at most 120 characters.
            reasoning: Why this matters, in one or two sentences; kept as evidence.
            candidate_id: The candidate (for example "c3") this cue is for. Leave empty only for
                a moment no candidate covers.
            start_s: Film time of a moment no candidate covers; it is snapped to a detector.
            end_s: Optional end of that moment. Leave out to use 3 s.
            lead_s: Heads-up lead in seconds, 2 to 30. Leave out for the default of 5.
        """
        session.tool_calls += 1
        try:
            proposal = CueProposal(
                cue_type=cue_type,
                intensity=intensity,
                preview=preview.strip(),
                reasoning=reasoning.strip(),
                candidate_id=candidate_id.strip(),
                start_s=_optional(start_s),
                end_s=_optional(end_s),
                lead_s=_optional(lead_s),
            )
        except ValidationError as exc:
            lines = [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()]
            return "error: invalid cue. " + "; ".join(lines)
        return session.propose(proposal)

    @tool
    def skip_candidate(candidate_id: str, reason: str) -> str:
        """Decide that a candidate needs no cue, and say why. Removes any cue made for it.

        Args:
            candidate_id: The candidate, for example "c3".
            reason: One sentence on why it needs no cue.
        """
        session.tool_calls += 1
        return session.skip(candidate_id.strip(), reason)

    @tool
    def drop_cue(candidate_id: str, cue_type: str) -> str:
        """Remove one cue that was recorded earlier.

        Args:
            candidate_id: The candidate the cue was recorded for (or "n1", "n2" for a free cue).
            cue_type: "flash", "loud" or "scare".
        """
        session.tool_calls += 1
        return session.drop(candidate_id.strip(), cue_type.strip())

    @tool
    def validate() -> str:
        """Check every recorded cue against the file format and the player's rules.

        Returns "ok" when nothing is left to fix, else one problem per line.
        """
        session.tool_calls += 1
        found = checks.problems(session)
        return "ok" if not found else "\n".join(found)

    return [inspect, submit_cue, skip_candidate, drop_cue, validate]
