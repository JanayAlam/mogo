import pytest

from mogo.agent.loop import AgentFailed, run_agent
from mogo.agent.tools import ToolBox
from conftest import FakeLLM, tool_call


def test_reads_then_reports(tmp_path):
    (tmp_path / "a.ts").write_text("x")
    llm = FakeLLM([[tool_call("read_file", {"path": "a.ts"})], [tool_call("submit_report", {"summary": "done"}, "c2")]])
    report = run_agent(llm, "m", "sys", "user", ToolBox(tmp_path))
    assert report.summary == "done" and llm.calls == 2


def test_nudges_then_fails(tmp_path):
    llm = FakeLLM([[], [], [], "I think the PR looks fine."])
    with pytest.raises(AgentFailed, match="without submitting.*looks fine"):
        run_agent(llm, "m", "s", "u", ToolBox(tmp_path))
    assert llm.calls == 4  # first reply + MAX_NUDGES (3) nudged retries


def test_a_nudge_can_recover(tmp_path):
    llm = FakeLLM([[], [tool_call("submit_report", {"summary": "ok"})]])
    assert run_agent(llm, "m", "s", "u", ToolBox(tmp_path)).summary == "ok"


@pytest.mark.parametrize("text", [
    '{"name": "submit_report", "arguments": {"summary": "plain"}}',
    'Here is my report:\n```json\n{"name": "submit_report", "arguments": {"summary": "plain"}}\n```',
    '<tool_call>\n{"name": "submit_report", "arguments": "{\\"summary\\": \\"plain\\"}"}\n</tool_call>',
])
def test_tool_calls_written_as_text_are_executed(tmp_path, text):
    report = run_agent(FakeLLM([text]), "m", "s", "u", ToolBox(tmp_path))
    assert report.summary == "plain"


def test_text_that_merely_contains_json_is_not_a_tool_call(tmp_path):
    from mogo.agent.loop import calls_from_text
    assert calls_from_text('The API returns {"name": "Alice", "arguments": []}', 0) == []
    assert calls_from_text("no json here", 0) == []


def test_step_limit(tmp_path):
    llm = FakeLLM([[tool_call("search", {"pattern": "x"})]] * 5)
    with pytest.raises(AgentFailed, match="no report after 3"):
        run_agent(llm, "m", "s", "u", ToolBox(tmp_path), max_steps=3)
