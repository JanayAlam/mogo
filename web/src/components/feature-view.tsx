"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorText, Shell, StatusBadge, timeAgo, useAction, useApi } from "@/components/ui-kit";
import { api, type Feature, type Finding, type LlmMode, type RunDetail } from "@/lib/client";
import { checkTitle } from "@/lib/checks";
import { runState } from "@/lib/status";

type FeatureRepo = Feature["repos"][number];
const inFlight = (s: string | undefined) => s === "queued" || s === "running";

export function FeatureView() {
  const { id, featureId } = useParams<{ id: string; featureId: string }>();
  const router = useRouter();
  const feature = useApi(
    () => api.feature(featureId),
    featureId,
    (f) => f.repos.some((r) => inFlight(r.latest_run?.status)),
  );
  const [mode, setMode] = useState<LlmMode>("auto");
  const [dry, setDry] = useState(false);
  const start = useAction();
  const del = useAction();

  const f = feature.data;
  if (!f) {
    return (
      <Shell>
        <ErrorText error={feature.error} />
        {!feature.error && <p className="text-muted-foreground">Loading…</p>}
      </Shell>
    );
  }
  const runRepos = (repoIds?: string[]) =>
    start.run(async () => {
      const res = await api.startRuns(f.id, { repo_ids: repoIds, llm_mode: mode, dry_run: dry });
      if (res.errors.length) start.setError(res.errors.join("; "));
      feature.reload();
    });
  const anyRunning = f.repos.some((r) => inFlight(r.latest_run?.status));

  return (
    <Shell>
      <Link href={`/projects/${id}`} className="font-mono text-xs text-muted-foreground hover:text-foreground">← project</Link>
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{f.title}</h1>
            <StatusBadge state={f.state} />
          </div>
          {f.description && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{f.description}</p>}
        </div>
        <div className="flex gap-2">
          <Link href={`/projects/${id}/features/${f.id}/edit`} className="btn-ghost">Edit</Link>
          <button
            className="btn-ghost"
            disabled={del.busy}
            onClick={() => {
              if (!confirm(`Delete "${f.title}" and its run history?`)) return;
              del.run(async () => {
                await api.deleteFeature(f.id);
                router.push(`/projects/${id}`);
              });
            }}>
            Delete
          </button>
        </div>
      </div>

      <div className="panel mb-6 flex flex-wrap items-end gap-4 p-4">
        <div>
          <label className="label" htmlFor="mode">LLM</label>
          <select id="mode" className="field" value={mode} onChange={(e) => setMode(e.target.value as LlmMode)}>
            <option value="auto">auto (local if reachable, else DeepSeek)</option>
            <option value="local">local only</option>
            <option value="deepseek">DeepSeek only</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} />
          dry run <span className="text-muted-foreground">(don&apos;t post on GitHub)</span>
        </label>
        <button className="btn-primary ml-auto" disabled={start.busy || anyRunning} onClick={() => runRepos()}>
          {anyRunning ? "Running…" : `Check all ${f.repos.length} repo${f.repos.length === 1 ? "" : "s"}`}
        </button>
      </div>
      <ErrorText error={start.error || del.error} />

      <div className="space-y-4">
        {f.repos.map((r) => (
          <RepoCard key={r.id} fr={r} busy={start.busy} onRun={() => runRepos([r.repo_id])} />
        ))}
      </div>
    </Shell>
  );
}

function RepoCard({ fr, busy, onRun }: { fr: FeatureRepo; busy: boolean; onRun: () => void }) {
  const run = fr.latest_run;
  const [open, setOpen] = useState(false);
  const state = runState(run);
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">{fr.role || "no role"}</span>
            <span className="font-mono text-sm">{fr.full_name}</span>
            <StatusBadge state={state} label={run?.verdict === "changes_requested" ? "changes requested" : undefined} />
            {run && <span className="font-mono text-xs text-muted-foreground">{timeAgo(run.updated_at)}{run.dry_run ? " · dry" : ""}</span>}
          </div>
          <a href={fr.pr_url} target="_blank" rel="noreferrer" className="mt-1 block truncate font-mono text-xs text-info hover:underline">{fr.pr_url}</a>
        </div>
        <div className="flex gap-2">
          {run?.review_url && <a href={run.review_url} target="_blank" rel="noreferrer" className="btn-ghost px-2.5 py-1 text-xs">Review on GitHub</a>}
          {run && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setOpen(!open)}>{open ? "Hide details" : "Details"}</button>}
          <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy || inFlight(run?.status)} onClick={onRun}>{run ? "Re-run" : "Run"}</button>
        </div>
      </div>
      {fr.requirements && (
        <div className="mt-3 text-sm">
          <p className="label">Requirements for this repo</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{fr.requirements}</p>
        </div>
      )}
      {run?.error && <pre className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">{run.error}</pre>}
      {run && open && <RunDetails runId={run.id} />}
    </div>
  );
}

const CRITERION_ICON = { pass: "✓", fail: "✗", unverified: "?" } as const;
const CRITERION_STYLE = { pass: "text-success", fail: "text-destructive", unverified: "text-warning" } as const;
const SEVERITY_STYLE: Record<Finding["severity"], string> = {
  blocker: "text-destructive border-destructive/40",
  major: "text-destructive border-destructive/30",
  minor: "text-warning border-warning/30",
  nit: "text-muted-foreground border-border",
};
const CHECK_STYLE = { pass: "text-success", fail: "text-destructive", skipped: "text-muted-foreground" } as const;
const CHECK_ICON = { pass: "✓", fail: "✗", skipped: "–" } as const;

/** Built-in checks get their own group; everything else is one list. */
function groupFindings(findings: Finding[]): [string, Finding[]][] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.rule?.startsWith("builtin:") ? checkTitle(f.rule) : "Review findings";
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.entries()];
}

function RunDetails({ runId }: { runId: string }) {
  const { data: run, error } = useApi<RunDetail>(() => api.run(runId), runId, (r) => inFlight(r.status));
  if (!run) return <ErrorText error={error} />;
  const res = run.result;
  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      {res?.summary && <p className="text-sm">{res.summary}</p>}
      {!!res?.criteria?.length && (
        <div>
          <p className="label">Acceptance criteria</p>
          <ul className="space-y-1.5 text-sm">
            {res.criteria.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className={`font-mono ${CRITERION_STYLE[c.status]}`}>{CRITERION_ICON[c.status]}</span>
                <span>
                  {c.text}
                  {c.evidence && <span className="block text-xs text-muted-foreground">{c.evidence}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!res?.checks?.length && (
        <div>
          <p className="label">Built-in checks</p>
          <ul className="space-y-1 text-sm">
            {res.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className={`font-mono ${CHECK_STYLE[c.status]}`}>{CHECK_ICON[c.status]}</span>
                <span>
                  {checkTitle(c.id)}
                  {c.note && <span className="text-muted-foreground"> · {c.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {groupFindings(res?.findings ?? []).map(([title, items]) => (
        <div key={title}>
          <p className="label">{title}</p>
          <ul className="space-y-1.5 text-sm">
            {items.map((f, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className={`rounded border px-1.5 font-mono text-xs ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
                <span className="font-mono text-xs text-muted-foreground">{f.path}:{f.line}</span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!!res?.gates?.length && (
        <div>
          <p className="label">Gates</p>
          <ul className="space-y-1 font-mono text-xs">
            {res.gates.map((g, i) => (
              <li key={i} className={g.ok ? "text-success" : "text-destructive"}>{g.ok ? "✓" : "✗"} {g.cmd}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="label">Log{run.llm_used ? ` · ${run.llm_used}` : ""}</p>
        <ol className="max-h-64 space-y-0.5 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {run.events.map((e, i) => (
            <li key={i} className={e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-warning" : "text-muted-foreground"}>
              {new Date(e.ts).toLocaleTimeString()} {e.message}
            </li>
          ))}
          {run.events.length === 0 && (
            <li className="text-muted-foreground">{inFlight(run.status) ? "waiting for the runner…" : "no log"}</li>
          )}
        </ol>
      </div>
    </div>
  );
}
