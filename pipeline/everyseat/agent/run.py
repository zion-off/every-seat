"""Running the scene agent over one detection, with a cap on model calls and a repair loop."""

import re
import time
from collections.abc import Callable
from dataclasses import dataclass

from strands import Agent
from strands.agent.conversation_manager import NullConversationManager
from strands.hooks import BeforeModelCallEvent, BeforeToolCallEvent, HookProvider, HookRegistry

from everyseat.agent import checks, model
from everyseat.agent.instructions import SYSTEM_INSTRUCTIONS, task_message
from everyseat.agent.session import Session
from everyseat.agent.tools import build_tools

MAX_MODEL_CALLS = 60
REPAIR_ROUNDS = 2
_THINKING = re.compile(r"<thinking>.*?</thinking>", re.DOTALL)
SEEN_IMAGES_NOTE = "(the frames and loudness plot were removed after you reviewed them)"


@dataclass
class AgentRun:
    model_id: str
    input_tokens: int
    output_tokens: int
    model_calls: int
    repair_rounds: int
    final_message: str
    leftover: list[str]  # problems still open after the repair rounds
    elapsed_s: float

    @property
    def cost_usd(self) -> float:
        return model.cost_usd(self.model_id, self.input_tokens, self.output_tokens)


def _drop_seen_images(messages: list) -> None:
    """Replace frames the model has already answered with a note, so each is paid for once.

    Only the newest message (the tool results awaiting an answer) keeps its images.
    """
    for message in messages[:-1]:
        for block in message.get("content", []):
            result = block.get("toolResult")
            if not result or not any("image" in item for item in result["content"]):
                continue
            kept = [item for item in result["content"] if "image" not in item]
            result["content"] = [*kept, {"text": SEEN_IMAGES_NOTE}]


class _Watch(HookProvider):
    """Counts model calls, stops runaway loops, and reports each tool call."""

    def __init__(self, limit: int, progress: Callable[[str], None] | None):
        self.limit = limit
        self.calls = 0
        self.progress = progress

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeModelCallEvent, self._before_model)
        registry.add_callback(BeforeToolCallEvent, self._before_tool)

    def _before_model(self, event: BeforeModelCallEvent) -> None:
        self.calls += 1
        if self.calls > self.limit:
            event.cancel = f"stopped after {self.limit} model calls"
            return
        _drop_seen_images(event.agent.messages)

    def _before_tool(self, event: BeforeToolCallEvent) -> None:
        if self.progress:
            args = ", ".join(f"{k}={v!r}" for k, v in event.tool_use.get("input", {}).items())
            self.progress(f"  {event.tool_use['name']}({args[:140]})")


def run_agent(
    session: Session,
    choice: str,
    *,
    max_model_calls: int = MAX_MODEL_CALLS,
    repair_rounds: int = REPAIR_ROUNDS,
    progress: Callable[[str], None] | None = None,
) -> AgentRun:
    started = time.monotonic()
    watch = _Watch(max_model_calls, progress)
    agent = Agent(
        model=model.bedrock_model(choice),
        tools=build_tools(session),
        system_prompt=SYSTEM_INSTRUCTIONS,
        callback_handler=None,
        # The candidate list is in the first message and must stay in view.
        conversation_manager=NullConversationManager(),
        hooks=[watch],
    )
    result = agent(task_message(session.detection, session.max_inspections))
    rounds = 0
    leftover = checks.problems(session)
    while leftover and rounds < repair_rounds and watch.calls <= max_model_calls:
        rounds += 1
        if progress:
            progress(f"repair round {rounds}: {len(leftover)} problem(s)")
        result = agent(
            "The recorded cues still have problems. Fix them with the tools, then validate:\n"
            + "\n".join(f"- {line}" for line in leftover)
        )
        leftover = checks.problems(session)

    usage = agent.event_loop_metrics.accumulated_usage
    return AgentRun(
        model_id=model.model_id(choice),
        input_tokens=int(usage.get("inputTokens", 0)),
        output_tokens=int(usage.get("outputTokens", 0)),
        model_calls=watch.calls,
        repair_rounds=rounds,
        final_message=_THINKING.sub("", str(result)).strip(),
        leftover=leftover,
        elapsed_s=round(time.monotonic() - started, 1),
    )
