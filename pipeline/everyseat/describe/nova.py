"""The description writer on Amazon Nova Pro: a Strands agent that answers through a tool."""

from collections.abc import Callable

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from strands import Agent, tool
from strands.agent.conversation_manager import NullConversationManager
from strands.hooks import BeforeModelCallEvent, HookProvider, HookRegistry

from everyseat.agent import model
from everyseat.describe import Rejected
from everyseat.describe.anchor import Item
from everyseat.describe.review import Check, Verdict, gave_up
from everyseat.describe.writers import (
    MAX_ANSWERS,
    NO_SUBMIT_REASON,
    NO_SUBMIT_REPLY,
    NO_SUBMIT_RETRIES,
    Request,
    Usage,
)
from everyseat.detectors import sheet

MAX_MODEL_CALLS = MAX_ANSWERS + NO_SUBMIT_RETRIES  # one call per answer, and per reminder
MAX_ITEMS = 8  # items one answer may have
EARLIER_SHOWN = 8  # the model is shown this many of the latest descriptions; the review sees all

SYSTEM_INSTRUCTIONS = """\
You write audio description for a blind or low-vision viewer of an animated short film. Each
description is spoken aloud in a quiet stretch between lines of dialogue, so it must be short.
A stretch can last up to 30 seconds and cover several shots, and each sentence is spoken when its
shot begins, so you answer with a list of items, each tied to the frame it describes.

Rules:
- Each item is {at_s, text}: at_s is the time label of the contact-sheet frame the text is about,
  and text is one short sentence (about 8 to 15 words) that says only what is visible in that
  frame's shot. Never describe in an item what happens in a later shot. Use one item per shot
  that matters, in time order, with different at_s values; skip shots where nothing essential
  happens. A window with a single shot has a single item.
- Present tense, plain words.
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
- Stay within the word limit, which is shared by all the items. Fewer words are fine when little
  happens.
- If nothing essential is visible in the window, say so by setting nothing_to_describe.

You are shown a contact sheet of stills from the window, one for each cut, each labelled with
its time in seconds from the start of the film. Answer only by calling submit_description once.
If it returns an error, correct the description as the error says and call it again.
"""


class DraftItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at_s: float = Field(ge=0)
    text: str = Field(max_length=400)


class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[DraftItem] = Field(default_factory=list, max_length=MAX_ITEMS)
    nothing_to_describe: bool = False


SUBMIT_SCHEMA = {
    "json": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "description": "Items in time order, one per shot that matters.",
                "items": {
                    "type": "object",
                    "properties": {
                        "at_s": {
                            "type": "number",
                            "description": "Time label (seconds) of the contact-sheet frame "
                            "the text describes.",
                        },
                        "text": {
                            "type": "string",
                            "description": "One short plain sentence for that shot.",
                        },
                    },
                    "required": ["at_s", "text"],
                },
            },
            "nothing_to_describe": {
                "type": "boolean",
                "description": "True when nothing essential is visible in the window.",
            },
        },
    }
}


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
        f"Word limit: at most {request.budget} words in all, shared by the items.",
        "Frame labels on the contact sheet (use these as at_s): "
        + ", ".join(_time(t) for t in request.times)
        + ".",
    ]
    if request.plot:
        parts.append(
            "Story background, only for recognising characters and places and keeping their "
            "names consistent. Never describe anything that is not visible in this window, and "
            f"never say what has not happened yet:\n{request.plot}"
        )
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
    parts.append("The contact sheet follows. Call submit_description with your items.")
    return "\n\n".join(parts)


class NovaWriter:
    def __init__(self, choice: str = "nova-pro"):
        self.name = model.model_id(choice)
        self.usage = Usage()
        self._model = model.bedrock_model(choice, max_tokens=700, temperature=0.3)

    def write(self, request: Request) -> list[Item] | None:
        content = [
            {"text": request_text(request)},
            {"image": {"format": "jpeg", "source": {"bytes": request.picture}}},
        ]
        return self._ask(content, request.budget, request.check, "write", request.note)

    def shorten(
        self, request: Request, text: str, target_words: int, start_s: float, slot_s: float
    ) -> str:
        message = (
            f"The description below is spoken from {_time(start_s)} s and has {slot_s:.1f} s, "
            "and it is too long for that.\n\n"
            f'Description: "{text}"\n\n'
            f"Rewrite it in at most {target_words} words. Keep the most essential things, in the "
            "same order, in the same style. Call submit_description with one item whose at_s is "
            f"{_time(start_s)} and whose text is the shorter version."
        )
        shorter = self._ask(
            [{"text": message}], target_words, request.check, "shorten", request.note
        )
        if not shorter:
            raise Rejected("the model dropped a description it was asked to shorten")
        return " ".join(item.text for item in shorter)

    def _ask(
        self, content: list, limit: int, check: Check, step: str, note: Callable[[str], None]
    ) -> list[Item] | None:
        answers: list[list[Item] | None] = []
        rejected: list[Verdict] = []

        @tool(inputSchema=SUBMIT_SCHEMA)
        def submit_description(
            items: list[dict] | None = None, nothing_to_describe: bool = False
        ) -> str:
            """Submit the description of the window as a list of items.

            Args:
                items: Items in time order. Each is an object {"at_s": number, "text": string}:
                    at_s is the time label of the contact-sheet frame it describes (seconds)
                    and text is one short plain sentence.
                nothing_to_describe: True when nothing essential is visible in the window.
            """
            try:
                given = Draft.model_validate(
                    {
                        "items": items or [],
                        "nothing_to_describe": nothing_to_describe,
                    }
                )
            except ValidationError as exc:
                return "error: " + "; ".join(
                    f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
                )
            if given.nothing_to_describe:
                answers.append(None)
                return "ok"
            if not given.items:
                return "error: give at least one item, or set nothing_to_describe."
            checked = [(item, check(item.text, limit, step)) for item in given.items]
            bad = [(n, v) for n, (_, v) in enumerate(checked, 1) if not v.ok]
            if bad:
                rejected.append(bad[-1][1])
                return "error: " + " ".join(f"item {n}: {v.feedback[7:]}" for n, v in bad)
            answers.append([Item(item.at_s, v.text) for item, v in checked])
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
        for retry in range(1, NO_SUBMIT_RETRIES + 1):
            if answers or rejected:
                break
            note(f"    the model did not call submit_description; reminding it ({retry}/2)")
            agent(NO_SUBMIT_REPLY)
        usage = agent.event_loop_metrics.accumulated_usage
        self.usage.input_tokens += int(usage.get("inputTokens", 0))
        self.usage.output_tokens += int(usage.get("outputTokens", 0))
        self.usage.calls += watch.calls
        if not answers:
            if rejected:
                raise gave_up(len(rejected), rejected[-1])
            raise Rejected(NO_SUBMIT_REASON)
        return answers[-1]

    @property
    def cost_usd(self) -> float:
        return model.cost_usd(self.name, self.usage.input_tokens, self.usage.output_tokens)
