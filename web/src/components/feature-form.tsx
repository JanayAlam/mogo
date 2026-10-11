"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorText, Shell, useAction, useApi } from "@/components/ui-kit";
import { api, type Feature, type Project } from "@/lib/client";

/** /projects/[id]/features/new and /projects/[id]/features/[featureId]/edit */
export function FeatureFormPage() {
  const { id, featureId } = useParams<{ id: string; featureId?: string }>();
  const project = useApi(() => api.project(id), id);
  const feature = useApi(() => (featureId ? api.feature(featureId) : Promise.resolve(null)), featureId ?? "new");
  const back = featureId ? `/projects/${id}/features/${featureId}` : `/projects/${id}`;
  const ready = project.data && (!featureId || feature.data);
  return (
    <Shell>
      <Link href={back} className="font-mono text-xs text-muted-foreground hover:text-foreground">← back</Link>
      <ErrorText error={project.error || feature.error} />
      {ready && <FeatureForm project={project.data!} feature={feature.data} />}
    </Shell>
  );
}

interface Entry {
  included: boolean;
  pr_url: string;
  requirements: string;
}

function FeatureForm({ project, feature }: { project: Project; feature: Feature | null }) {
  const router = useRouter();
  const [title, setTitle] = useState(feature?.title ?? "");
  const [description, setDescription] = useState(feature?.description ?? "");
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      project.repos.map((r) => {
        const fr = feature?.repos.find((x) => x.repo_id === r.id);
        return [r.id, { included: !!fr || (!feature && project.repos.length === 1), pr_url: fr?.pr_url ?? "", requirements: fr?.requirements ?? "" }];
      }),
    ),
  );
  const action = useAction();
  const patch = (repoId: string, p: Partial<Entry>) => setEntries((e) => ({ ...e, [repoId]: { ...e[repoId], ...p } }));
  const dropped = feature?.repos.filter((r) => !entries[r.repo_id]?.included && r.latest_run) ?? [];

  return (
    <form
      className="mt-3 space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const repos = project.repos
          .filter((r) => entries[r.id].included)
          .map((r) => ({ repo_id: r.id, pr_url: entries[r.id].pr_url.trim(), requirements: entries[r.id].requirements.trim() }));
        if (repos.length === 0) return action.setError("Pick at least one repo and give its PR link.");
        if (dropped.length && !confirm(`Removing ${dropped.map((r) => r.full_name).join(", ")} deletes their run history. Continue?`)) return;
        const body = { title: title.trim(), description: description.trim(), repos };
        action.run(async () => {
          const fid = feature ? (await api.updateFeature(feature.id, body), feature.id) : (await api.createFeature(project.id, body)).id;
          router.push(`/projects/${project.id}/features/${fid}`);
        });
      }}>
      <div>
        <p className="font-mono text-xs tracking-widest text-primary uppercase">{project.name}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{feature ? "Edit feature" : "New feature"}</h1>
      </div>

      <section className="panel space-y-4 p-5">
        <div>
          <label className="label" htmlFor="f-title">Feature name</label>
          <input id="f-title" className="field" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Refund an order" autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="f-desc">What the feature does</label>
          <textarea
            id="f-desc"
            className="field min-h-32"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Users can refund a paid order from the order page. The refund is idempotent, an order can be refunded once…"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The agent turns this into acceptance criteria for each repo, read through the repo&apos;s role.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Repos and pull requests</h2>
          <p className="text-sm text-muted-foreground">
            Tick each repo the feature touches. Built-in checks (no duplicate types, file and folder conventions learned from the
            source branch) always run.
          </p>
        </div>
        {project.repos.map((r) => {
          const e = entries[r.id];
          return (
            <div key={r.id} className={`panel p-4 ${e.included ? "border-primary/40" : ""}`}>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" checked={e.included} onChange={(ev) => patch(r.id, { included: ev.target.checked })} />
                <span className="chip">{r.role || "no role"}</span>
                <span className="font-mono text-sm">{r.full_name}</span>
              </label>
              {e.included && (
                <div className="mt-4 grid gap-4">
                  <div>
                    <label className="label" htmlFor={`pr-${r.id}`}>PR link *</label>
                    <input id={`pr-${r.id}`} className="field font-mono" required value={e.pr_url} onChange={(ev) => patch(r.id, { pr_url: ev.target.value })} placeholder={`https://github.com/${r.full_name}/pull/123`} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`req-${r.id}`}>Requirements for this repo (optional)</label>
                    <textarea id={`req-${r.id}`} className="field min-h-20" value={e.requirements} onChange={(ev) => patch(r.id, { requirements: ev.target.value })} placeholder={`What to check in ${r.role || "this repo"} in particular: endpoints, screens, edge cases…`} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <ErrorText error={action.error} />
      <div className="flex justify-end gap-2">
        <button className="btn-primary" disabled={action.busy}>{feature ? "Save" : "Create feature"}</button>
      </div>
    </form>
  );
}
