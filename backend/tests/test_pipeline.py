"""Integration: sqlite (tests only), real review rendering, fake GitHub + fake LLM + fake checkout."""
import json

import httpx

from mogo.github.client import GitHubClient
from mogo.models import Run
from mogo.runner.pipeline import execute_run
from conftest import FakeLLM, tool_call

DIFF = """diff --git a/src/svc.ts b/src/svc.ts
--- a/src/svc.ts
+++ b/src/svc.ts
@@ -1,2 +1,3 @@
 import x
+db.raw('select 1')
 export {}
"""
PR = {"title": "Add thing", "body": "", "head": {"sha": "abc", "repo": {"full_name": "acme/api"}}}


def fake_github(posted, fail_inline=False):
    def handler(req: httpx.Request):
        if req.method == "GET" and "diff" in req.headers.get("accept", ""):
            return httpx.Response(200, text=DIFF)
        if req.method == "GET":
            return httpx.Response(200, json=PR)
        body = json.loads(req.content)
        if fail_inline and body["comments"]:
            return httpx.Response(422, text="line outside diff")
        posted.append(body)
        return httpx.Response(200, json={"html_url": "https://github.com/acme/api/pull/1#review"})
    return GitHubClient("t", transport=httpx.MockTransport(handler))


def fake_checkout(owner, repo, number, token, dest):
    dest.mkdir(parents=True)
    (dest / "CONVENTIONS.md").write_text("Use services.")
    (dest / "src").mkdir()
    (dest / "src/svc.ts").write_text("import x\ndb.raw('select 1')\nexport {}\n")


def make_run(sf, **kw):
    with sf() as s:
        r = Run(repo="acme/api", pr_url="https://github.com/acme/api/pull/1", pr_number=1, **kw)
        s.add(r)
        s.commit()
        return r.id


REPORT = {
    "summary": "Raw SQL in service.",
    "criteria": [{"text": "endpoint works", "status": "pass", "evidence": "200"}],
    "findings": [
        {"path": "src/svc.ts", "line": 2, "severity": "major", "message": "raw SQL", "rule": "no raw SQL"},
        {"path": "src/svc.ts", "line": 99, "severity": "nit", "message": "off-diff line"},
    ],
}


def run(settings, repos, sf, gh, run_id):
    llm = FakeLLM([[tool_call("read_file", {"path": "src/svc.ts"})], [tool_call("submit_report", REPORT, "c2")]])
    settings.llm_mode = "deepseek"
    execute_run(run_id, settings, repos, sf, gh=gh, llm_factory=lambda _c: llm, checkout=fake_checkout)


def test_full_run_posts_inline_and_general(settings, repos, sf):
    posted = []
    rid = run_id = make_run(sf, feature="thing works", llm_mode="deepseek")
    run(settings, repos, sf, fake_github(posted), run_id)

    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "succeeded", r.error
        assert r.llm_used == "deepseek:deepseek-chat" and r.review_url.endswith("#review")
        assert r.verdict == "ok" and any("review posted" in e.message for e in r.events)
    review = posted[0]
    assert review["event"] == "COMMENT" and review["commit_id"] == "abc"
    assert [c["line"] for c in review["comments"]] == [2]  # line 99 is not in the diff
    assert "off-diff line" in review["body"] and "endpoint works" in review["body"]


def test_dry_run_posts_nothing(settings, repos, sf):
    posted = []
    rid = make_run(sf, dry_run=True, llm_mode="deepseek")
    run(settings, repos, sf, fake_github(posted), rid)
    assert posted == []
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"


def test_inline_rejection_falls_back_to_summary(settings, repos, sf):
    posted = []
    rid = make_run(sf, llm_mode="deepseek")
    run(settings, repos, sf, fake_github(posted, fail_inline=True), rid)
    assert posted[0]["comments"] == [] and "Inline findings" in posted[0]["body"]


def test_unconfigured_repo_fails_cleanly(settings, sf):
    rid = make_run(sf, llm_mode="deepseek")
    execute_run(rid, settings, {}, sf, gh=fake_github([]), checkout=fake_checkout)
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "failed" and "not configured" in r.error


def test_fork_pr_is_refused(settings, repos, sf, monkeypatch):
    rid = make_run(sf, llm_mode="deepseek")
    gh = fake_github([])
    monkeypatch.setitem(PR["head"], "repo", {"full_name": "evil/api"})
    execute_run(rid, settings, repos, sf, gh=gh, checkout=fake_checkout)
    with sf() as s:
        assert "fork" in s.get(Run, rid).error


def test_services_are_started_and_stopped_around_the_run(settings, sf, tmp_path):
    from mogo.config import RepoConfig

    cfg = {"acme/api": RepoConfig(
        name="acme/api", services_cmd=f"touch {tmp_path}/up", services_down=f"touch {tmp_path}/down",
        start="python3 -m http.server 8765", healthcheck="http://localhost:8765",
    )}
    rid = make_run(sf, feature="thing works", llm_mode="deepseek")
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    settings.llm_mode = "deepseek"
    execute_run(rid, settings, cfg, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=fake_checkout)
    assert (tmp_path / "up").exists() and (tmp_path / "down").exists()
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"


def test_long_convention_files_are_not_cut_at_6000_chars(tmp_path):
    from mogo.runner.pipeline import _read_conventions

    (tmp_path / "CLAUDE.md").write_text("x" * 9000 + "END")
    assert _read_conventions(tmp_path, ["CLAUDE.md", "missing.md"]).endswith("END")


def _boot_cfg(tmp_path, **kw):
    from mogo.config import RepoConfig

    return {"acme/api": RepoConfig(
        name="acme/api", start="python3 -m http.server 8766", healthcheck="http://localhost:8766", **kw,
    )}


def _run_feature(settings, cfg, sf, llm):
    rid = make_run(sf, feature="thing works", llm_mode="deepseek")
    settings.llm_mode = "deepseek"
    execute_run(rid, settings, cfg, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=fake_checkout)
    return rid


def test_prepare_runs_before_start_with_seeds_dir_and_notes_reach_the_agent(settings, sf, tmp_path):
    cfg = _boot_cfg(
        tmp_path,
        prepare=[f'test -d "$MOGO_SEEDS_DIR" && echo "$APP_MODE" > {tmp_path}/prepared'],
        env={"APP_MODE": "test"},
        notes="ACCOUNT-NOTE: log in as traveler@seed.test",
    )
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    rid = _run_feature(settings, cfg, sf, llm)
    assert (tmp_path / "prepared").read_text().strip() == "test"
    assert "ACCOUNT-NOTE: log in as traveler@seed.test" in llm.first_user_prompt
    assert "health check http://localhost:8766 OK" in llm.first_user_prompt
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"


def test_failed_prepare_skips_start_and_tells_the_agent(settings, sf, tmp_path):
    cfg = _boot_cfg(tmp_path, prepare=["echo seeding-broke >&2; exit 3", f"touch {tmp_path}/not-reached"])
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    _run_feature(settings, cfg, sf, llm)
    assert not (tmp_path / "not-reached").exists()
    assert "NOT started: prepare step" in llm.first_user_prompt and "seeding-broke" in llm.first_user_prompt
