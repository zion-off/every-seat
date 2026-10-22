"""The description writer on Amazon Nova Pro: a Strands agent that answers through a tool."""

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from strands import Agent, tool
from strands.agent.conversation_manager import NullConversationManager
from strands.hooks import BeforeModelCallEvent, HookProvider, HookRegistry

from everyseat.agent import model
from everyseat.describe import DescribeError, Rejected
from everyseat.describe.review import Check, Verdict, gave_up
from everyseat.describe.writers import MAX_ANSWERS, Request, Usage
from everyseat.detectors import sheet

MAX_MODEL_CALLS = MAX_ANSWERS  # one call per answer; a wrap-up call after the last is cut off
EARLIER_SHOWN = 8  # the model is shown this many of the latest descriptions; the review sees all

SYSTEM_INSTRUCTIONS = """\
You write audio description for a blind or low-vision viewer of an animated short film. Each
description is spoken aloud in a quiet stretch between lines of dialogue, so it must be short.

Rules:
- Present tense, plain words, one or two short sentences at a time.
- Say what is visible and essential to follow the story: who is where, what they do, what
  changes. Describe in the order things happen.
- Do not interpret. No guesses about thoughts, feelings, motives or what will happen. Say
  "she clenches her jaw", not "she is angry".
- No spoilers: describe only what is visible in this window.
- Say what happens, never how it is filmed. Do not use the words frame, frames, shot,
  close-up, camera, image, shows or scene cuts, and do not write about the final or first
  picture of the window ("Final frame shows only white fog"). Write "Sintel climbs a wall", not
  "A close-up shows Sintel climbing".
- Never repeat an earlier description, in whole or in part. Every description must add
  something new. When the window only continues what an earlier description already said,
  say only what has changed, or set nothing_to_describe. A repeat is rejected.
- Do not repeat the dialogue and do not describe sounds or music.
- Use a character's name only once the dialogue or an earlier description has introduced it;
  until then describe the character by appearance. Keep names and wording consistent with the
  earlier descriptions.
- Stay within the word limit. Fewer words are fine when little happens.
- If nothing essential is visible in the window, say so by setting nothing_to_describe.

You are shown one contact sheet: one frame per shot in the window, each labelled with its time
in seconds from the start of the film. Answer only by calling submit_description once. If it
returns an error, correct the description as the error says and call it again.
"""


class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(default="", max_length=1200)
    nothing_to_describe: bool = False


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
    if request.earlier:
        shown = request.earlier[-EARLIER_SHOWN:]
        listed = "\n".join(f"  {_time(item.start)}: {item.text}" for item in shown)
        parts.append(
            "Earlier descriptions, oldest first, with the time each window started. Do not "
            f"repeat them; say only what is new:\n{listed}"
        )
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
        return self._ask(content, request.budget, request.check, "write")

    def shorten(self, request: Request, text: str, target_words: int) -> str:
        w = request.window
        message = (
            f"The description below was too long to be spoken in the quiet window "
            f"({_time(w.start)} to {_time(w.end)}, {w.duration:.1f} s).\n\n"
            f'Description: "{text}"\n\n'
            f"Rewrite it in at most {target_words} words. Keep the most essential things, in the "
            "same order, in the same style. Call submit_description with the shorter version."
        )
        shorter = self._ask([{"text": message}], target_words, request.check, "shorten")
        if shorter is None:
            raise Rejected("the model dropped a description it was asked to shorten")
        return shorter

    def _ask(self, content: list, limit: int, check: Check, step: str) -> str | None:
        answers: list[str | None] = []
        rejected: list[Verdict] = []

        @tool
        def submit_description(text: str = "", nothing_to_describe: bool = False) -> str:
            """Submit the description for the window.

            Args:
                text: The description to be spoken, plain sentences only.
                nothing_to_describe: True when nothing essential is visible in the window.
            """
            try:
                given = Draft(text=text, nothing_to_describe=nothing_to_describe)
            except ValidationError as exc:
                return "error: " + "; ".join(e["msg"] for e in exc.errors())
            if given.nothing_to_describe:
                answers.append(None)
                return "ok"
            verdict = check(given.text, limit, step)
            if not verdict.ok:
                rejected.append(verdict)
                return verdict.feedback
            answers.append(verdict.text)
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
            if rejected:
                raise gave_up(len(rejected), rejected[-1])
            raise DescribeError("the model did not submit a description")
        return answers[-1]

    @property
    def cost_usd(self) -> float:
        return model.cost_usd(self.name, self.usage.input_tokens, self.usage.output_tokens)
