"""What a writer is asked, and the stand-in writer used for dry runs."""

from dataclasses import dataclass, field
from typing import Protocol

from everyseat.describe.review import MIN_WORDS, Check, Earlier
from everyseat.describe.subtitles import Line, Window

WORDS_PER_SECOND = 2.5
MAX_ANSWERS = 5  # answers a writer may give for one window, the first and its corrections


def word_budget(window: Window) -> int:
    return max(MIN_WORDS, int(window.duration * WORDS_PER_SECOND))


@dataclass(frozen=True)
class Request:
    window: Window
    picture: bytes  # JPEG contact sheet, one tile per shot, labelled in seconds
    before: list[Line]
    after: list[Line]
    earlier: list[Earlier]  # every description kept so far, oldest first
    check: Check  # every answer goes through it before it can be kept
    cast: list[str] = field(default_factory=list)

    @property
    def budget(self) -> int:
        return word_budget(self.window)


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0


class Writer(Protocol):
    name: str
    usage: Usage

    @property
    def cost_usd(self) -> float: ...

    def write(self, request: Request) -> str | None:
        """The description for the window, or None when nothing essential is on screen.

        Each answer goes through `request.check`; a rejected one is corrected, up to
        `MAX_ANSWERS` answers, and `Rejected` is raised when none passes.
        """
        ...

    def shorten(self, request: Request, text: str, target_words: int) -> str:
        """A shorter version of `text` that keeps the most essential things, checked the same
        way; `Rejected` when no acceptable one is given.
        """
        ...


class StubWriter:
    """Placeholder text with exactly the word budget; shortening keeps the first words."""

    name = "placeholder text"

    cost_usd = 0.0

    def __init__(self) -> None:
        self.usage = Usage()

    def write(self, request: Request) -> str | None:
        self.usage.calls += 1
        w = request.window
        lead = f"Placeholder description for {w.start:g} to {w.end:g} seconds.".split()
        padding = ["placeholder"] * max(0, request.budget - len(lead))
        return " ".join([*lead, *padding])

    def shorten(self, request: Request, text: str, target_words: int) -> str:
        self.usage.calls += 1
        return " ".join(text.split()[:target_words])
