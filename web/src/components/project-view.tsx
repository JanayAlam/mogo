"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ItemCardsSkeleton, ProjectSkeleton } from "@/components/skeletons";
import {
  BackLink,
  Chip,
  ConfirmButton,
  ErrorText,
  Eyebrow,
  Field,
  Modal,
  Shell,
  StatusBadge,
  timeAgo,
  useAction,
  useApi,
} from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BUILTIN_CHECKS, checkEnabled } from "@/lib/checks";
import { api, type InstalledRepo, type Project } from "@/lib/client";
import { useConnectGitHub } from "@/lib/github-connect";
import { useGitHub } from "@/lib/github-store";
import { ROLE_SUGGESTIONS } from "@/lib/repo-form";
import { type ReviewState, runState } from "@/lib/status";

type Tab = "all" | "queue" | "failed" | "done";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "queue", label: "Queue" },
  { id: "failed", label: "Failed" },
  { id: "done", label: "Done" },
];

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
  // Learn whether GitHub is connected while the page is read, so "Add repository" opens with the answer ready.
  const loadGitHub = useGitHub((s) => s.load);
  useEffect(() => {
    void loadGitHub();
  }, [loadGitHub]);

  const p = project.data;
  if (!p) {
    return (
      <Shell>
        <ErrorText error={project.error} />
        {!project.error && <ProjectSkeleton />}
      </Shell>
    );
  }

  const all = features.data ?? [];
  const shown = all.filter((f) => inTab(tab, f.state));

  return (
    <Shell>
      <BackLink href="/">Back to projects</BackLink>
      <div className="mt-3 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{p.name}</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">{p.description}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <ConfirmButton
            variant="outline"
            loading={del.busy}
            title={`Delete ${p.name}?`}
            description="Its repos, features, secrets and run history are deleted too. This cannot be undone."
            onConfirm={() =>
              del.run(async () => {
                await api.deleteProject(p.id);
                router.push("/");
              })
            }
          >
            Delete
          </ConfirmButton>
          {p.repos.length === 0 ? (
            <Button disabled>
              <Plus /> New feature
            </Button>
          ) : (
            <Button asChild>
              <Link href={`/projects/${p.id}/features/new`}>
                <Plus /> New feature
              </Link>
            </Button>
          )}
        </div>
      </div>
      <ErrorText error={del.error} />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <Eyebrow>Repositories</Eyebrow>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 font-mono text-xs"
                onClick={() => setRepoOpen(true)}
              >
                + add
              </Button>
            </div>
            <ul className="space-y-1">
              {p.repos.map((r) => (
                <li key={r.id}>
                  <Link href={`/projects/${p.id}/repos/${r.id}`} className="block rounded-md px-2 py-2 hover:bg-accent">
                    <p className="truncate font-mono text-sm" title={r.full_name}>
                      {r.full_name}
                    </p>
                    <div className="mt-1 flex items-center gap-2 truncate text-xs text-muted-foreground">
                      <Chip>{r.role || "no role"}</Chip>
                      {r.default_branch} ·{" "}
                      {r.profile?.main_sha ? `learned ${timeAgo(r.profile.built_at)}` : "not learned yet"}
                      {r.profile?.error && (
                        <span className="text-warning" title={r.profile.error}>
                          · update failed
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
              {p.repos.length === 0 && (
                <li className="px-2 py-3 text-sm text-muted-foreground">
                  Add the project&apos;s repos to start creating features.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        <section>
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    {all.filter((f) => inTab(t.id, f.state)).length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <ErrorText error={features.error} />
          {!features.data && !features.error && <ItemCardsSkeleton />}
          <div className="space-y-2">
            {shown.map((f) => (
              <Link key={f.id} href={`/projects/${p.id}/features/${f.id}`} className="group block">
                <Card className="transition-colors group-hover:border-primary/50">
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge state={f.state} />
                      <span className="font-mono text-xs text-muted-foreground">{timeAgo(f.updated_at)}</span>
                    </div>
                    <h3 className="mt-2 font-medium">{f.title}</h3>
                    {f.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{f.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {f.repos.map((r) => (
                        <span key={r.id} className="inline-flex items-center gap-1.5">
                          <Chip>
                            {r.role || r.full_name.split("/")[1]} #{r.pr_number}
                          </Chip>
                          <StatusBadge state={runState(r.latest_run)} />
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {features.data && shown.length === 0 && (
              <Card>
                <CardContent className="p-10 text-center text-sm text-muted-foreground">
                  {all.length === 0 ? "No features yet. Create one to have its PRs checked." : "Nothing here."}
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      </div>

      <AddRepoModal
        open={repoOpen}
        onClose={() => setRepoOpen(false)}
        projectId={p.id}
        existing={p.repos.map((r) => r.full_name)}
        onAdded={(rid, learning) => router.push(`/projects/${p.id}/repos/${rid}${learning ? "?learning=1" : ""}`)}
      />
      <EditProjectModal
        key={editOpen ? "open" : "closed"}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        project={p}
        onSaved={project.reload}
      />
    </Shell>
  );
}

/**
 * Add a repo of the Mogo App's installations. Opens at once with what the GitHub store already knows and refreshes
 * it in the background: known not connected -> Connect GitHub; otherwise the form, whose list fills in when it
 * arrives (and the dialog switches to Connect GitHub if the answer is "not connected"). Only mounted while open,
 * so every opening starts with an empty form.
 */
function AddRepoModal({
  open,
  onClose,
  projectId,
  existing,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  existing: string[]; // full names already in this project
  onAdded: (id: string, learning: boolean) => void;
}) {
  return open ? <AddRepoFlow onClose={onClose} projectId={projectId} existing={existing} onAdded={onAdded} /> : null;
}

function AddRepoFlow({
  onClose,
  projectId,
  existing,
  onAdded,
}: {
  onClose: () => void;
  projectId: string;
  existing: string[];
  onAdded: (id: string, learning: boolean) => void;
}) {
  const connected = useGitHub((s) => s.connected);
  const repos = useGitHub((s) => s.repos);
  const error = useGitHub((s) => s.error);
  const load = useGitHub((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  const returnTo = `/projects/${projectId}`;
  if (connected === false) return <ConnectGitHubModal returnTo={returnTo} onClose={onClose} />;

  const taken = new Set(existing.map((n) => n.toLowerCase()));
  // null = nothing known yet: the form shows it is loading
  const available = connected === null ? null : repos.filter((r) => !taken.has(r.full_name.toLowerCase()));
  return (
    <AddRepoForm
      projectId={projectId}
      returnTo={returnTo}
      available={available}
      listError={connected === null ? error : ""}
      onClose={onClose}
      onAdded={onAdded}
    />
  );
}

function ConnectGitHubModal({ returnTo, onClose }: { returnTo: string; onClose: () => void }) {
  const connect = useConnectGitHub(returnTo);
  return (
    <Modal
      open
      onClose={onClose}
      title="Connect GitHub"
      description="Mogo reads pull requests and posts its reviews through its GitHub App. Install the App on the repos you want to review, then come back to add them."
    >
      {connect.waiting && (
        <p className="text-sm text-muted-foreground">
          Finish in the GitHub window. This dialog updates when you are done.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" loading={connect.waiting} onClick={connect.open}>
          Connect GitHub
        </Button>
      </div>
    </Modal>
  );
}

function AddRepoForm({
  projectId,
  returnTo,
  available,
  listError,
  onClose,
  onAdded,
}: {
  projectId: string;
  returnTo: string; // where a full-page GitHub round trip comes back to
  available: InstalledRepo[] | null; // null while loading
  listError: string;
  onClose: () => void;
  onAdded: (id: string, learning: boolean) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [branch, setBranch] = useState("main");
  const action = useAction();
  const connect = useConnectGitHub(returnTo);
  const pick = (name: string) => {
    setFullName(name);
    const r = available?.find((x) => x.full_name === name);
    if (r) setBranch(r.default_branch);
  };
  const none = available?.length === 0;
  const placeholder = listError ? "Could not load your repos" : available === null ? "Loading your repos…" : none ? "No repo available" : "Select a repository";
  return (
    <Modal
      open
      onClose={onClose}
      title="Add repository"
      description="Repos where you installed the Mogo GitHub App. Settings are read from the source branch and suggested on the next screen."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            const { id, learning } = await api.addRepo(projectId, {
              full_name: fullName,
              role: role.trim(),
              default_branch: branch.trim() || "main",
            });
            onClose();
            onAdded(id, learning);
          });
        }}
      >
        <Field
          label="Repository"
          htmlFor="r-name"
          hint={
            <>
              {listError || (none ? "Every repo Mogo can see is already in this project, or none is installed. " : "")}
              <button type="button" className="underline underline-offset-2" onClick={connect.open}>
                {connect.waiting ? "Waiting for GitHub…" : "Install Mogo on more repos"}
              </button>
            </>
          }
        >
          <Select value={fullName} onValueChange={pick} disabled={!available?.length}>
            <SelectTrigger id="r-name" className="font-mono">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {available?.map((r) => (
                <SelectItem key={r.full_name} value={r.full_name} className="font-mono">
                  {r.full_name}
                  <span className="ml-2 font-sans text-xs text-muted-foreground">{r.private ? "private" : "public"}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" htmlFor="r-role">
            <RoleInput id="r-role" value={role} onChange={setRole} />
          </Field>
          <Field label="Source of truth branch" htmlFor="r-branch">
            <Input id="r-branch" className="font-mono" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </Field>
        </div>
        <ErrorText error={action.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={action.busy} disabled={!fullName}>
            Add repo
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function RoleInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Input
        id={id}
        list={`${id}-roles`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="backend, frontend, admin-frontend…"
      />
      <datalist id={`${id}-roles`}>
        {ROLE_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </>
  );
}

function EditProjectModal({
  open,
  onClose,
  project,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  onSaved: () => void;
}) {
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
            toast.success("Project saved");
          });
        }}
      >
        <Field label="Name" htmlFor="e-name">
          <Input id="e-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="e-desc">
          <Textarea
            id="e-desc"
            className="min-h-24"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-medium">Built-in checks</legend>
          {BUILTIN_CHECKS.map((c) => (
            <div key={c.id} className="flex items-start gap-3">
              <Checkbox
                id={`check-${c.id}`}
                className="mt-0.5"
                checked={checks[c.id]}
                onCheckedChange={(v) => setChecks({ ...checks, [c.id]: v === true })}
              />
              <Label htmlFor={`check-${c.id}`} className="leading-snug">
                {c.title}
                <span className="mt-1 block text-xs font-normal text-muted-foreground">{c.description}</span>
              </Label>
            </div>
          ))}
        </fieldset>
        <ErrorText error={action.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={action.busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
