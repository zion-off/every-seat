"""The description writer on Amazon Nova Pro: a Strands agent that answers through a tool."""

import re

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from strands import Agent, tool
from strands.agent.conversation_manager import NullConversationManager
from strands.hooks import BeforeModelCallEvent, HookProvider, HookRegistry

from everyseat.agent import model
from everyseat.describe import DescribeError
from everyseat.describe.writers import MIN_WORDS, Request, Usage
from everyseat.detectors import sheet

MAX_MODEL_CALLS = 4  # the first answer plus a few corrections of a rejected one
MARKUP = re.compile(r"[*_#`<>\[\]{}|]|\n")

SYSTEM_INSTRUCTIONS = """\
You write audio description for a blind or low-vision viewer of an animated short film. Each
description is spoken aloud in a quiet stretch between lines of dialogue, so it must be short.

Rules:
- Present tense, plain words, one or two short sentences at a time.
- Say what is visible and essential to follow the story: who is where, what they do, what
  changes. Describe in the order things happen.
- Do not interpret. No guesses about thoughts, feelings, motives or what will happen. Say
  "she clenches her jaw", not "she is angry".
- No spoilers: describe only what the frames in front of you show.
- No camera or editing words ("the camera pans", "cut to", "we see").
- Do not repeat the dialogue and do not describe sounds or music.
- Use a character's name only once the dialogue or an earlier description has introduced it;
  until then describe the character by appearance. Keep names and wording consistent with the
  earlier descriptions.
- Stay within the word limit. Fewer words are fine when little happens.
- If nothing essential is visible in the window, say so by setting nothing_to_describe.

You are shown one contact sheet: one frame per shot in the window, each labelled with its time
in seconds from the start of the film. Answer only by calling submit_description once.
"""


class Submission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(default="", max_length=1200)
    nothing_to_describe: bool = False


def clean(text: str) -> str:
    """One line of plain words: no markup, no list marks, no surrounding quotes."""
    flat = MARKUP.sub(" ", text).strip().strip("\"'“”")
    return re.sub(r"\s+", " ", flat)


class _CallLimit(HookProvider):
    def __init__(self, limit: int):
        self.limit = limit
        self.calls = 0

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeModelCallEvent, self._before)

    def _before(self, event: BeforeModelCallEvent) -> None:
        self.calls += 1
        if self.calls > self.limit:
            event.cancel = f"stopped after {self.limit} model calls"


def _time(seconds: float) -> str:
    return sheet.plain_seconds(seconds)


def _dialogue(label: str, lines: list) -> str:
    if not lines:
        return f"{label}: none"
    spoken = "\n".join(f'  {_time(line.start)}: "{line.text}"' for line in lines)
    return f"{label}:\n{spoken}"


def request_text(request: Request) -> str:
    w = request.window
    parts = [
        f"Quiet window: {_time(w.start)} to {_time(w.end)} ({w.duration:.1f} s).",
        f"Word limit: at most {request.budget} words.",
    ]
    if request.cast:
        parts.append("Characters:\n" + "\n".join(f"  {entry}" for entry in request.cast))
    parts.append(_dialogue("Dialogue just before", request.before))
    parts.append(_dialogue("Dialogue just after", request.after))
    if request.previous:
        numbered = "\n".join(f"  {i}. {text}" for i, text in enumerate(request.previous, 1))
        parts.append(f"Earlier descriptions, oldest first:\n{numbered}")
    else:
        parts.append("Earlier descriptions: none yet (this is the first).")
    parts.append("The contact sheet follows. Call submit_description with your description.")
    return "\n\n".join(parts)


class NovaWriter:
    def __init__(self, choice: str = "nova-pro"):
        self.name = model.model_id(choice)
        self.usage = Usage()
        self._model = model.bedrock_model(choice, max_tokens=700, temperature=0.3)

    def write(self, request: Request) -> str | None:
        content = [
            {"text": request_text(request)},
            {"image": {"format": "jpeg", "source": {"bytes": request.picture}}},
        ]
        return self._ask(content, request.budget)

    def shorten(self, request: Request, text: str, target_words: int) -> str:
        w = request.window
        message = (
            f"The description below was too long to be spoken in the quiet window "
            f"({_time(w.start)} to {_time(w.end)}, {w.duration:.1f} s).\n\n"
            f'Description: "{text}"\n\n'
            f"Rewrite it in at most {target_words} words. Keep the most essential things, in the "
            "same order, in the same style. Call submit_description with the shorter version."
        )
        shorter = self._ask([{"text": message}], target_words)
        if shorter is None:
            raise DescribeError("the model gave up a description it was asked to shorten")
        return shorter

    def _ask(self, content: list, limit: int) -> str | None:
        answers: list[str | None] = []

        @tool
        def submit_description(text: str = "", nothing_to_describe: bool = False) -> str:
            """Submit the description for the window.

            Args:
                text: The description to be spoken, plain sentences only.
                nothing_to_describe: True when nothing essential is visible in the window.
            """
            try:
                given = Submission(text=text, nothing_to_describe=nothing_to_describe)
            except ValidationError as exc:
                return "error: " + "; ".join(e["msg"] for e in exc.errors())
            if given.nothing_to_describe:
                answers.append(None)
                return "ok"
            words = clean(given.text).split()
            if len(words) < MIN_WORDS:
                return f"error: write at least {MIN_WORDS} words, or set nothing_to_describe"
            if len(words) > limit:
                return f"error: {len(words)} words is over the limit of {limit}; shorten it"
            answers.append(" ".join(words))
            return "ok"

        watch = _CallLimit(MAX_MODEL_CALLS)
        agent = Agent(
            model=self._model,
            tools=[submit_description],
            system_prompt=SYSTEM_INSTRUCTIONS,
            callback_handler=None,
            conversation_manager=NullConversationManager(),
            hooks=[watch],
        )
        agent(content)
        usage = agent.event_loop_metrics.accumulated_usage
        self.usage.input_tokens += int(usage.get("inputTokens", 0))
        self.usage.output_tokens += int(usage.get("outputTokens", 0))
        self.usage.calls += watch.calls
        if not answers:
            raise DescribeError("the model did not submit a description")
        return answers[-1]

    @property
    def cost_usd(self) -> float:
        return model.cost_usd(self.name, self.usage.input_tokens, self.usage.output_tokens)
