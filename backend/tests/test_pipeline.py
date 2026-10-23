"""Integration: sqlite (tests only), real review rendering, fake GitHub + fake LLM + fake checkout."""
import json

import httpx

from mogo.github.client import GitHubClient
from mogo.config import RepoConfig
from mogo.models import LlmConnection, Repo, Run, RunEvent
from mogo.runner.pipeline import execute_run
from conftest import FakeLLM, seed_repos, tool_call

DIFF = """diff --git a/src/svc.ts b/src/svc.ts
--- a/src/svc.ts
+++ b/src/svc.ts
@@ -1,2 +1,3 @@
 import x
+db.raw('select 1')
 export {}
"""
MAIN_SHA = "a1b2c3d4e5f6"
PR = {"title": "Add thing", "body": "", "head": {"sha": "abc", "repo": {"full_name": "acme/api"}}}


def fake_github(posted, fail_inline=False):
    def handler(req: httpx.Request):
        if req.method == "GET" and req.headers.get("accept", "").endswith(".sha"):
            return httpx.Response(200, text=MAIN_SHA)
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
    (dest / "Dockerfile").write_text("FROM scratch\n")  # Mogo only runs projects with Docker


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
    execute_run(run_id, settings, sf, gh=gh, llm_factory=lambda _c: llm, checkout=fake_checkout)


def test_full_run_posts_inline_and_general(settings, repos, sf):
    posted = []
    rid = run_id = make_run(sf)  # no feature: reviewed, not run
    run(settings, repos, sf, fake_github(posted), run_id)

    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "succeeded", r.error
        assert r.llm_used == "deepseek-flash @ api.deepseek.com" and r.review_url.endswith("#review")
        assert r.verdict == "ok" and any("review posted" in e.message for e in r.events)
    review = posted[0]
    assert review["event"] == "COMMENT" and review["commit_id"] == "abc"
    assert [c["line"] for c in review["comments"]] == [2]  # line 99 is not in the diff
    assert "off-diff line" in review["body"] and "endpoint works" in review["body"]


def test_dry_run_posts_nothing(settings, repos, sf):
    posted = []
    rid = make_run(sf, dry_run=True)
    run(settings, repos, sf, fake_github(posted), rid)
    assert posted == []
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"


def test_inline_rejection_falls_back_to_summary(settings, repos, sf):
    posted = []
    rid = make_run(sf)
    run(settings, repos, sf, fake_github(posted, fail_inline=True), rid)
    assert posted[0]["comments"] == [] and "Inline findings" in posted[0]["body"]


def test_unconfigured_repo_fails_cleanly(settings, sf):
    rid = make_run(sf)
    execute_run(rid, settings, sf, gh=fake_github([]), checkout=fake_checkout)
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "failed" and "not configured" in r.error


def test_fork_pr_is_refused(settings, repos, sf, monkeypatch):
    rid = make_run(sf)
    gh = fake_github([])
    monkeypatch.setitem(PR["head"], "repo", {"full_name": "evil/api"})
    execute_run(rid, settings, sf, gh=gh, checkout=fake_checkout)
    with sf() as s:
        assert "fork" in s.get(Run, rid).error


def test_prepare_and_stop_commands_run_around_the_app(settings, sf, tmp_path):
    from mogo.config import RepoConfig

    cfg = {"acme/api": RepoConfig(
        name="acme/api", prepare=[f"touch {tmp_path}/up"], services_down=f"touch {tmp_path}/down",
        start="python3 -m http.server 8765", healthcheck="http://localhost:8765",
    )}
    seed_repos(sf, cfg)
    rid = make_run(sf, feature="thing works")
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=fake_checkout)
    assert (tmp_path / "up").exists() and (tmp_path / "down").exists()
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"


def test_long_convention_files_are_not_cut_at_6000_chars(tmp_path):
    from mogo.runner.pipeline import _read_conventions

    (tmp_path / "CLAUDE.md").write_text("x" * 9000 + "END")
    assert _read_conventions(tmp_path, ["CLAUDE.md", "missing.md"]).endswith("END")


def test_conventions_unset_reads_the_known_files_found(tmp_path):
    from mogo.config import RepoConfig
    from mogo.runner.pipeline import _read_conventions

    (tmp_path / "AGENTS.md").write_text("agents rules")
    (tmp_path / "CLAUDE.md").write_text("claude rules")
    (tmp_path / "notes.md").write_text("not a known name")
    cfg = RepoConfig(name="acme/api")
    assert cfg.conventions is None
    text = _read_conventions(tmp_path, cfg.conventions)
    assert text.index("### CLAUDE.md") < text.index("### AGENTS.md") and "notes.md" not in text


def test_conventions_set_are_read_exactly(tmp_path):
    from mogo.runner.pipeline import _read_conventions

    (tmp_path / "CLAUDE.md").write_text("claude rules")
    (tmp_path / "notes.md").write_text("our notes")
    text = _read_conventions(tmp_path, ["notes.md"])
    assert "our notes" in text and "claude rules" not in text


def test_an_empty_conventions_list_reads_nothing(tmp_path):
    from mogo.runner.pipeline import _read_conventions

    (tmp_path / "CLAUDE.md").write_text("claude rules")
    assert _read_conventions(tmp_path, []) == ""


def test_conventions_outside_the_checkout_are_not_read(tmp_path):
    from mogo.runner.pipeline import _read_conventions

    (tmp_path / "secret.md").write_text("outside")
    root = tmp_path / "repo"
    root.mkdir()
    assert _read_conventions(root, ["../secret.md", str(tmp_path / "secret.md")]) == ""


def _boot_cfg(tmp_path, **kw):
    from mogo.config import RepoConfig

    return {"acme/api": RepoConfig(
        name="acme/api", start="python3 -m http.server 8766", healthcheck="http://localhost:8766", **kw,
    )}


def _run_feature(settings, cfg, sf, llm, env=None):
    seed_repos(sf, cfg, env=env)
    rid = make_run(sf, feature="thing works")
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=fake_checkout)
    return rid


def test_prepare_runs_before_start_and_notes_reach_the_agent(settings, sf, tmp_path):
    cfg = _boot_cfg(
        tmp_path,
        prepare=[f'echo "$APP_MODE" > {tmp_path}/prepared'],
        notes="ACCOUNT-NOTE: log in as traveler@seed.test",
    )
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    rid = _run_feature(settings, cfg, sf, llm, env={"acme/api": {"APP_MODE": "test"}})
    assert (tmp_path / "prepared").read_text().strip() == "test"
    assert "ACCOUNT-NOTE: log in as traveler@seed.test" in llm.first_user_prompt
    assert "running at http://localhost:8766 (it answered)" in llm.first_user_prompt
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"


def test_failed_prepare_skips_start_and_tells_the_agent(settings, sf, tmp_path):
    cfg = _boot_cfg(tmp_path, prepare=["echo seeding-broke >&2; exit 3", f"touch {tmp_path}/not-reached"])
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    _run_feature(settings, cfg, sf, llm)
    assert not (tmp_path / "not-reached").exists()
    assert "NOT started: prepare step" in llm.first_user_prompt and "seeding-broke" in llm.first_user_prompt


def test_ready_url_defaults_to_the_repo_port(settings, sf, tmp_path):
    from mogo.config import RepoConfig
    cfg = {"acme/api": RepoConfig(name="acme/api", start="python3 -m http.server 8767")}  # no ready URL set
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    _run_feature(settings, cfg, sf, llm, env={"acme/api": {"PORT": "8767"}})
    assert "running at http://localhost:8767 (it answered)" in llm.first_user_prompt


def test_token_is_minted_for_the_repos_installation(settings, sf, fake_app_token):
    ids = seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    with sf() as s:
        s.get(Repo, ids["acme/api"]).installation_id = 77
        s.commit()
    run(settings, None, sf, fake_github([]), make_run(sf))
    assert fake_app_token == [("acme", "api", 77)]


def test_owner_without_llm_fails_before_touching_github(settings, sf, fake_app_token):
    from conftest import seed_user
    seed_user(sf, llm=False)
    seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    rid = make_run(sf)
    execute_run(rid, settings, sf, gh=fake_github([]), checkout=fake_checkout)
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "failed" and "no LLM switched on" in r.error
    assert fake_app_token == []


# --- the owner's LLMs are tried in order; a failing one hands over to the next

def add_connections(sf, *specs):
    """Replace the seeded LLM with these (provider, model, base_url) connections, in this order, all switched on."""
    from conftest import seed_user
    uid = seed_user(sf, llm=False)
    with sf() as s:
        s.query(LlmConnection).delete()
        for i, (provider, model, url) in enumerate(specs, 1):
            s.add(LlmConnection(user_id=uid, provider=provider, name=provider, active=True, position=i,
                                base_url=url, model=model))
        s.commit()


def by_model(models):
    """llm_factory: the client scripted for the model of each connection (also records the order they are asked)."""
    asked = []

    def factory(choice):
        asked.append(choice.model)
        return models[choice.model]
    return factory, asked


class Down:
    """A client whose API is unreachable."""
    def __init__(self):
        import openai
        err = openai.APIConnectionError(request=httpx.Request("POST", "https://down.example/v1/chat/completions"))

        def boom(**_kw):
            raise err
        from types import SimpleNamespace
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=boom))


SUBMIT = [[tool_call("submit_report", {"summary": "ok"})]]


def test_a_failing_llm_falls_back_to_the_next(settings, sf, fake_app_token):
    add_connections(sf, ("custom", "local-model", "https://a.trycloudflare.com/v1"),
                    ("openai", "gpt-4.1", "https://api.openai.com/v1"))
    seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    factory, asked = by_model({"local-model": Down(), "gpt-4.1": FakeLLM(SUBMIT)})
    rid = make_run(sf)
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=factory, checkout=fake_checkout)
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "succeeded", r.error
        assert r.llm_used == "gpt-4.1 @ api.openai.com"  # the one that did the review
        log = [e.message for e in s.query(RunEvent).filter_by(run_id=rid)]
    assert asked == ["local-model", "gpt-4.1"]
    assert any("local-model" in m and "failed" in m and "trying the next one" in m for m in log)


def test_a_model_that_never_reports_falls_back_too(settings, sf, fake_app_token):
    add_connections(sf, ("deepseek", "weak", "https://api.deepseek.com"), ("openai", "gpt-4.1", "https://api.openai.com/v1"))
    seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    factory, asked = by_model({"weak": FakeLLM([]), "gpt-4.1": FakeLLM(SUBMIT)})  # empty replies: AgentFailed
    rid = make_run(sf)
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=factory, checkout=fake_checkout)
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"
    assert asked == ["weak", "gpt-4.1"]


def test_the_first_llm_that_works_ends_the_chain(settings, sf, fake_app_token):
    add_connections(sf, ("openai", "gpt-4.1", "https://api.openai.com/v1"), ("deepseek", "spare", "https://api.deepseek.com"))
    seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    factory, asked = by_model({"gpt-4.1": FakeLLM(SUBMIT), "spare": Down()})
    rid = make_run(sf)
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=factory, checkout=fake_checkout)
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"
    assert asked == ["gpt-4.1"]


def test_when_every_llm_fails_the_run_fails_with_each_reason(settings, sf, fake_app_token):
    add_connections(sf, ("custom", "local-model", "https://a.trycloudflare.com/v1"),
                    ("openai", "gpt-4.1", "https://api.openai.com/v1"))
    seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    factory, asked = by_model({"local-model": Down(), "gpt-4.1": FakeLLM([])})
    rid = make_run(sf)
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=factory, checkout=fake_checkout)
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "failed"
        assert "every LLM failed" in r.error and "local-model" in r.error and "gpt-4.1" in r.error
    assert asked == ["local-model", "gpt-4.1"]


def test_an_error_outside_the_llm_does_not_fall_back(settings, sf, fake_app_token):
    add_connections(sf, ("openai", "gpt-4.1", "https://api.openai.com/v1"), ("deepseek", "spare", "https://api.deepseek.com"))
    seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    asked = []

    def factory(choice):
        asked.append(choice.model)
        raise RuntimeError("bug in our code")
    rid = make_run(sf)
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=factory, checkout=fake_checkout)
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "failed" and "bug in our code" in r.error
    assert asked == ["gpt-4.1"]  # the second was never tried


# --- Docker: the Dockerfile is required, the repo's variables are forwarded, the stop command always runs

def _checkout_with_dockerfile(owner, repo, number, token, dest):
    fake_checkout(owner, repo, number, token, dest)
    (dest / "Dockerfile").write_text("FROM scratch\nEXPOSE 8769\n")


def _no_dockerfile(owner, repo, number, token, dest):
    fake_checkout(owner, repo, number, token, dest)
    (dest / "Dockerfile").unlink()


def test_a_project_without_docker_files_fails_the_run_and_says_so(settings, sf, tmp_path):
    cfg = {"acme/api": RepoConfig(name="acme/api", start=f"touch {tmp_path}/started")}
    seed_repos(sf, cfg)
    rid = make_run(sf, feature="thing works")
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    posted = []
    execute_run(rid, settings, sf, gh=fake_github(posted), llm_factory=lambda _c: llm, checkout=_no_dockerfile)
    assert not (tmp_path / "started").exists() and posted == []  # no app, no fallback review
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "failed"
        assert r.error.startswith("This project needs Docker to be run, but there is no Dockerfile at its root.")
        assert "Docker Compose file" in r.error


def test_a_repo_not_set_up_for_docker_fails_a_feature_run(settings, repos, sf):
    rid = make_run(sf, feature="thing works")
    run(settings, repos, sf, fake_github([]), rid)
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "failed" and "needs Docker" in r.error and "repo's settings" in r.error


def test_a_review_without_a_feature_does_not_need_docker(settings, repos, sf):
    rid = make_run(sf)
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=_no_dockerfile)
    assert "not started (review only)" in llm.first_user_prompt
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"


def test_docker_with_a_dockerfile_starts_and_gets_the_variable_names(settings, sf, tmp_path):
    from mogo.config import RepoConfig
    cfg = {"acme/api": RepoConfig(
        name="acme/api", healthcheck="http://localhost:8769",
        start=f'echo "$MOGO_DOCKER_ENV" > {tmp_path}/flags; python3 -m http.server 8769',
    )}
    seed_repos(sf, cfg, env={"acme/api": {"APP_MODE": "test", "ZED": "1", "bad name; touch x": "no"}})
    rid = make_run(sf, feature="thing works")
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=_checkout_with_dockerfile)
    # names only (values are passed through the environment), sorted, and a malformed name never reaches a shell
    assert (tmp_path / "flags").read_text().strip() == "-e APP_MODE -e ZED"
    assert "running at http://localhost:8769 (it answered)" in llm.first_user_prompt


def test_the_stop_command_runs_after_the_app_started(settings, sf, tmp_path):
    from mogo.config import RepoConfig
    # how the web form saves a repo: the commands that start and stop it
    cfg = {"acme/api": RepoConfig(
        name="acme/api", start="python3 -m http.server 8770", healthcheck="http://localhost:8770",
        services_down=f"touch {tmp_path}/stopped",
    )}
    seed_repos(sf, cfg)
    execute_run(make_run(sf, feature="thing works"), settings, sf, gh=fake_github([]),
                llm_factory=lambda _c: FakeLLM([[tool_call("submit_report", {"summary": "ok"})]]),
                checkout=fake_checkout)
    assert (tmp_path / "stopped").exists()


def test_the_stop_command_does_not_run_when_the_app_was_never_started(settings, sf, tmp_path):
    from mogo.config import RepoConfig
    cfg = {"acme/api": RepoConfig(name="acme/api", start="true", services_down=f"touch {tmp_path}/stopped")}
    seed_repos(sf, cfg)
    execute_run(make_run(sf), settings, sf, gh=fake_github([]),  # no feature: review only
                llm_factory=lambda _c: FakeLLM([[tool_call("submit_report", {"summary": "ok"})]]),
                checkout=fake_checkout)
    assert not (tmp_path / "stopped").exists()


def test_docker_with_its_own_file_name_is_found_by_that_name(settings, sf, tmp_path):
    from mogo.config import RepoConfig

    def checkout(owner, repo, number, token, dest):
        fake_checkout(owner, repo, number, token, dest)
        (dest / "Dockerfile.dev").write_text("FROM scratch\n")  # no plain Dockerfile

    cfg = {"acme/api": RepoConfig(name="acme/api", docker_file="Dockerfile.dev",
                                  start="python3 -m http.server 8772", healthcheck="http://localhost:8772")}
    seed_repos(sf, cfg)
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    execute_run(make_run(sf, feature="thing works"), settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm,
                checkout=checkout)
    assert "NOT started" not in llm.first_user_prompt
    assert "running at http://localhost:8772 (it answered)" in llm.first_user_prompt


def test_docker_without_the_named_file_says_which_file(settings, sf, tmp_path):
    cfg = {"acme/api": RepoConfig(name="acme/api", docker_mode="compose", docker_file="stack.yml",
                                  start=f"touch {tmp_path}/started")}
    seed_repos(sf, cfg)
    rid = make_run(sf, feature="thing works")
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=lambda _c: FakeLLM([]), checkout=fake_checkout)
    assert not (tmp_path / "started").exists()
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "failed" and "there is no stack.yml at its root" in r.error


def test_the_stop_command_runs_inside_the_repo(settings, sf, tmp_path):
    from mogo.config import RepoConfig
    # a compose file named with a relative path (`-f docker-compose.prod.yaml`) is only found from the repo's folder:
    # CONVENTIONS.md is a file of the checkout
    cfg = {"acme/api": RepoConfig(
        name="acme/api", start="python3 -m http.server 8774", healthcheck="http://localhost:8774",
        services_down=f"test -f CONVENTIONS.md && touch {tmp_path}/ran-in-the-repo",
    )}
    seed_repos(sf, cfg)
    execute_run(make_run(sf, feature="thing works"), settings, sf, gh=fake_github([]),
                llm_factory=lambda _c: FakeLLM([[tool_call("submit_report", {"summary": "ok"})]]),
                checkout=fake_checkout)
    assert (tmp_path / "ran-in-the-repo").exists()
