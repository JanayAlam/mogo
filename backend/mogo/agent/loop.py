from __future__ import annotations

import json
import logging
import re
from types import SimpleNamespace

from mogo.agent.schemas import AgentReport
from mogo.agent.tools import TOOL_SPECS, ToolBox, parse_args

log = logging.getLogger(__name__)

TOOL_NAMES = {t["function"]["name"] for t in TOOL_SPECS}
MAX_NUDGES = 3
NUDGE = (
    "You did not call a tool. Do not answer in plain text. Either call another tool, or finish by calling "
    "submit_report with {\"summary\": ..., \"criteria\": [...], \"findings\": [...]}."
)
_JSON_BLOCK = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>|```(?:json)?\s*(.*?)```", re.S)


def _json_objects(text: str):
    """Every top-level JSON object in `text`, in order."""
    dec, i = json.JSONDecoder(), 0
    while (i := text.find("{", i)) != -1:
        try:
            obj, end = dec.raw_decode(text, i)
        except json.JSONDecodeError:
            i += 1
            continue
        yield obj
        i = end


def calls_from_text(content: str, step: int) -> list:
    """Some local models (qwen2.5-coder on Ollama) write the tool call as JSON in the reply instead of using
    tool_calls. Accept {"name": <tool>, "arguments": {...}} written plainly, in ```json``` or in <tool_call>."""
    if not content:
        return []
    blocks = [a or b for a, b in _JSON_BLOCK.findall(content)] or [content]
    calls = []
    for block in blocks:
        for obj in _json_objects(block):
            if not isinstance(obj, dict) or obj.get("name") not in TOOL_NAMES:
                continue
            args = obj.get("arguments", obj.get("parameters", {}))
            if isinstance(args, str):
                args = parse_args(args)
            calls.append(SimpleNamespace(
                id=f"text-{step}-{len(calls)}",
                function=SimpleNamespace(name=obj["name"], arguments=json.dumps(args if isinstance(args, dict) else {})),
            ))
    return calls


class AgentFailed(RuntimeError):
    pass


def run_agent(client, model: str, system: str, user: str, tools: ToolBox, max_steps: int = 25) -> AgentReport:
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    nudges = 0
    for step in range(max_steps):
        resp = client.chat.completions.create(
            model=model, messages=messages, tools=TOOL_SPECS, temperature=0.2,
        )
        msg = resp.choices[0].message
        calls = msg.tool_calls or calls_from_text(msg.content or "", step)
        entry = {"role": "assistant", "content": msg.content or ""}
        if calls:
            entry["tool_calls"] = [
                {"id": c.id, "type": "function",
                 "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in calls
            ]
        messages.append(entry)

        if not calls:
            if nudges >= MAX_NUDGES:
                raise AgentFailed(
                    f"model stopped without submitting a report (last reply: {(msg.content or '')[:300]!r})"
                )
            nudges += 1
            messages.append({"role": "user", "content": NUDGE})
            continue

        for c in calls:
            log.info("step %d tool=%s", step, c.function.name)
            result = tools.call(c.function.name, parse_args(c.function.arguments))
            messages.append({"role": "tool", "tool_call_id": c.id, "content": result})
        if tools.report:
            return tools.report
    raise AgentFailed(f"no report after {max_steps} steps")
