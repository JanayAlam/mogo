import os

from mogo.agent.tools import ToolBox


def test_read_file_is_confined(tmp_path):
    (tmp_path / "a.ts").write_text("one\ntwo\nthree\n")
    tb = ToolBox(tmp_path)
    assert tb.call("read_file", {"path": "a.ts", "start": 2, "end": 3}) == "2: two\n3: three"
    assert "escapes" in tb.call("read_file", {"path": "../../etc/passwd"})


def test_shell_env_is_scrubbed(tmp_path, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "secret")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "secret")
    out = ToolBox(tmp_path, env={"APP_MODE": "test"}).call("run_shell", {"command": "env"})
    assert "secret" not in out and "APP_MODE=test" in out and "exit=0" in out


def test_http_only_localhost(tmp_path):
    assert "only localhost" in ToolBox(tmp_path).call("http_request", {"method": "GET", "url": "http://evil.com/x"})


def test_search_and_unknown_tool(tmp_path):
    (tmp_path / "a.ts").write_text("const x = db.query('SELECT 1')\n")
    tb = ToolBox(tmp_path)
    assert "a.ts:1" in tb.call("search", {"pattern": "db\\.query"})
    assert tb.call("nope", {}).startswith("error")


def test_submit_report_validates(tmp_path):
    tb = ToolBox(tmp_path)
    assert tb.call("submit_report", {"summary": "s", "findings": [{"path": "a", "line": 0, "severity": "nit", "message": "m"}]}).startswith("error")
    assert tb.report is None
    assert tb.call("submit_report", {"summary": "s"}) == "report accepted" and tb.report.summary == "s"
