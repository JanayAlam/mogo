"use client";

import { ExternalLink, Pencil, Play, RotateCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import { useState } from "react";
import { toast } from "sonner";

import { FeatureSkeleton } from "@/components/skeletons";
import {
  BackLink,
  Chip,
  ConfirmButton,
  ErrorText,
  Eyebrow,
  Shell,
  StatusBadge,
  errorMessage,
  timeAgo,
  useAction,
  useApi,
  useSession,
} from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { checkTitle } from "@/lib/checks";
import {
  api,
  type Feature,
  type Finding,
  type RunDetail,
} from "@/lib/client";
import { runState } from "@/lib/status";
import { cn } from "@/lib/utils";

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
  const session = useSession();
  const [dry, setDry] = useState(false);
  const start = useAction();
  const [starting, setStarting] = useState<string | null>(null); // "all" or a repo id
  const del = useAction();

  const f = feature.data;
  if (!f) {
    return (
      <Shell>
        <ErrorText error={feature.error} />
        {!feature.error && <FeatureSkeleton />}
      </Shell>
    );
  }
  const runRepos = (repoIds?: string[]) => {
    setStarting(repoIds ? repoIds[0] : "all");
    return start.run(async () => {
      try {
        const res = await api.startRuns(f.id, {
          repo_ids: repoIds,
          dry_run: dry,
        });
        if (res.errors.length) {
          toast.error("Some runs could not start", {
            description: res.errors.join("; "),
          });
        } else {
          toast.success(
            `Started ${res.runs.length} run${res.runs.length === 1 ? "" : "s"}`,
          );
        }
        feature.reload();
      } catch (e) {
        toast.error("Could not start", { description: errorMessage(e) });
        throw e;
      } finally {
        setStarting(null);
      }
    });
  };
  const anyRunning = f.repos.some((r) => inFlight(r.latest_run?.status));

  return (
    <Shell>
      <BackLink href={`/projects/${id}`}>Back to project</BackLink>
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{f.title}</h1>
            <StatusBadge state={f.state} />
          </div>
          {f.description && (
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {f.description}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/projects/${id}/features/${f.id}/edit`}>
              <Pencil /> Edit
            </Link>
          </Button>
          <ConfirmButton
            variant="outline"
            loading={del.busy}
            title={`Delete "${f.title}"?`}
            description="The feature and its run history are deleted. Reviews already posted on GitHub stay."
            onConfirm={() =>
              del.run(async () => {
                await api.deleteFeature(f.id);
                router.push(`/projects/${id}`);
              })
            }>
            Delete
          </ConfirmButton>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-6 p-4">
          <div className="space-y-1 pb-2">
            <Eyebrow>LLM</Eyebrow>
            {session && !session.llm.configured ? (
              <Link href="/settings" className="text-sm text-destructive underline underline-offset-2">
                Set up your LLM to run checks
              </Link>
            ) : (
              <Link href="/settings" className="font-mono text-sm hover:underline">
                {session?.llm.model ?? "…"}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="dry"
              checked={dry}
              onCheckedChange={(v) => setDry(v === true)}
            />
            <Label htmlFor="dry">
              Dry run{" "}
              <span className="font-normal text-muted-foreground">
                (don&apos;t post on GitHub)
              </span>
            </Label>
          </div>
          <Button
            className="ml-auto"
            loading={starting === "all"}
            disabled={start.busy || anyRunning}
            onClick={() => runRepos()}>
            <Play />
            {anyRunning
              ? "Running…"
              : `Check all ${f.repos.length} repo${f.repos.length === 1 ? "" : "s"}`}
          </Button>
        </CardContent>
      </Card>
      <ErrorText error={del.error} />

      <div className="space-y-4">
        {f.repos.map((r) => (
          <RepoCard
            key={r.id}
            fr={r}
            busy={start.busy}
            starting={starting === r.repo_id}
            onRun={() => runRepos([r.repo_id])}
          />
        ))}
      </div>
    </Shell>
  );
}

function RepoCard({
  fr,
  busy,
  starting,
  onRun,
}: {
  fr: FeatureRepo;
  busy: boolean;
  starting: boolean;
  onRun: () => void;
}) {
  const run = fr.latest_run;
  const [open, setOpen] = useState(false);
  const state = runState(run);
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Chip>{fr.role || "no role"}</Chip>
              <span className="font-mono text-sm">{fr.full_name}</span>
              <StatusBadge
                state={state}
                label={
                  run?.verdict === "changes_requested"
                    ? "changes requested"
                    : undefined
                }
              />
              {run && (
                <span className="font-mono text-xs text-muted-foreground">
                  {timeAgo(run.updated_at)}
                  {run.dry_run ? " · dry" : ""}
                </span>
              )}
            </div>
            <a
              href={fr.pr_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate font-mono text-xs text-info hover:underline">
              {fr.pr_url}
            </a>
          </div>
          <div className="flex gap-2">
            {run?.review_url && (
              <Button asChild size="sm" variant="outline">
                <a href={run.review_url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Review on GitHub
                </a>
              </Button>
            )}
            {run && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen(!open)}>
                {open ? "Hide details" : "Details"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              loading={starting}
              disabled={busy || inFlight(run?.status)}
              onClick={onRun}>
              {run ? <RotateCw /> : <Play />}
              {run ? "Re-run" : "Run"}
            </Button>
          </div>
        </div>
        {fr.requirements && (
          <div className="mt-3 space-y-1 text-sm">
            <Eyebrow>Requirements for this repo</Eyebrow>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {fr.requirements}
            </p>
          </div>
        )}
        {run?.error && (
          <pre className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
            {run.error}
          </pre>
        )}
        {run && open && <RunDetails runId={run.id} />}
      </CardContent>
    </Card>
  );
}

const CRITERION_ICON = { pass: "✓", fail: "✗", unverified: "?" } as const;
const CRITERION_STYLE = {
  pass: "text-success",
  fail: "text-destructive",
  unverified: "text-warning",
} as const;
const SEVERITY_STYLE: Record<Finding["severity"], string> = {
  blocker: "text-destructive border-destructive/40",
  major: "text-destructive border-destructive/30",
  minor: "text-warning border-warning/30",
  nit: "text-muted-foreground border-border",
};
const CHECK_STYLE = {
  pass: "text-success",
  fail: "text-destructive",
  skipped: "text-muted-foreground",
} as const;
const CHECK_ICON = { pass: "✓", fail: "✗", skipped: "–" } as const;

/** Built-in checks get their own group; everything else is one list. */
function groupFindings(findings: Finding[]): [string, Finding[]][] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.rule?.startsWith("builtin:")
      ? checkTitle(f.rule)
      : "Review findings";
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.entries()];
}

function RunDetails({ runId }: { runId: string }) {
  const { data: run, error } = useApi<RunDetail>(
    () => api.run(runId),
    runId,
    (r) => inFlight(r.status),
  );
  if (!run) {
    return error ? (
      <ErrorText error={error} />
    ) : (
      <div className="mt-4 space-y-3 border-t border-border pt-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const res = run.result;
  return (
    <>
      <Separator className="my-4" />
      <div className="space-y-4">
        {res?.summary && <p className="text-sm">{res.summary}</p>}
        {!!res?.criteria?.length && (
          <div className="space-y-2">
            <Eyebrow>Acceptance criteria</Eyebrow>
            <ul className="space-y-1.5 text-sm">
              {res.criteria.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className={cn("font-mono", CRITERION_STYLE[c.status])}>
                    {CRITERION_ICON[c.status]}
                  </span>
                  <span>
                    {c.text}
                    {c.evidence && (
                      <span className="block text-xs text-muted-foreground">
                        {c.evidence}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!res?.checks?.length && (
          <div className="space-y-2">
            <Eyebrow>Built-in checks</Eyebrow>
            <ul className="space-y-1 text-sm">
              {res.checks.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <span className={cn("font-mono", CHECK_STYLE[c.status])}>
                    {CHECK_ICON[c.status]}
                  </span>
                  <span>
                    {checkTitle(c.id)}
                    {c.note && (
                      <span className="text-muted-foreground"> · {c.note}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {groupFindings(res?.findings ?? []).map(([title, items]) => (
          <div key={title} className="space-y-2">
            <Eyebrow>{title}</Eyebrow>
            <ul className="space-y-1.5 text-sm">
              {items.map((f, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={cn(
                      "rounded border px-1.5 font-mono text-xs",
                      SEVERITY_STYLE[f.severity],
                    )}>
                    {f.severity}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {f.path}:{f.line}
                  </span>
                  <span>{f.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!!res?.gates?.length && (
          <div className="space-y-2">
            <Eyebrow>Gates</Eyebrow>
            <ul className="space-y-1 font-mono text-xs">
              {res.gates.map((g, i) => (
                <li
                  key={i}
                  className={g.ok ? "text-success" : "text-destructive"}>
                  {g.ok ? "✓" : "✗"} {g.cmd}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-2">
          <Eyebrow>Log{run.llm_used ? ` · ${run.llm_used}` : ""}</Eyebrow>
          <ol className="max-h-64 space-y-0.5 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
            {run.events.map((e, i) => (
              <li
                key={i}
                className={
                  e.level === "error"
                    ? "text-destructive"
                    : e.level === "warn"
                      ? "text-warning"
                      : "text-muted-foreground"
                }>
                {new Date(e.ts).toLocaleTimeString()} {e.message}
              </li>
            ))}
            {run.events.length === 0 && (
              <li className="text-muted-foreground">
                {inFlight(run.status) ? "waiting for the runner…" : "no log"}
              </li>
            )}
          </ol>
        </div>
      </div>
    </>
  );
}
