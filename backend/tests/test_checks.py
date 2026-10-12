"""Built-in checks on a PR diff against a learned branch profile."""
from mogo.checks import CheckContext, enabled_checks, render_section, run_checks
from mogo.checks.duplicate_types import find as find_dupes, normalize
from mogo.checks.structure import find as find_structure
from mogo.github.diffmap import added_lines, file_changes
from mogo.profile.build import DirTree, build_profile


def new_file(path, content):
    lines = content.splitlines()
    return (f"diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n"
            f"@@ -0,0 +1,{len(lines)} @@\n" + "".join(f"+{line}\n" for line in lines))


def modified(path, before_line, added, at):
    return (f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -{at},1 +{at},2 @@\n"
            f" {before_line}\n+{added}\n")


MAIN = {
    "src/modules/trip/trip.dto.ts": "export interface TripShareDto {\n  id: string\n  url: string\n  tripId: string\n  expiresAt: Date\n}\n",
    "src/modules/trip/trip.service.ts": "export class TripService {}\n",
    "src/modules/trip/trip.controller.ts": "export class TripController {}\n",
    "src/modules/trip/trip.module.ts": "export class TripModule {}\n",
    "src/modules/user/user.service.ts": "export interface UserRow { id: string }\n",
    "src/modules/user/user.controller.ts": "",
    "src/modules/user/user.module.ts": "",
    "src/common/utils/date-format.ts": "",
    "src/common/utils/string-case.ts": "",
    "src/common/utils/slug-make.ts": "",
    "test/trip.e2e-spec.ts": "", "test/user.e2e-spec.ts": "", "test/app.e2e-spec.ts": "",
}


def ctx_for(tmp_path, diff, pr_files):
    main, pr = tmp_path / "main", tmp_path / "pr"
    for root, files in ((main, MAIN), (pr, {**MAIN, **pr_files})):
        for p, c in files.items():
            (root / p).parent.mkdir(parents=True, exist_ok=True)
            (root / p).write_text(c)
    return CheckContext(root=pr, diff=diff, profile=build_profile(DirTree(main), "mainsha", "main"))


def test_diff_helpers():
    d = new_file("src/a.ts", "x\ny") + modified("src/b.ts", "keep", "added", 4) + (
        "diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n")
    assert file_changes(d) == {"src/a.ts": "added", "src/b.ts": "modified", "old.ts": "deleted"}
    assert added_lines(d) == {"src/a.ts": {1, 2}, "src/b.ts": {5}}


def test_normalize():
    assert normalize("TripShareDto") == normalize("TripShare") == normalize("ITripShare") == "tripshare"
    assert normalize("Dto") == "dto"


def test_duplicate_by_suffix_and_by_fields(tmp_path):
    share = "export interface TripShare {\n  id: string\n  url: string\n}\n"
    link = "export type ShareLink = {\n  id: string\n  url: string\n  tripId: string\n  expiresAt: Date\n}\n"
    diff = new_file("src/modules/trip/share.types.ts", share) + new_file("src/modules/trip/link.ts", link)
    got = find_dupes(ctx_for(tmp_path, diff, {"src/modules/trip/share.types.ts": share, "src/modules/trip/link.ts": link}))
    msgs = [c.message for c in got]
    assert any("`TripShare` looks like interface `TripShareDto`" in m and "suffix" in m for m in msgs)
    assert any("`ShareLink` looks like interface `TripShareDto`" in m and "100% of fields" in m for m in msgs)
    assert {c.path for c in got} == {"src/modules/trip/share.types.ts", "src/modules/trip/link.ts"}


def test_editing_a_type_in_its_own_file_and_untouched_types_are_fine(tmp_path):
    content = MAIN["src/modules/trip/trip.dto.ts"].replace("  url: string\n", "  url: string\n  note: string\n")
    diff = modified("src/modules/trip/trip.dto.ts", "  url: string", "  note: string", 3)
    assert find_dupes(ctx_for(tmp_path, diff, {"src/modules/trip/trip.dto.ts": content})) == []


def test_types_in_another_language_are_not_duplicates(tmp_path):
    py = "from pydantic import BaseModel\n\n\nclass TripShareDto(BaseModel):\n    id: str\n    url: str\n    trip_id: str\n"
    diff = new_file("api/models.py", py)
    assert find_dupes(ctx_for(tmp_path, diff, {"api/models.py": py})) == []


def test_same_type_added_twice_in_one_pr(tmp_path):
    a = "export interface Money {\n  amount: number\n  currency: string\n  scale: number\n}\n"
    b = "export interface Price {\n  amount: number\n  currency: string\n  scale: number\n}\n"
    diff = new_file("src/a/money.ts", a) + new_file("src/b/price.ts", b)
    got = find_dupes(ctx_for(tmp_path, diff, {"src/a/money.ts": a, "src/b/price.ts": b}))
    assert [c.path for c in got] == ["src/b/price.ts"] and "this PR also adds" in got[0].message


def test_structure_candidates(tmp_path):
    files = {
        "src/common/utils/dateHelper.ts": "",  # camel among kebab
        "src/modules/trip/share.ts": "",  # no .x.ts suffix among trip.service/controller/module? (mixed -> skipped)
        "lib/thing.ts": "",  # new top-level folder
        "src/modules/trip/share.spec.ts": "",  # tests live in test/
        "src/modules/payment/PaymentService.ts": "",  # new folder: judged by src/modules subtree (flat)
    }
    diff = "".join(new_file(p, "x") for p in files)
    got = {c.path: c.message for c in find_structure(ctx_for(tmp_path, diff, files))}
    assert "camel" in got["src/common/utils/dateHelper.ts"] and "kebab" in got["src/common/utils/dateHelper.ts"]
    assert "new top-level folder `lib/`" in got["lib/thing.ts"]
    assert "separate test folders" in got["src/modules/trip/share.spec.ts"]
    assert "pascal" in got["src/modules/payment/PaymentService.ts"]
    assert "src/modules/trip/share.ts" not in got


def test_role_suffix_when_siblings_agree(tmp_path):
    extra = {f"src/svc/{n}.service.ts": "" for n in ("a", "b", "c", "d")}
    files = {"src/svc/e.helper.ts": ""}
    main_and_pr = {**extra, **files}
    diff = new_file("src/svc/e.helper.ts", "x")
    ctx = ctx_for(tmp_path, diff, main_and_pr)
    ctx.profile = build_profile(DirTree(_write(tmp_path / "m2", {**MAIN, **extra})), "s", "main")
    got = find_structure(ctx)
    assert any("use `.service.ts`" in c.message for c in got)


def _write(root, files):
    for p, c in files.items():
        (root / p).parent.mkdir(parents=True, exist_ok=True)
        (root / p).write_text(c)
    return root


def test_checks_can_be_disabled_and_errors_do_not_escape(tmp_path):
    assert [c.id for c in enabled_checks({"checks": {"no-duplicate-types": False}})] == ["structure-convention"]
    ctx = ctx_for(tmp_path, "garbage", {})
    ctx.root = tmp_path / "nope"
    outcomes = run_checks(enabled_checks({}), ctx)
    text = render_section(outcomes, ctx.profile)
    assert "builtin:no-duplicate-types" in text and "Conventions learned from `main`" in text


# --- end to end through the pipeline

def test_pipeline_learns_main_and_hands_candidates_to_the_agent(settings, sf, tmp_path):
    from mogo.config import RepoConfig
    from mogo.models import Run
    from mogo.runner.pipeline import execute_run
    from conftest import FakeLLM, seed_repos, tool_call
    from test_pipeline import fake_github, make_run

    main = _write(tmp_path / "main", MAIN)
    share = "export interface TripShare {\n  id: string\n  url: string\n}\n"
    diff = new_file("src/modules/trip/share.types.ts", share) + new_file("src/common/utils/dateHelper.ts", "x")
    gh = fake_github([])
    gh.get_diff = lambda *a: diff

    def checkout(owner, repo, number, token, dest):
        _write(dest, {**MAIN, "src/modules/trip/share.types.ts": share, "src/common/utils/dateHelper.ts": "x"})

    seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    report = {
        "summary": "dup", "findings": [{"path": "src/modules/trip/share.types.ts", "line": 1, "severity": "major",
                                         "message": "reuse TripShareDto", "rule": "builtin:no-duplicate-types"}],
        "checks": [{"id": "builtin:no-duplicate-types", "status": "fail", "note": "TripShare"},
                   {"id": "structure-convention", "status": "pass"}],
    }
    prompts = []
    for _ in range(2):
        llm = FakeLLM([[tool_call("submit_report", report)]])
        rid = make_run(sf, dry_run=True)
        execute_run(rid, settings, sf, gh=gh, llm_factory=lambda _c, llm=llm: llm, checkout=checkout,
                    base_tree=lambda root, branch, token: DirTree(main))
        prompts.append(llm.first_user_prompt)

    p = prompts[0]
    assert "Conventions learned from `main`" in p and "@ a1b2c3d" in p
    assert "`TripShare` looks like interface `TripShareDto`" in p
    assert "dateHelper.ts` is camel" in p
    with sf() as s:
        r = s.get(Run, rid)
        assert r.status == "succeeded", r.error
        assert r.result["checks"][0] == {"id": "no-duplicate-types", "status": "fail", "note": "TripShare"}
        assert "❌ `no-duplicate-types`: TripShare" in r.result["summary_md"]
        from mogo.models import RunEvent
        msgs = [e.message for e in s.query(RunEvent).order_by(RunEvent.id)]
    assert any(m.startswith("conventions learned from main") for m in msgs)
    assert any(m.startswith("conventions reused from main") for m in msgs)  # second run: same main sha


def test_checks_switched_off_leave_no_section(settings, sf, tmp_path):
    from mogo.config import RepoConfig
    from mogo.models import Project
    from mogo.runner.pipeline import execute_run
    from conftest import FakeLLM, seed_repos, tool_call
    from test_pipeline import fake_checkout, fake_github, make_run

    seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    with sf() as s:
        p = s.query(Project).one()
        p.settings = {"checks": {"no-duplicate-types": False, "structure-convention": False}}
        s.commit()
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    execute_run(make_run(sf), settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm,
                checkout=fake_checkout)
    assert "(none enabled)" in llm.first_user_prompt and "builtin:" not in llm.first_user_prompt


def test_rebuild_profile_job(settings, sf, tmp_path):
    from mogo.config import RepoConfig
    from mogo.models import RepoProfile
    from mogo.profile.job import rebuild_profile
    from conftest import seed_repos
    from test_pipeline import fake_github
    import subprocess

    ids = seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})

    def clone(owner, repo, branch, token, dest):
        _write(dest, MAIN)
        for args in (["init", "-q"], ["add", "."], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "m"],
                     ["update-ref", "refs/mogo/base", "HEAD"]):
            subprocess.run(["git", *args], cwd=dest, check=True, capture_output=True)

    p = rebuild_profile(sf, settings, ids["acme/api"], gh=fake_github([]), clone=clone)
    assert p.main_sha == "a1b2c3d4e5f6" and len(p.type_index) >= 5

    def broken(*a):
        raise RuntimeError("no access")
    try:
        rebuild_profile(sf, settings, ids["acme/api"], gh=fake_github([]), clone=broken)
    except RuntimeError:
        pass
    with sf() as s:
        row = s.get(RepoProfile, ids["acme/api"])
        assert "no access" in row.error and row.main_sha == "a1b2c3d4e5f6"  # last good profile kept
