"""The rules a description must pass before it is kept.

A model does not reliably follow rules written in a prompt, so they are enforced here: every
answer goes through `Review.check`, and a rejected one goes back to the writer with the reason.
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from everyseat.describe import Rejected

MIN_WORDS = 4
# Share of a description's content words that one earlier description already has. On Sintel the
# repeated descriptions scored 0.75 to 1.0 and the distinct ones 0.60 or less.
SIMILARITY_LIMIT = 0.7
EXCERPT_CHARS = 72

MARKUP = re.compile(r"[*_#`<>\[\]{}|]|\n")
# Words that talk about the film as a film instead of saying what happens in it.
BANNED = re.compile(
    r"\b(?:frames?|shots?|close[- ]?ups?|cameras?|images?|shows|showing|shown"
    r"|scene cuts?|cut to)\b",
    re.IGNORECASE,
)
WORD = re.compile(r"[a-z0-9]+")
STOPWORDS = frozenset(
    "a an the and or but of to in on at by for with from as is are was were be been it its "
    "her his she he they them their this that then there some one into onto over near while "
    "who which what when where up out off".split()
)


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
    kind: str  # short, long, banned or similar
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
    """What a writer calls with each answer: the answer, its word limit, and which step asked."""

    def __call__(self, text: str, limit: int, step: str = "write") -> Verdict: ...


def gave_up(answers: int, last: Verdict) -> Rejected:
    return Rejected(f"no acceptable description after {answers} answers (last: {last.summary})")


def excerpt(text: str, size: int = EXCERPT_CHARS) -> str:
    if len(text) <= size:
        return text
    return text[: size - 1].rsplit(" ", 1)[0].rstrip(",;:") + "…"


class Review:
    """The rules for the descriptions of one window, against what was already said in the film.
    Every decision is kept in `decisions` and passed to `say`.
    """

    def __init__(
        self, earlier: Sequence[Earlier], say: Callable[[str], None] | None = None
    ) -> None:
        self.earlier = list(earlier)
        self.say = say or (lambda _line: None)
        self.decisions: list[dict] = []
        self._answers: dict[str, int] = {}

    def check(self, text: str, limit: int, step: str = "write") -> Verdict:
        plain = clean(text)
        problems = self._problems(plain, limit)
        verdict = Verdict(plain, tuple(problems))
        number = self._answers[step] = self._answers.get(step, 0) + 1
        self.decisions.append(
            {
                "step": step,
                "answer": number,
                "accepted": verdict.ok,
                "text": plain,
                "problems": [{"kind": p.kind, "detail": p.detail} for p in problems],
            }
        )
        if verdict.ok:
            label = f"accepted ({len(plain.split())} words)"
        else:
            label = f"rejected - {verdict.summary}"
        self.say(f'    {step} {number}: {label}: "{excerpt(plain)}"')
        return verdict

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
