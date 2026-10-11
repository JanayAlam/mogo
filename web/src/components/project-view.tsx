"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorText, Modal, Shell, StatusBadge, timeAgo, useAction, useApi } from "@/components/ui-kit";
import { api, type Project } from "@/lib/client";
import { BUILTIN_CHECKS, checkEnabled } from "@/lib/checks";
import { ROLE_SUGGESTIONS } from "@/lib/repo-form";
import { type ReviewState, runState } from "@/lib/status";

type Tab = "all" | "queue" | "failed" | "done";
const inTab = (tab: Tab, s: ReviewState) =>
  tab === "all" || (tab === "queue" && (s === "queued" || s === "running")) || tab === s;

export function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const project = useApi(() => api.project(id), id);
  const features = useApi(
    () => api.features(id),
    id,
    (fs) => fs.some((f) => f.state === "queued" || f.state === "running"),
  );
  const [tab, setTab] = useState<Tab>("all");
  const [repoOpen, setRepoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const del = useAction();

  const p = project.data;
  if (!p) {
    return (
      <Shell>
        <ErrorText error={project.error} />
        {!project.error && <p className="text-muted-foreground">Loading…</p>}
      </Shell>
    );
  }

  const all = features.data ?? [];
  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "queue", label: "Queue" },
    { id: "failed", label: "Failed" },
    { id: "done", label: "Done" },
  ];
  const shown = all.filter((f) => inTab(tab, f.state));

  return (
    <Shell>
      <Link href="/" className="font-mono text-xs text-muted-foreground hover:text-foreground">← projects</Link>
      <div className="mt-3 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{p.name}</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">{p.description}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setEditOpen(true)}>Edit</button>
          <button
            className="btn-ghost"
            disabled={del.busy}
            onClick={() => {
              if (!confirm(`Delete ${p.name} with its repos, features and run history?`)) return;
              del.run(async () => {
                await api.deleteProject(p.id);
                router.push("/");
              });
            }}>
            Delete
          </button>
          <Link
            href={`/projects/${p.id}/features/new`}
            className={`btn-primary ${p.repos.length === 0 ? "pointer-events-none opacity-50" : ""}`}
            aria-disabled={p.repos.length === 0}>
            + New feature
          </Link>
        </div>
      </div>
      <ErrorText error={del.error} />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="panel h-fit p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-xs tracking-wider text-muted-foreground uppercase">Repositories</h2>
            <button className="font-mono text-xs text-primary hover:underline" onClick={() => setRepoOpen(true)}>+ add</button>
          </div>
          <ul className="space-y-1">
            {p.repos.map((r) => (
              <li key={r.id}>
                <Link href={`/projects/${p.id}/repos/${r.id}`} className="block rounded-md px-2 py-2 hover:bg-accent">
                  <p className="truncate font-mono text-sm" title={r.full_name}>{r.full_name}</p>
                  <p className="mt-1 flex items-center gap-2 truncate text-xs text-muted-foreground">
                    <span className="chip">{r.role || "no role"}</span>
                    {r.default_branch} ·{" "}
                    {r.profile?.main_sha ? `learned @ ${r.profile.main_sha.slice(0, 7)} · ${timeAgo(r.profile.built_at)}` : "not learned yet"}
                    {r.profile?.error && <span className="text-warning" title={r.profile.error}> · last update failed</span>}
                  </p>
                </Link>
              </li>
            ))}
            {p.repos.length === 0 && (
              <li className="px-2 py-3 text-sm text-muted-foreground">Add the project&apos;s repos to start creating features.</li>
            )}
          </ul>
        </aside>

        <section>
          <div className="mb-4 flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t.label}{" "}
                <span className="ml-1 font-mono text-xs text-muted-foreground">
                  {all.filter((f) => inTab(t.id, f.state)).length}
                </span>
              </button>
            ))}
          </div>
          <ErrorText error={features.error} />
          <div className="space-y-2">
            {shown.map((f) => (
              <Link key={f.id} href={`/projects/${p.id}/features/${f.id}`} className="panel block p-4 transition-colors hover:border-primary/50">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge state={f.state} />
                  <span className="font-mono text-xs text-muted-foreground">{timeAgo(f.updated_at)}</span>
                </div>
                <h3 className="mt-2 font-medium">{f.title}</h3>
                {f.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{f.description}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {f.repos.map((r) => (
                    <span key={r.id} className="inline-flex items-center gap-1.5">
                      <span className="chip">{r.role || r.full_name.split("/")[1]} #{r.pr_number}</span>
                      <StatusBadge state={runState(r.latest_run)} />
                    </span>
                  ))}
                </div>
              </Link>
            ))}
            {features.data && shown.length === 0 && (
              <div className="panel p-10 text-center text-sm text-muted-foreground">
                {all.length === 0 ? "No features yet. Create one to have its PRs checked." : "Nothing here."}
              </div>
            )}
          </div>
        </section>
      </div>

      <AddRepoModal open={repoOpen} onClose={() => setRepoOpen(false)} projectId={p.id} onAdded={(rid) => router.push(`/projects/${p.id}/repos/${rid}`)} />
      <EditProjectModal open={editOpen} onClose={() => setEditOpen(false)} project={p} onSaved={project.reload} />
    </Shell>
  );
}

function AddRepoModal({ open, onClose, projectId, onAdded }: { open: boolean; onClose: () => void; projectId: string; onAdded: (id: string) => void }) {
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [branch, setBranch] = useState("main");
  const action = useAction();
  return (
    <Modal open={open} onClose={onClose} title="Add repository">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            const { id } = await api.addRepo(projectId, { full_name: fullName.trim(), role: role.trim(), default_branch: branch.trim() || "main" });
            onAdded(id);
          });
        }}>
        <div>
          <label className="label" htmlFor="r-name">Repository</label>
          <input id="r-name" className="field font-mono" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="org/repo or https://github.com/org/repo" autoFocus />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="r-role">Role</label>
            <RoleInput id="r-role" value={role} onChange={setRole} />
          </div>
          <div>
            <label className="label" htmlFor="r-branch">Source of truth branch</label>
            <input id="r-branch" className="field font-mono" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Commands, env and test notes are set on the next screen.</p>
        <ErrorText error={action.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={action.busy}>Add repo</button>
        </div>
      </form>
    </Modal>
  );
}

export function RoleInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input id={id} className="field" list={`${id}-roles`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="backend, frontend, admin-frontend…" />
      <datalist id={`${id}-roles`}>
        {ROLE_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </>
  );
}

function EditProjectModal({ open, onClose, project, onSaved }: { open: boolean; onClose: () => void; project: Project; onSaved: () => void }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BUILTIN_CHECKS.map((c) => [c.id, checkEnabled(project.settings, c.id)])),
  );
  const action = useAction();
  return (
    <Modal open={open} onClose={onClose} title="Edit project">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            await api.updateProject(project.id, {
              name: name.trim(),
              description: description.trim(),
              settings: { ...project.settings, checks },
            });
            onSaved();
            onClose();
          });
        }}>
        <div>
          <label className="label" htmlFor="e-name">Name</label>
          <input id="e-name" className="field" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="e-desc">Description</label>
          <textarea id="e-desc" className="field min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <fieldset>
          <legend className="label">Built-in checks</legend>
          <div className="space-y-2">
            {BUILTIN_CHECKS.map((c) => (
              <label key={c.id} className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1" checked={checks[c.id]} onChange={(e) => setChecks({ ...checks, [c.id]: e.target.checked })} />
                <span>
                  {c.title}
                  <span className="block text-xs text-muted-foreground">{c.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorText error={action.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={action.busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
