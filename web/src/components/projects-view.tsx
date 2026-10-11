"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorText, Modal, Shell, StatusBadge, useAction, useApi } from "@/components/ui-kit";
import { api } from "@/lib/client";
import { runState } from "@/lib/status";

export function ProjectsView() {
  const projects = useApi(api.projects, "projects");
  const stats = useApi(api.stats, "stats", (s) => s.queued > 0);
  const [open, setOpen] = useState(false);

  const tiles = [
    { label: "Projects", value: stats.data?.projects },
    { label: "In queue", value: stats.data?.queued },
    { label: "Failed", value: stats.data?.failed },
    { label: "Done", value: stats.data?.done },
  ];

  return (
    <Shell>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <p className="font-mono text-xs tracking-widest text-primary uppercase">Dashboard</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Projects</h1>
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          + New project
        </button>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="panel p-4">
            <p className="font-mono text-xs text-muted-foreground uppercase">{t.label}</p>
            <p className="mt-2 text-3xl font-semibold">{t.value ?? "–"}</p>
          </div>
        ))}
      </div>

      <ErrorText error={projects.error} />
      {projects.data?.length === 0 ? (
        <div className="panel p-12 text-center text-muted-foreground">
          No projects yet. Create one, add its repos, then create a feature to check.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.data?.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="panel group p-5 transition-colors hover:border-primary/50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold group-hover:text-primary">{p.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{p.description || "—"}</p>
                </div>
                {p.latest_status && (
                  <StatusBadge state={runState({ status: p.latest_status, verdict: p.latest_verdict ?? "" })} />
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {p.repos.map((r) => (
                  <span key={r.id} className="chip" title={r.full_name}>
                    {r.role || r.full_name.split("/")[1]}
                  </span>
                ))}
                {p.repos.length === 0 && <span className="font-mono text-xs text-muted-foreground">no repos</span>}
              </div>
              <p className="mt-4 font-mono text-xs text-muted-foreground">
                {p.feature_count} features · {p.run_count} review runs
              </p>
            </Link>
          ))}
        </div>
      )}

      <NewProjectModal open={open} onClose={() => setOpen(false)} />
    </Shell>
  );
}

function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const action = useAction();
  return (
    <Modal open={open} onClose={onClose} title="New project">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            const { id } = await api.createProject({ name: name.trim(), description: description.trim() });
            router.push(`/projects/${id}`);
          });
        }}>
        <div>
          <label className="label" htmlFor="p-name">Name</label>
          <input id="p-name" className="field" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Checkout Platform" autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="p-desc">Description</label>
          <textarea id="p-desc" className="field min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the product does. The agent reads this as context." />
        </div>
        <ErrorText error={action.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={action.busy}>Create</button>
        </div>
      </form>
    </Modal>
  );
}
