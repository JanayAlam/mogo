"""One run, end to end. Used by the local thread, the CLI and the GitHub Actions job."""
from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path

import sentry_sdk
from sqlalchemy.orm import sessionmaker

from mogo.agent.loop import run_agent
from mogo.agent.prompts import SYSTEM, build_user_prompt
from mogo.agent.schemas import GateResult
from mogo.agent.tools import ToolBox
from mogo.checks import CheckContext, CheckOutcome, enabled_checks, render_section, run_checks
from mogo.config import RepoConfig, Settings
from mogo.context import ContextError, RunContext, load_context
from mogo.github.client import GitHubClient, GitHubError, parse_pr_url
from mogo.llm.provider import make_client, resolve_llm
from mogo.logging_setup import set_run_context
from mogo.models import Run, RunEvent
from mogo.profile.build import GitTree, Tree
from mogo.profile.store import ensure_profile, save_profile_error
from mogo.runner import sandbox
from mogo.runner.review import render_summary, split_findings, verdict
from mogo.secrets import Redactor, decrypt_all

log = logging.getLogger(__name__)


class RunFailed(RuntimeError):
    pass


class _Recorder:
    """Writes progress to the log and to run_events so the UI can show it."""

    def __init__(self, sf: sessionmaker, run_id: str):
        self.sf, self.run_id = sf, run_id
        self.redact = Redactor()  # replaced once the repo's secrets are known

    def __call__(self, msg: str, level: str = "info") -> None:
        msg = self.redact(msg)
        getattr(log, level if level != "warn" else "warning")(msg)
        with self.sf() as s:
            s.add(RunEvent(run_id=self.run_id, level=level, message=msg[:2000]))
            s.commit()

    def update(self, **fields) -> None:
        with self.sf() as s:
            run = s.get(Run, self.run_id)
            for k, v in fields.items():
                setattr(run, k, self.redact.deep(v))
            s.commit()


CONVENTION_FILE_LIMIT = 20000
SEEDS_DIR = Path(__file__).resolve().parents[3] / "seeds"  # fixtures that `prepare` commands may copy in


def _read_conventions(root: Path, names: list[str]) -> str:
    chunks = []
    for n in names:
        p = root / n
        if p.is_file():
            chunks.append(f"### {n}\n{p.read_text(errors='replace')[:CONVENTION_FILE_LIMIT]}")
    return "\n\n".join(chunks)


def git_base_tree(root: Path, branch: str, token: str) -> Tree:
    """The source of truth branch, fetched into the PR checkout as a separate ref."""
    return GitTree(root, sandbox.fetch_branch(root, branch, token))


def _builtin_checks(
    rec: _Recorder, sf: sessionmaker, ctx: RunContext, gh: GitHubClient, root: Path, diff: str,
    owner: str, repo: str, token: str, base_tree,
) -> str:
    """Learns (or reuses) the branch profile, runs the enabled checks, returns the prompt section."""
    checks = enabled_checks(ctx.project_settings)
    if not checks:
        return ""
    branch = ctx.default_branch
    try:
        head = gh.branch_sha(owner, repo, branch)
        profile, reused = ensure_profile(sf, ctx.repo_id, branch, head, lambda: base_tree(root, branch, token))
    except Exception as e:  # noqa: BLE001 - the review goes on without learned conventions
        msg = f"could not learn conventions from `{branch}`: {e}"
        rec(msg, "warn")
        save_profile_error(sf, ctx.repo_id, msg)
        return render_section([CheckOutcome(c, error=msg) for c in checks], None)
    rec(f"conventions {'reused' if reused else 'learned'} from {branch} @ {head[:7]}: "
        f"{profile.structure.get('files', 0)} files, {len(profile.type_index)} types")
    outcomes = run_checks(checks, CheckContext(root=root, diff=diff, profile=profile))
    rec("built-in checks: " + ", ".join(
        f"{o.check.id} " + (f"error ({o.error})" if o.error else f"{len(o.candidates)} candidates") for o in outcomes
    ))
    return render_section(outcomes, profile)


def execute_run(
    run_id: str, settings: Settings, sf: sessionmaker,
    gh: GitHubClient | None = None, llm_factory=None, checkout=sandbox.checkout_pr, base_tree=git_base_tree,
) -> None:
    set_run_context(run_id)
    rec = _Recorder(sf, run_id)
    gh = gh or GitHubClient(settings.github_token)
    workdir = Path(tempfile.mkdtemp(prefix="mogo-"))
    app: sandbox.AppProcess | None = None
    cfg: RepoConfig | None = None
    services_started = False
    try:
        with sf() as s:
            run = s.get(Run, run_id)
            pr_url, mode, dry = run.pr_url, run.llm_mode, run.dry_run
        rec.update(status="running")

        owner, repo_name, number = parse_pr_url(pr_url)
        try:
            ctx = load_context(sf, run_id)
        except ContextError as e:
            raise RunFailed(str(e)) from e
        cfg, feature = ctx.cfg, ctx.feature
        if cfg.name.lower() != f"{owner}/{repo_name}".lower():
            raise RunFailed(f"PR belongs to {owner}/{repo_name}, but the feature lists it under {cfg.name}")

        # The repo's commands see only its own env and secrets; the runner's credentials stay out (sandbox.scrubbed_env).
        if ctx.legacy_env_from:
            rec("env_from is no longer read (runner secrets are for the runner only); add these under Secrets on "
                f"the repo page: {', '.join(ctx.legacy_env_from)}", "warn")
        stored, secret_problems = decrypt_all(settings.mogo_secret_key, ctx.repo_id, ctx.secrets)
        for problem in secret_problems:
            rec(f"repo secret unavailable: {problem}", "warn")
        repo_env = {**cfg.env, **stored}  # a secret wins over a plain env value of the same name
        rec.redact = Redactor(stored.values())
        if stored:
            rec(f"repo secrets: {', '.join(sorted(stored))}")

        pr = gh.get_pr(owner, repo_name, number)
        head_repo = (pr.get("head", {}).get("repo") or {}).get("full_name", "").lower()
        if head_repo != f"{owner}/{repo_name}".lower() and not cfg.allow_forks:
            raise RunFailed("PR comes from a fork; enable allow_forks in the repo settings to run it")
        diff = gh.get_diff(owner, repo_name, number)
        rec(f"PR #{number} '{pr['title']}': {len(diff)} bytes of diff")

        choice = resolve_llm(settings, mode)
        rec.update(llm_used=choice.label)
        rec(f"using LLM {choice.label}")

        root = workdir / "repo"
        checkout(owner, repo_name, number, settings.github_token, root)
        rec("checked out PR branch")
        builtin = _builtin_checks(rec, sf, ctx, gh, root, diff, owner, repo_name, settings.github_token, base_tree)

        for cmd in cfg.setup:
            code, out = sandbox.run_cmd(cmd, root, env=repo_env)
            if code:
                raise RunFailed(f"setup failed: `{cmd}`\n{sandbox.tail(out, 1500)}")
        rec("setup done")

        gates = []
        for cmd in cfg.gates:
            code, out = sandbox.run_cmd(cmd, root, env=repo_env)
            gates.append(GateResult(cmd=cmd, ok=code == 0, output=sandbox.tail(out, 1500)))
            if code:
                rec(f"gate failed (exit {code}): `{cmd}`\n{sandbox.tail(out, 800)}", "warn")
        if gates:
            rec(f"gates: {sum(g.ok for g in gates)}/{len(gates)} passed")

        cmd_env = {**repo_env, "MOGO_SEEDS_DIR": str(SEEDS_DIR)}
        app_status = "not started (review only)" if not feature else "no start command configured"
        if feature and cfg.start:
            if cfg.services_cmd:
                services_started = True
                code, out = sandbox.run_cmd(cfg.services_cmd, root, env=repo_env)
                if code:
                    rec(f"services failed: {sandbox.tail(out, 500)}", "warn")
            prepared = True
            for cmd in cfg.prepare:
                code, out = sandbox.run_cmd(cmd, root, env=cmd_env)
                if code:
                    prepared = False
                    app_status = f"NOT started: prepare step `{cmd}` failed:\n{sandbox.tail(out, 1200)}"
                    break
            if prepared:
                app = sandbox.AppProcess(cfg.start, root, repo_env, cfg.healthcheck or "http://localhost:3000")
                if app.wait_healthy():
                    app_status = f"running; health check {cfg.healthcheck} OK. Test command: `{cfg.test_cmd or 'n/a'}`"
                else:
                    log_tail = sandbox.tail(app.stop(), 1500)
                    app = None
                    app_status = (
                        "FAILED to become healthy. Report this as a blocker finding or unverified criteria.\n"
                        f"App output:\n{log_tail}"
                    )
            rec(f"app: {app_status}")

        user = build_user_prompt(
            title=pr["title"], body=pr.get("body") or "", feature=feature, diff=diff,
            conventions=_read_conventions(root, cfg.conventions), rules=cfg.rules,
            gates=gates, app_status=app_status, notes=cfg.notes, project=ctx, builtin=builtin,
        )
        client = (llm_factory or make_client)(choice)
        report = run_agent(client, choice.model, SYSTEM, rec.redact(user), ToolBox(root, cmd_env, rec.redact), settings.max_agent_steps)
        rec(f"agent done: {len(report.criteria)} criteria, {len(report.findings)} findings")

        inline, general = split_findings(report.findings, diff)
        body = rec.redact(render_summary(report, gates, general, choice.label))
        inline = rec.redact.deep(inline)
        v = verdict(report, gates)
        review_url = ""
        if dry:
            rec("dry run: review not posted")
        else:
            event = "REQUEST_CHANGES" if v == "changes_requested" else "COMMENT"
            try:
                res = gh.create_review(owner, repo_name, number, body=body, event=event,
                                       comments=inline, commit_id=pr["head"]["sha"])
            except GitHubError as e:
                rec(f"inline review rejected ({e}); posting summary only", "warn")
                extra = "\n".join(f"- `{c['path']}:{c['line']}` {c['body']}" for c in inline)
                res = gh.create_review(owner, repo_name, number, event=event,
                                       body=body + "\n\n### Inline findings\n" + extra, comments=[],
                                       commit_id=pr["head"]["sha"])
            review_url = res.get("html_url", "")
            rec(f"review posted: {review_url}")
        rec.update(status="succeeded", verdict=v, review_url=review_url,
                   result={**report.model_dump(), "gates": [g.model_dump() for g in gates],
                           "inline": len(inline), "summary_md": body})
    except Exception as e:  # noqa: BLE001 - last-resort handler, reported to Sentry via log.exception
        log.exception("run failed")
        sentry_sdk.capture_exception(e)
        rec(f"failed: {e}", "error")
        rec.update(status="failed", error=str(e)[:2000])
    finally:
        if app:
            app.stop()
        if services_started and cfg and cfg.services_down:
            code, out = sandbox.run_cmd(cfg.services_down, workdir, timeout=120, env=repo_env)
            if code:
                log.warning("services_down failed: %s", sandbox.tail(out, 500))
        shutil.rmtree(workdir, ignore_errors=True)
