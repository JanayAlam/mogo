"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "nextjs-toploader/app";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ProjectCardsSkeleton } from "@/components/skeletons";
import {
  Chip,
  ErrorText,
  Eyebrow,
  Field,
  Modal,
  Shell,
  StatusBadge,
  useAction,
  useApi,
} from "@/components/ui-kit";
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
          <Eyebrow className="tracking-widest text-primary">Dashboard</Eyebrow>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Projects
          </h1>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus /> New project
        </Button>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <Eyebrow>{t.label}</Eyebrow>
              {t.value === undefined ? (
                <Skeleton className="mt-3 h-8 w-12" />
              ) : (
                <p className="mt-2 text-3xl font-semibold">{t.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <ErrorText error={projects.error} />
      {!projects.data && !projects.error && <ProjectCardsSkeleton />}
      {projects.data?.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            No projects yet. Create one, add its repos, then create a feature
            to check.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.data?.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold group-hover:text-primary">
                        {p.name}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {p.description || "—"}
                      </p>
                    </div>
                    {p.latest_status && (
                      <StatusBadge
                        state={runState({
                          status: p.latest_status,
                          verdict: p.latest_verdict ?? "",
                        })}
                      />
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {p.repos.map((r) => (
                      <Chip key={r.id} title={r.full_name}>
                        {r.role || r.full_name.split("/")[1]}
                      </Chip>
                    ))}
                    {p.repos.length === 0 && (
                      <span className="font-mono text-xs text-muted-foreground">
                        no repos
                      </span>
                    )}
                  </div>
                  <p className="mt-4 font-mono text-xs text-muted-foreground">
                    {p.feature_count} features · {p.run_count} review runs
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <NewProjectModal open={open} onClose={() => setOpen(false)} />
    </Shell>
  );
}

function NewProjectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const action = useAction();
  // Pages stay mounted in the background after navigating away, so the dialog must clear itself.
  const close = () => {
    setName("");
    setDescription("");
    action.setError("");
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="New project"
      description="A product and the repos that make it up.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            const { id } = await api.createProject({
              name: name.trim(),
              description: description.trim(),
            });
            close();
            router.push(`/projects/${id}`);
          });
        }}>
        <Field label="Name" htmlFor="p-name">
          <Input
            id="p-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Checkout Platform"
            autoFocus
          />
        </Field>
        <Field
          label="Description"
          htmlFor="p-desc"
          hint="What the product does. The agent reads this as context.">
          <Textarea
            id="p-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <ErrorText error={action.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button loading={action.busy}>Create</Button>
        </div>
      </form>
    </Modal>
  );
}
