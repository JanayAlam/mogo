"""Feature runs: project, role, requirements and sibling PRs reach the agent; repo settings come from the DB."""
import pytest

from mogo.config import RepoConfig
from mogo.context import ContextError, load_context
from mogo.models import Feature, FeatureRepo, Project, Repo, Run
from mogo.runner.pipeline import execute_run
from mogo.tools.import_repos import import_repos
from conftest import FakeLLM, seed_repos, seed_user, tool_call
from test_pipeline import fake_checkout, fake_github

API = "https://github.com/acme/api/pull/1"
WEB = "https://github.com/acme/web/pull/7"


def make_feature(sf, ids, api_url=API):
    with sf() as s:
        f = Feature(project_id=s.get(Repo, ids["acme/api"]).project_id, title="Refunds", description="Users can refund an order.")
        s.add(f)
        s.flush()
        api = FeatureRepo(feature_id=f.id, repo_id=ids["acme/api"], pr_url=api_url, pr_number=1,
                          requirements="POST /refunds is idempotent")
        web = FeatureRepo(feature_id=f.id, repo_id=ids["acme/web"], pr_url=WEB, pr_number=7,
                          requirements="Refund button on order page")
        s.add_all([api, web])
        s.flush()
        run = Run(feature_repo_id=api.id, repo="acme/api", pr_url=api_url, pr_number=1)
        s.add(run)
        s.commit()
        return run.id


@pytest.fixture
def two_repos(sf):
    return seed_repos(sf, {
        "acme/api": RepoConfig(name="acme/api", conventions=["CONVENTIONS.md"]),
        "acme/web": RepoConfig(name="acme/web"),
    }, roles={"acme/api": "backend", "acme/web": "admin-frontend"})


def test_feature_context_has_requirements_and_siblings(sf, two_repos):
    ctx = load_context(sf, make_feature(sf, two_repos))
    assert (ctx.role, ctx.feature_title, ctx.requirements) == ("backend", "Refunds", "POST /refunds is idempotent")
    assert ctx.feature == "Users can refund an order." and ctx.project_name == "Acme"
    assert [(s.full_name, s.role) for s in ctx.siblings] == [("acme/web", "admin-frontend")]


def test_feature_details_reach_the_agent(settings, sf, two_repos):
    rid = make_feature(sf, two_repos)
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=fake_checkout)
    p = llm.first_user_prompt
    assert "This repo: acme/api (role: backend)" in p and "Description: Acme shop" in p
    assert "Users can refund an order." in p and "POST /refunds is idempotent" in p
    assert "acme/web (role: admin-frontend): " + WEB in p and "Refund button on order page" in p
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"


def test_pr_from_another_repo_is_refused(settings, sf, two_repos):
    rid = make_feature(sf, two_repos, api_url="https://github.com/acme/other/pull/1")
    execute_run(rid, settings, sf, gh=fake_github([]), checkout=fake_checkout)
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "failed" and "acme/other" in r.error


def test_invalid_stored_settings_are_reported(sf):
    with sf() as s:
        p = Project(owner_id=seed_user(sf), name="X")
        s.add(p)
        s.flush()
        s.add(Repo(project_id=p.id, full_name="acme/api", config={"gates": "pnpm lint"}))  # must be a list
        s.add(Run(id="r1", repo="acme/api", pr_url=API, pr_number=1))
        s.commit()
    with pytest.raises(ContextError, match="invalid"):
        load_context(sf, "r1")


def test_import_reports_env_from_instead_of_storing_it(sf, tmp_path):
    f = tmp_path / "repos.yaml"
    f.write_text("repos:\n  - name: acme/api\n    env_from: {DATABASE_URL: ACME_DB, SMTP: SMTP}\n")
    warnings = []
    seed_user(sf)
    import_repos(sf, f, "Acme", "alice", warn=warnings.append)
    with sf() as s:
        assert "env_from" not in s.query(Repo).one().config
    assert warnings == ["acme/api: env_from is not imported; add under Secrets on the repo page: DATABASE_URL, SMTP"]


def test_import_repos_is_idempotent(sf, tmp_path):
    f = tmp_path / "repos.yaml"
    f.write_text("repos:\n  - name: acme/api\n    role: backend\n    gates: [make lint]\n")
    seed_user(sf)
    assert import_repos(sf, f, "Acme", "alice") == ["acme/api"]
    f.write_text("repos:\n  - name: acme/api\n    role: backend\n    gates: [make check]\n")
    import_repos(sf, f, "acme", "ALICE", "Shop")
    with sf() as s:
        (p,), (r,) = s.query(Project).all(), s.query(Repo).all()
        assert (p.description, r.role, r.config["gates"]) == ("Shop", "backend", ["make check"])
