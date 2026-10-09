import pytest

from mogo.agent.loop import AgentFailed, run_agent
from mogo.agent.tools import ToolBox
from conftest import FakeLLM, tool_call


def test_reads_then_reports(tmp_path):
    (tmp_path / "a.ts").write_text("x")
    llm = FakeLLM([[tool_call("read_file", {"path": "a.ts"})], [tool_call("submit_report", {"summary": "done"}, "c2")]])
    report = run_agent(llm, "m", "sys", "user", ToolBox(tmp_path))
    assert report.summary == "done" and llm.calls == 2


def test_nudges_once_then_fails(tmp_path):
    llm = FakeLLM([[], []])
    with pytest.raises(AgentFailed, match="without submitting"):
        run_agent(llm, "m", "s", "u", ToolBox(tmp_path))
    assert llm.calls == 2


def test_step_limit(tmp_path):
    llm = FakeLLM([[tool_call("search", {"pattern": "x"})]] * 5)
    with pytest.raises(AgentFailed, match="no report after 3"):
        run_agent(llm, "m", "s", "u", ToolBox(tmp_path), max_steps=3)
