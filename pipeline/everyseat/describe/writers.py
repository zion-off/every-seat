"""What a writer is asked, and the stand-in writer used for dry runs."""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from everyseat.describe import DescribeError, Rejected
from everyseat.describe.review import MIN_WORDS, Check, Earlier, gave_up
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
    plot: str = ""  # a short synopsis of the film, for recognising characters and places

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


@dataclass(frozen=True)
class Script:
    """Answers a dry run gives in place of the placeholder text, by window number.

    `write[n]` holds the answers for window n in order; None is "nothing to describe".
    `shorten[n]` holds the answers to the requests to shorten a text in that window.
    """

    write: dict[int, list[str | None]] = field(default_factory=dict)
    shorten: dict[int, list[str | None]] = field(default_factory=dict)


def load_script(path: Path) -> Script:
    """Read `{"<window>": {"write": [text or null, ...], "shorten": [text or null, ...]}}`."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise DescribeError(f"cannot read the script {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise DescribeError(f"{path}: expected an object keyed by window number")
    write: dict[int, list[str | None]] = {}
    shorten: dict[int, list[str | None]] = {}
    for key, entry in data.items():
        where = f"{path}: window {key!r}"
        if not (key.isdigit() and isinstance(entry, dict) and set(entry) <= {"write", "shorten"}):
            raise DescribeError(f'{where}: expected {{"write": [...], "shorten": [...]}}')
        answers = entry.get("write")
        if not isinstance(answers, list) or not 1 <= len(answers) <= MAX_ANSWERS:
            raise DescribeError(f"{where}: write takes 1 to {MAX_ANSWERS} answers")
        if not all(a is None or isinstance(a, str) for a in answers):
            raise DescribeError(f"{where}: write answers are text or null")
        shortened = entry.get("shorten", [])
        if not isinstance(shortened, list) or not all(
            a is None or isinstance(a, str) for a in shortened
        ):
            raise DescribeError(f"{where}: shorten answers are text or null")
        write[int(key)] = answers
        if shortened:
            shorten[int(key)] = shortened
    return Script(write, shorten)


class StubWriter:
    """Placeholder text with exactly the word budget; shortening keeps the first words.

    Windows named in the script get its answers instead, and each goes through the review like a
    model's answer, so every rejection path can be exercised without a model.
    """

    name = "placeholder text"

    cost_usd = 0.0

    def __init__(self, script: Script | None = None) -> None:
        self.usage = Usage()
        script = script or Script()
        self._write = {n: list(answers) for n, answers in script.write.items()}
        self._shorten = {n: list(answers) for n, answers in script.shorten.items()}

    def write(self, request: Request) -> str | None:
        queue = self._write.get(request.window.index)
        if queue:
            return self._ask(request, queue, request.budget, "write")
        self.usage.calls += 1
        w = request.window
        lead = f"Placeholder description for {w.start:g} to {w.end:g} seconds.".split()
        padding = ["placeholder"] * max(0, request.budget - len(lead))
        return " ".join([*lead, *padding])

    def shorten(self, request: Request, text: str, target_words: int) -> str:
        queue = self._shorten.get(request.window.index)
        if queue:
            answer = self._ask(request, queue, target_words, "shorten")
            if answer is None:
                raise Rejected("the script declined to shorten the description")
            return answer
        self.usage.calls += 1
        return " ".join(text.split()[:target_words])

    def _ask(self, request: Request, queue: list[str | None], limit: int, step: str) -> str | None:
        verdict = None
        asked = 0
        while queue and asked < MAX_ANSWERS:
            given = queue.pop(0)
            asked += 1
            self.usage.calls += 1
            if given is None:
                return None
            verdict = request.check(given, limit, step)
            if verdict.ok:
                return verdict.text
        if verdict is None:
            raise Rejected(f"the script has no answer left for window {request.window.index}")
        raise gave_up(asked, verdict)
