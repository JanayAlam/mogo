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
from mogo.config import RepoConfig, Settings
from mogo.github.client import GitHubClient, GitHubError, parse_pr_url
from mogo.llm.provider import make_client, resolve_llm
from mogo.logging_setup import set_run_context
from mogo.models import Run, RunEvent
from mogo.runner import sandbox
from mogo.runner.review import render_summary, split_findings, verdict

log = logging.getLogger(__name__)


class RunFailed(RuntimeError):
    pass


class _Recorder:
    """Writes progress to the log and to run_events so the UI can show it."""

    def __init__(self, sf: sessionmaker, run_id: str):
        self.sf, self.run_id = sf, run_id

    def __call__(self, msg: str, level: str = "info") -> None:
        getattr(log, level if level != "warn" else "warning")(msg)
        with self.sf() as s:
            s.add(RunEvent(run_id=self.run_id, level=level, message=msg[:2000]))
            s.commit()

    def update(self, **fields) -> None:
        with self.sf() as s:
            run = s.get(Run, self.run_id)
            for k, v in fields.items():
                setattr(run, k, v)
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


def execute_run(
    run_id: str, settings: Settings, repos: dict[str, RepoConfig], sf: sessionmaker,
    gh: GitHubClient | None = None, llm_factory=None, checkout=sandbox.checkout_pr,
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
            pr_url, feature, mode, dry = run.pr_url, run.feature, run.llm_mode, run.dry_run
        rec.update(status="running")

        owner, repo_name, number = parse_pr_url(pr_url)
        cfg = repos.get(f"{owner}/{repo_name}".lower())
        if cfg is None:
            raise RunFailed(f"{owner}/{repo_name} is not configured in repos.yaml")

        repo_env, missing_env = sandbox.resolve_repo_env(cfg.env, cfg.env_from)
        if missing_env:
            rec(f"env_from secrets not set (features needing them will fail): {', '.join(missing_env)}", "warn")

        pr = gh.get_pr(owner, repo_name, number)
        head_repo = (pr.get("head", {}).get("repo") or {}).get("full_name", "").lower()
        if head_repo != f"{owner}/{repo_name}".lower() and not cfg.allow_forks:
            raise RunFailed("PR comes from a fork; set allow_forks: true in repos.yaml to run it")
        diff = gh.get_diff(owner, repo_name, number)
        rec(f"PR #{number} '{pr['title']}': {len(diff)} bytes of diff")

        choice = resolve_llm(settings, mode)
        rec.update(llm_used=choice.label)
        rec(f"using LLM {choice.label}")

        root = workdir / "repo"
        checkout(owner, repo_name, number, settings.github_token, root)
        rec("checked out PR branch")

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
            gates=gates, app_status=app_status, notes=cfg.notes,
        )
        client = (llm_factory or make_client)(choice)
        report = run_agent(client, choice.model, SYSTEM, user, ToolBox(root, cmd_env), settings.max_agent_steps)
        rec(f"agent done: {len(report.criteria)} criteria, {len(report.findings)} findings")

        inline, general = split_findings(report.findings, diff)
        body = render_summary(report, gates, general, choice.label)
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
