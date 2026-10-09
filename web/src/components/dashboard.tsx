"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type LlmMode, type Run, type RunDetail } from "@/lib/client";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function StatusBadge({ run }: { run: Run }) {
  const v =
    run.status === "failed"
      ? "destructive"
      : run.status === "succeeded"
        ? "default"
        : "secondary";
  const label =
    run.status === "succeeded" && run.verdict === "changes_requested"
      ? "changes requested"
      : run.status;
  return <Badge variant={v}>{label}</Badge>;
}

function RunPanel({ id }: { id: string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .run(id)
        .then((r) => live && setRun(r))
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);
  if (!run) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {run.repo} #{run.pr_number} <StatusBadge run={run} />
          {run.llm_used && (
            <span className="text-xs font-normal text-muted-foreground">
              {run.llm_used}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {run.review_url && (
          <a
            className="text-sm underline"
            href={run.review_url}
            target="_blank"
            rel="noreferrer">
            Open review on GitHub
          </a>
        )}
        {run.error && (
          <pre className="whitespace-pre-wrap text-sm text-destructive">
            {run.error}
          </pre>
        )}
        {run.result?.summary_md && (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
            {run.result.summary_md}
          </pre>
        )}
        <ol className="max-h-64 space-y-1 overflow-auto text-xs">
          {run.events.map((e, i) => (
            <li
              key={i}
              className={
                e.level === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }>
              {new Date(e.ts).toLocaleTimeString()} {e.message}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const [repos, setRepos] = useState<string[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState("");
  const [feature, setFeature] = useState("");
  const [mode, setMode] = useState<LlmMode>("auto");
  const [dry, setDry] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    () =>
      api
        .runs()
        .then(setRuns)
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    api
      .repos()
      .then(setRepos)
      .catch(() => {});
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const run = await api.createRun({
        pr_url: prUrl.trim(),
        feature,
        llm_mode: mode,
        dry_run: dry,
      });
      setSelected(run.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">mogo</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New run</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pr">Pull request URL</Label>
                <Input
                  id="pr"
                  required
                  value={prUrl}
                  onChange={(e) => setPrUrl(e.target.value)}
                  placeholder={`https://github.com/${repos[0] ?? "org/repo"}/pull/123`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="feature">
                  Expected feature (leave empty for review only)
                </Label>
                <Textarea
                  id="feature"
                  rows={6}
                  value={feature}
                  onChange={(e) => setFeature(e.target.value)}
                  placeholder="POST /orders with an empty cart returns 422 and creates no row…"
                />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="mode">LLM</Label>
                  <select
                    id="mode"
                    className={selectClass}
                    value={mode}
                    onChange={(e) => setMode(e.target.value as LlmMode)}>
                    <option value="auto">
                      auto (local if reachable, else DeepSeek)
                    </option>
                    <option value="local">local only</option>
                    <option value="deepseek">DeepSeek only</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={dry}
                    onChange={(e) => setDry(e.target.checked)}
                  />
                  dry run
                </label>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy}>
                {busy ? "Starting…" : "Run agent"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {runs.length === 0 && (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            )}
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                  selected === r.id ? "bg-muted" : ""
                }`}>
                <span className="truncate">
                  {r.repo} #{r.pr_number}
                  {r.dry_run && (
                    <span className="text-muted-foreground"> · dry</span>
                  )}
                </span>
                <StatusBadge run={r} />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {selected && <RunPanel id={selected} />}
    </main>
  );
}
