from __future__ import annotations

import logging

from mogo.agent.schemas import AgentReport
from mogo.agent.tools import TOOL_SPECS, ToolBox, parse_args

log = logging.getLogger(__name__)


class AgentFailed(RuntimeError):
    pass


def run_agent(client, model: str, system: str, user: str, tools: ToolBox, max_steps: int = 25) -> AgentReport:
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    nudged = False
    for step in range(max_steps):
        resp = client.chat.completions.create(
            model=model, messages=messages, tools=TOOL_SPECS, temperature=0.2,
        )
        msg = resp.choices[0].message
        calls = msg.tool_calls or []
        entry = {"role": "assistant", "content": msg.content or ""}
        if calls:
            entry["tool_calls"] = [
                {"id": c.id, "type": "function",
                 "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in calls
            ]
        messages.append(entry)

        if not calls:
            if nudged:
                raise AgentFailed("model stopped without submitting a report")
            nudged = True
            messages.append({"role": "user", "content": "Call submit_report now with your final results."})
            continue

        for c in calls:
            log.info("step %d tool=%s", step, c.function.name)
            result = tools.call(c.function.name, parse_args(c.function.arguments))
            messages.append({"role": "tool", "tool_call_id": c.id, "content": result})
        if tools.report:
            return tools.report
    raise AgentFailed(f"no report after {max_steps} steps")
