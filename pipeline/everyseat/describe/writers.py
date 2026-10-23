"""What a writer is asked, and the stand-in writer used for dry runs."""

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from everyseat.describe import DescribeError, Rejected
from everyseat.describe.anchor import WORDS_PER_SECOND, Item
from everyseat.describe.review import MIN_WORDS, Check, Earlier, Verdict, gave_up
from everyseat.describe.shots import Tile
from everyseat.describe.subtitles import Line, Window

STUB_ITEMS = 3  # items a placeholder answer has at most
NO_SUBMIT_RETRIES = 2  # reminders after an answer that never called the submit tool
NO_SUBMIT_REASON = "no description (model did not submit)"


def model_error_reason(error: str) -> str:
    return f"no description (model error: {error})"


NO_SUBMIT_REPLY = "Call submit_description with your items, or with nothing_to_describe=true."
MAX_ANSWERS = 5  # answers a writer may give for one window, the first and its corrections


def word_budget(window: Window) -> int:
    return max(MIN_WORDS, int(window.duration * WORDS_PER_SECOND))


@dataclass(frozen=True)
class Request:
    window: Window
    picture: bytes  # JPEG contact sheet: numbered tiles, each labelled with its time in seconds
    before: list[Line]
    after: list[Line]
    earlier: list[Earlier]  # every description kept so far, oldest first
    check: Check  # every answer goes through it before it can be kept
    cast: list[str] = field(default_factory=list)
    plot: str = ""  # a short synopsis of the film, for recognising characters and places
    tiles: list[Tile] = field(default_factory=list)  # the contact sheet, numbered from 1
    note: Callable[[str], None] = lambda _line: None  # where a writer reports what it does

    @property
    def budget(self) -> int:
        return word_budget(self.window)

    def tile(self, number: int) -> Tile | None:
        return self.tiles[number - 1] if 1 <= number <= len(self.tiles) else None


@dataclass(frozen=True)
class Cite:
    """A sentence and the number of the tile it says it describes."""

    tile: int
    text: str


def review_items(
    request: Request, cites: Sequence[Cite], limit: int, step: str
) -> tuple[list[Item], list[tuple[int, Verdict]]]:
    """Every item of an answer through the review, each with the tile it cites and against the
    tile of the item above it: the tiles must not go back.

    Returns the items, each at the time of its tile's frame, which make an answer only when the
    second list is empty, and the number (from 1) and the verdict of each item turned down.
    """
    items: list[Item] = []
    bad: list[tuple[int, Verdict]] = []
    above = None
    for number, cite in enumerate(cites, 1):
        verdict = request.check(cite.text, limit, step, tile=cite.tile, after=above)
        tile = request.tile(cite.tile)
        if tile:
            above = cite.tile
        if tile and verdict.ok:
            items.append(Item(cite.tile, tile.time, verdict.text))
        else:
            bad.append((number, verdict))
    return items, bad


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

    def write(self, request: Request) -> list[Item] | None:
        """The items for the window, each tied to the numbered tile it describes, or None when
        nothing essential is on screen.

        Every item of an answer goes through `request.check`, with its tile; a rejected answer is
        corrected, up to `MAX_ANSWERS` answers, and `Rejected` is raised when none passes.
        """
        ...

    def shorten(
        self, request: Request, text: str, target_words: int, start_s: float, slot_s: float
    ) -> str:
        """A shorter version of `text`, which is spoken from `start_s` and may last `slot_s`,
        that keeps the most essential things, checked the same way; `Rejected` when no
        acceptable one is given.
        """
        ...


@dataclass(frozen=True)
class Script:
    """Answers a dry run gives in place of the placeholder text, by window number.

    `write[n]` holds the answers for window n in order. An answer is a list of items
    `{"tile": number, "text": "..."}`, a plain text (one item at the first tile with something
    to see) or None for "nothing to describe". `shorten[n]` holds the answers to the requests to
    shorten a text in that window.
    """

    write: dict[int, list[list[Cite] | str | None]] = field(default_factory=dict)
    shorten: dict[int, list[str | None]] = field(default_factory=dict)


MODEL_ERROR = "<model_error>"  # prefix of a scripted answer in which the model call fails
NO_SUBMIT = "<no_submit>"  # a scripted answer in which the model never calls the tool


def _answer(given: object, where: str) -> list[Cite] | str | None:
    if given is None or isinstance(given, str):
        return given
    if given == {"no_submit": True}:
        return NO_SUBMIT
    if isinstance(given, dict) and set(given) == {"model_error"}:
        return f"{MODEL_ERROR}{given['model_error']}"
    if isinstance(given, list) and given:
        try:
            return [Cite(int(g["tile"]), str(g["text"])) for g in given]
        except (KeyError, TypeError, ValueError) as exc:
            raise DescribeError(f'{where}: items are {{"tile": number, "text": "..."}}') from exc
    raise DescribeError(f"{where}: write answers are text, a list of items or null")


def load_script(path: Path) -> Script:
    """Read `{"<window>": {"write": [answer, ...], "shorten": [text or null, ...]}}`."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise DescribeError(f"cannot read the script {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise DescribeError(f"{path}: expected an object keyed by window number")
    write: dict[int, list[list[Cite] | str | None]] = {}
    shorten: dict[int, list[str | None]] = {}
    for key, entry in data.items():
        where = f"{path}: window {key!r}"
        if not (key.isdigit() and isinstance(entry, dict) and set(entry) <= {"write", "shorten"}):
            raise DescribeError(f'{where}: expected {{"write": [...], "shorten": [...]}}')
        answers = entry.get("write")
        if not isinstance(answers, list) or not 1 <= len(answers) <= MAX_ANSWERS:
            raise DescribeError(f"{where}: write takes 1 to {MAX_ANSWERS} answers")
        write[int(key)] = [_answer(a, where) for a in answers]
        shortened = entry.get("shorten", [])
        if not isinstance(shortened, list) or not all(
            a is None or isinstance(a, str) for a in shortened
        ):
            raise DescribeError(f"{where}: shorten answers are text or null")
        if shortened:
            shorten[int(key)] = shortened
    return Script(write, shorten)


class StubWriter:
    """Placeholder items, one per describable tile of the window (at most `STUB_ITEMS`, spread
    over the window), each with a share of the word budget; shortening keeps the first words.

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

    def write(self, request: Request) -> list[Item] | None:
        queue = self._write.get(request.window.index)
        if queue:
            return self._ask_items(request, queue)
        self.usage.calls += 1
        w = request.window
        usable = [t for t in request.tiles if t.usable]
        tiles = usable[:: max(1, -(-len(usable) // STUB_ITEMS))][:STUB_ITEMS]
        if not tiles:
            return None
        share = max(MIN_WORDS, request.budget // len(tiles))
        items = []
        for tile in tiles:
            lead = (
                f"Placeholder description for {tile.time:g} seconds in "
                f"{w.start:g} to {w.end:g}.".split()
            )
            padding = ["placeholder"] * max(0, share - len(lead))
            items.append(Item(tile.number, tile.time, " ".join([*lead, *padding])))
        return items

    def shorten(
        self, request: Request, text: str, target_words: int, start_s: float, slot_s: float
    ) -> str:
        queue = self._shorten.get(request.window.index)
        if queue:
            verdict = None
            asked = 0
            while queue and asked < MAX_ANSWERS:
                given = queue.pop(0)
                asked += 1
                self.usage.calls += 1
                if given is None:
                    raise Rejected("the script declined to shorten the description")
                verdict = request.check(given, target_words, "shorten")
                if verdict.ok:
                    return verdict.text
            if verdict is None:
                raise Rejected("the script has no answer left to shorten the description")
            raise gave_up(asked, verdict)
        self.usage.calls += 1
        return " ".join(text.split()[:target_words])

    def _ask_items(self, request: Request, queue: list) -> list[Item] | None:
        verdict = None
        asked = 0
        silent = 0
        while queue and asked < MAX_ANSWERS:
            given = queue.pop(0)
            asked += 1
            self.usage.calls += 1
            if given is None:
                return None
            failing = isinstance(given, str) and given.startswith(MODEL_ERROR)
            if given == NO_SUBMIT or failing:
                silent += 1
                error = given[len(MODEL_ERROR) :] if failing else ""
                if failing:
                    request.note(f"    model error: {error}")
                if silent > NO_SUBMIT_RETRIES:
                    raise Rejected(model_error_reason(error) if failing else NO_SUBMIT_REASON)
                request.note(
                    f"    the model did not call submit_description; reminding it "
                    f"({silent}/{NO_SUBMIT_RETRIES})"
                )
                continue
            if isinstance(given, str):
                first = next((t.number for t in request.tiles if t.usable), 1)
                given = [Cite(first, given)]
            items, bad = review_items(request, given, request.budget, "write")
            if not bad:
                return items
            verdict = bad[-1][1]
        if verdict is None:
            raise Rejected(f"the script has no answer left for window {request.window.index}")
        raise gave_up(asked, verdict)
