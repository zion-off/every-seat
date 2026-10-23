"""The rules a description must pass before it is kept.

A model does not reliably follow rules written in a prompt, so they are enforced here: every
answer goes through `Review.check`, and a rejected one goes back to the writer with the reason.
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from everyseat.describe import Rejected
from everyseat.describe.shots import Tile

MIN_WORDS = 5  # a shorter text is a fragment, not a sentence
# Share of a description's content words that one earlier description already has. On Sintel the
# repeated descriptions scored 0.75 to 1.0 and the distinct ones 0.60 or less.
SIMILARITY_LIMIT = 0.7
EXCERPT_CHARS = 72

MARKUP = re.compile(r"[*_#`<>\[\]{}|]|\n")
# Words that talk about the film as a film instead of saying what happens in it.
BANNED = re.compile(
    r"\b(?:frames?|shots?|close[- ]?ups?|cameras?|images?|shows|showing|shown"
    r"|scenes?|transitions?|transitioning|visible|lens(?:es)?|cut to)\b",
    re.IGNORECASE,
)
WORD = re.compile(r"[a-z0-9]+")
STOPWORDS = frozenset(
    "a an the and or but of to in on at by for with from as is are was were be been it its "
    "her his she he they them their this that then there some one into onto over near while "
    "who which what when where up out off".split()
)


# Words that may follow a verb without an article: a determiner, a preposition or particle, a
# pronoun, a conjunction. Anything else right after "<Name> <verb>s" is a bare noun phrase.
OK_AFTER_VERB = frozenset(
    "a an the to at in on of into onto across through toward towards from with without by for "
    "over under behind beside near past along around inside outside against between among "
    "above below beyond ahead up down out off away back forward again closer apart "
    "together alone aside open "
    "her his their its him them herself himself itself themselves it she he they that this "
    "these those each every another "
    "some one two three four five six seven eight nine ten no all both and but then as while "
    "when until before after not never still just only slowly quickly".split()
)
MAX_FRAGMENT_WORDS = 6  # a longer sentence without a known verb is let through
PREPOSITIONS_NEEDING_ARTICLE = frozenset({"with", "using"})
AUXILIARIES = frozenset(
    "is are was were has have had does do did goes go will can must be been being".split()
)
BASE_VERBS = frozenset(
    "run walk fight climb jump fall look turn stand sit move rise fly swing hold pull push "
    "race chase strike swim crawl kneel stare watch wait flee escape enter leave meet "
    "stumble lunge reach fire drop lift grab stop gather rush charge circle".split()
)
SUBJECT_VERB = re.compile(r"^(?:[A-Z][\w']*|She|He|They|It)\s+(\w+s)\s+(\w[\w']*)")
WORD_ANY = re.compile(r"[A-Za-z0-9']+")
NOT_VERBS = frozenset("this its his us yes".split())


def _looks_like_verb(word: str) -> bool:
    lower = word.lower()
    if lower in AUXILIARIES or lower in BASE_VERBS:
        return True
    if lower in NOT_VERBS or len(lower) < 4:
        return False
    return lower.endswith(("ed", "ing")) or (lower.endswith("s") and not lower.endswith("ss"))


def grammar_problem(text: str) -> str | None:
    """A simple check for the telegraphic text a squeezed rewrite produces: a sentence with no
    verb ("Sintel and dragon battle."), a bare noun phrase after the verb ("Sintel jumps new
    location.") or after "with" ("with weapon"). Heuristic only: it catches the common shapes
    and lets anything unusual through.
    """
    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        words = WORD_ANY.findall(sentence)
        if not words:
            continue
        if len(words) <= MAX_FRAGMENT_WORDS and not any(_looks_like_verb(w) for w in words[1:]):
            return f'no verb in "{excerpt(sentence)}"'
        match = SUBJECT_VERB.match(sentence)
        if match and _looks_like_verb(match.group(1)):
            after = match.group(2)
            if (
                after.lower() not in OK_AFTER_VERB
                and not _looks_like_verb(after)  # "Two soldiers run": the first word is a noun
                and not (after[0].isupper() or after.endswith(("ing", "ly")))
            ):
                return f'"{match.group(1)} {after}" lacks an article or a preposition'
        for left, right in zip(words, words[1:], strict=False):
            # Only a noun that ends the sentence is bare: "with weapon." but "with carved designs".
            if (
                right is words[-1]
                and left.lower() in PREPOSITIONS_NEEDING_ARTICLE
                and (
                    right.lower() not in OK_AFTER_VERB
                    and not right[0].isupper()
                    and not right.lower().endswith(("s", "ing"))
                )
            ):
                return f'"{left} {right}" lacks an article'
    return None


def clean(text: str) -> str:
    """One line of plain words: no markup, no list marks, no surrounding quotes."""
    flat = MARKUP.sub(" ", text).strip().strip("\"'“”")
    return re.sub(r"\s+", " ", flat)


def banned_words(text: str) -> list[str]:
    return list(dict.fromkeys(match.group().lower() for match in BANNED.finditer(text)))


def _stem(word: str) -> str:
    """Enough of a stem that fights, fighting and fight meet; not a linguist's one."""
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            word = word[: -len(suffix)]
            break
    if len(word) > 3 and word.endswith("e"):
        word = word[:-1]
    if len(word) > 3 and word[-1] == word[-2] and word[-1] not in "aeiou":
        word = word[:-1]
    return word


def content_words(text: str) -> frozenset[str]:
    words = (w for w in WORD.findall(text.lower()) if len(w) > 1 and w not in STOPWORDS)
    return frozenset(_stem(w) for w in words)


@dataclass(frozen=True)
class Earlier:
    """A description already kept for the film, with the time its window starts."""

    start: float
    text: str


def most_similar(text: str, earlier: Sequence[Earlier]) -> tuple[Earlier, float] | None:
    """The earlier description that already says most of `text`, with the share of the content
    words of `text` that it has. The share is of `text` alone, so a description that only repeats
    the first half of an earlier one counts as a full repeat.
    """
    mine = content_words(text)
    if not mine:
        return None
    best: tuple[Earlier, float] | None = None
    for item in earlier:
        share = len(mine & content_words(item.text)) / len(mine)
        if best is None or share >= best[1]:
            best = (item, share)
    return best


@dataclass(frozen=True)
class Problem:
    kind: str  # short, long, banned, grammar or similar
    detail: str  # a few words, for the log
    message: str  # what the writer is told


@dataclass(frozen=True)
class Verdict:
    text: str  # the answer as plain words
    problems: tuple[Problem, ...] = ()

    @property
    def ok(self) -> bool:
        return not self.problems

    @property
    def summary(self) -> str:
        return "; ".join(f"{p.kind}: {p.detail}" for p in self.problems)

    @property
    def feedback(self) -> str:
        """The tool result that sends a rejected answer back to the writer."""
        return "error: " + " ".join(p.message for p in self.problems)


class Check(Protocol):
    """What a writer calls with each answer: the answer, its word limit, and which step asked.

    An item of a window also says which tile it cites and, when an item came before it, the
    highest tile that one cited.
    """

    def __call__(
        self,
        text: str,
        limit: int,
        step: str = "write",
        *,
        tile: int | None = None,
        after: int | None = None,
    ) -> Verdict: ...


def gave_up(answers: int, last: Verdict) -> Rejected:
    return Rejected(f"no acceptable description after {answers} answers (last: {last.summary})")


def excerpt(text: str, size: int = EXCERPT_CHARS) -> str:
    if len(text) <= size:
        return text
    return text[: size - 1].rsplit(" ", 1)[0].rstrip(",;:") + "…"


class Review:
    """The rules for the descriptions of one window, against what was already said in the film.
    Every decision is kept in `decisions` and passed to `say`.

    `tiles` are the numbered stills of the window's contact sheet; an item that cites one must
    cite a tile that exists, has something to see and does not come before the previous item's.
    """

    def __init__(
        self,
        earlier: Sequence[Earlier],
        say: Callable[[str], None] | None = None,
        tiles: Sequence[Tile] = (),
    ) -> None:
        self.earlier = list(earlier)
        self.say = say or (lambda _line: None)
        self.tiles = {t.number: t for t in tiles}
        self.decisions: list[dict] = []
        self._answers: dict[str, int] = {}

    def check(
        self,
        text: str,
        limit: int,
        step: str = "write",
        *,
        tile: int | None = None,
        after: int | None = None,
    ) -> Verdict:
        plain = clean(text)
        problems = self._problems(plain, limit)
        if tile is not None:
            problems = [*self._tile_problems(tile, after), *problems]
        verdict = Verdict(plain, tuple(problems))
        number = self._answers[step] = self._answers.get(step, 0) + 1
        self.decisions.append(
            {
                "step": step,
                "answer": number,
                "accepted": verdict.ok,
                **({"tile": tile} if tile is not None else {}),
                "text": plain,
                "problems": [{"kind": p.kind, "detail": p.detail} for p in problems],
            }
        )
        if verdict.ok:
            label = f"accepted ({len(plain.split())} words)"
        else:
            label = f"rejected - {verdict.summary}"
        cited = f" [tile {tile}]" if tile is not None else ""
        self.say(f'    {step} {number}{cited}: {label}: "{excerpt(plain)}"')
        return verdict

    def _tile_problems(self, number: int, after: int | None) -> list[Problem]:
        tile = self.tiles.get(number)
        if tile is None:
            last = max(self.tiles, default=0)
            return [
                Problem(
                    "tile",
                    f"tile {number} is not on the sheet",
                    f"tile {number} is not on the contact sheet, which has tiles 1 to {last}. "
                    "Cite the number of a tile that shows what the sentence says.",
                )
            ]
        problems = []
        if not tile.usable:
            problems.append(
                Problem(
                    "tile",
                    f"tile {number} at {tile.time:.1f} s is not describable, {tile.problem}",
                    f"tile {number} ({tile.time:.1f} s) is {tile.problem}, so nothing can be "
                    "described from it. Cite the first tile where what you describe is actually "
                    "on screen, or set nothing_to_describe.",
                )
            )
        if after is not None and number < after:
            problems.append(
                Problem(
                    "order",
                    f"tile {number} after tile {after}",
                    f"tile {number} comes before tile {after}, which the item above cites. Give "
                    "the items in the order of the tiles, never going back to an earlier one.",
                )
            )
        return problems

    def _problems(self, plain: str, limit: int) -> list[Problem]:
        count = len(plain.split())
        problems = []
        if count < MIN_WORDS:
            problems.append(
                Problem(
                    "short",
                    f"{count} words",
                    f"write at least {MIN_WORDS} words, or set nothing_to_describe.",
                )
            )
        elif count > limit:
            problems.append(
                Problem(
                    "long",
                    f"{count} words, limit {limit}",
                    f"{count} words is over the limit of {limit}; shorten it.",
                )
            )
        found = banned_words(plain)
        if found:
            quoted = ", ".join(f'"{w}"' for w in found)
            problems.append(
                Problem(
                    "banned",
                    ", ".join(found),
                    f"do not use the words {quoted}: say what happens and who is where, never "
                    "how it is filmed or shown. Rewrite it without them.",
                )
            )
        broken = grammar_problem(plain) if count >= MIN_WORDS else None
        if broken:
            problems.append(
                Problem(
                    "grammar",
                    broken,
                    f"{broken}. Write a complete sentence with a subject, a verb and articles "
                    '("Sintel jumps onto a ledge", not "Sintel jumps new location").',
                )
            )
        similar = most_similar(plain, self.earlier) if count >= MIN_WORDS else None
        if similar and similar[1] >= SIMILARITY_LIMIT:
            earlier, share = similar
            problems.append(
                Problem(
                    "similar",
                    f"{share:.0%} already said at {earlier.start:.1f} s",
                    f"this repeats the description at {earlier.start:.1f} s "
                    f'("{earlier.text}"): {share:.0%} of what you wrote is already said there. '
                    "Do not say it again. Say only what is NEW in this window, in different "
                    "words, or set nothing_to_describe if nothing essential has changed.",
                )
            )
        return problems
