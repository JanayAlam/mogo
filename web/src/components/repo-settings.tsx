"use client";

import { FileUp, Lock, Pencil, Plus, RefreshCw } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { RoleInput } from "@/components/project-view";
import { FormSkeleton, ListSkeleton } from "@/components/skeletons";
import {
  BackLink,
  Chip,
  ConfirmButton,
  ErrorText,
  Eyebrow,
  Field,
  Modal,
  Shell,
  errorMessage,
  timeAgo,
  useAction,
  useApi,
} from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, type Repo } from "@/lib/client";
import { looksSensitive, parseEnv } from "@/lib/dotenv";
import type { EnvVarInfo } from "@/lib/env";
import { AgentNotesCard } from "@/components/agent-notes";
import { RunProjectCard } from "@/components/repo-run-config";
import {
  configToForm,
  formError,
  formToConfig,
  legacyEnvFrom,
  type ConfigForm,
} from "@/lib/repo-form";

const noSubscribe = () => () => {};

export function RepoSettings() {
  const { id, repoId } = useParams<{ id: string; repoId: string }>();
  const search = useSearchParams();
  // built_at|error of the profile when learning started; "|" = none yet (the repo was just added)
  const [waiting, setWaiting] = useState<string | null>(() => (search.get("learning") ? "|" : null));
  const stamp = (r: Repo) => `${r.profile?.built_at ?? ""}|${r.profile?.error ?? ""}`;
  const repo = useApi(
    () => api.repo(repoId),
    repoId,
    (r) => waiting !== null && stamp(r) === waiting,
  );
  const learning = waiting !== null && !!repo.data && stamp(repo.data) === waiting;

  // Reads the Dockerfile, Compose files and .env.example from GitHub (no runner) and refreshes the suggestions.
  const read = async () => {
    try {
      await api.detectRepo(repoId);
      repo.reload();
    } catch (e) {
      // from a dropdown menu: nothing around it shows the error, so say it here
      toast.error("Could not read the repo from GitHub", { description: errorMessage(e) });
    }
  };
  // A repo whose profile has no Docker file list (added before they were read, or not learned yet) is read once on
  // opening, so its dropdown is there without anyone asking. A failure stays quiet: the dropdown offers it.
  const autoRead = useRef<string | null>(null);
  const reload = repo.reload;
  useEffect(() => {
    const r = repo.data;
    if (!r || autoRead.current === r.id || r.profile?.suggestions?.convention_files !== undefined) return;
    autoRead.current = r.id;
    api.detectRepo(r.id).then(reload, () => {});
  }, [repo.data, reload]);

  return (
    <Shell>
      <BackLink href={`/projects/${id}`}>Back to project</BackLink>
      <ErrorText error={repo.error} />
      {!repo.data && !repo.error && <FormSkeleton sections={4} />}
      {repo.data && (
        <>
          <RepoForm
            // The page stays mounted while you are elsewhere and refetches when you come back; a form keeps the state it
            // was built with. Keyed by the last save, it is built again from the saved settings whenever they changed.
            key={`${repo.data.id}:${repo.data.updated_at}`}
            repo={repo.data}
            projectId={id}
            onSaved={repo.reload}
            onRead={read}
          />
          <EnvPanel repoId={repo.data.id} />
          <ProfilePanel
            repo={repo.data}
            waiting={learning}
            onRelearn={() => {
              setWaiting(stamp(repo.data!));
              repo.reload();
            }}
          />
        </>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------------ settings form

function RepoForm({
  repo,
  projectId,
  onSaved,
  onRead,
}: {
  repo: Repo;
  projectId: string;
  onSaved: () => void;
  onRead: () => Promise<void>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // Last saved state: "Discard" goes back to it, and changes are measured against it.
  const [base, setBase] = useState(() => ({
    role: repo.role,
    branch: repo.default_branch,
    form: configToForm(repo.config),
  }));
  const [role, setRole] = useState(base.role);
  const [branch, setBranch] = useState(base.branch);
  const [rawForm, setForm] = useState<ConfigForm>(base.form);
  const legacy = legacyEnvFrom(repo.config);
  const suggestions = repo.profile?.suggestions;
  const save = useAction();
  const del = useAction();

  // Convention files never saved for this repo (null): the ones found in it are the starting value, in the saved
  // state too (so it is not a change), and are kept only when the user saves. Editing the list replaces it.
  const detected = suggestions?.convention_files;
  const withDetected = (f: ConfigForm): ConfigForm =>
    f.conventions === null && detected ? { ...f, conventions: detected } : f;
  const form = withDetected(rawForm);
  const saved = withDetected(base.form);

  // Compared as saved, so whitespace-only edits are not changes. Leftover env_from is removed by saving.
  const payload = (r: string, b: string, f: ConfigForm) => ({
    role: r.trim(),
    default_branch: b.trim() || "main",
    config: formToConfig(f),
  });
  const dirty =
    legacy.length > 0 ||
    JSON.stringify(payload(role, branch, form)) !== JSON.stringify(payload(base.role, base.branch, saved));

  // Shortcut label: "Ctrl S" on the server, the platform's own in the browser (no hydration mismatch).
  const shortcut = useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘S" : "Ctrl S"),
    () => "Ctrl S",
  );

  const discard = () => {
    setRole(base.role);
    setBranch(base.branch);
    setForm(base.form);
    save.setError("");
  };

  // Ctrl/Cmd+S saves; leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [dirty]);

  return (
    <form
      ref={formRef}
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = formError(form);
        if (problem) return save.setError(problem);
        save.run(async () => {
          await api.updateRepo(repo.id, payload(role, branch, form));
          setBase({ role, branch, form });
          toast.success("Repo settings saved");
          onSaved();
        });
      }}
    >
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow className="tracking-widest text-primary">Repository</Eyebrow>
          <h1 className="mt-1 font-mono text-2xl font-semibold">{repo.full_name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <ConfirmButton
            type="button"
            variant="outline"
            className="text-destructive hover:text-destructive"
            loading={del.busy}
            title={`Remove ${repo.full_name}?`}
            description="Its feature entries, environment variables and run history are deleted too."
            confirmLabel="Remove"
            onConfirm={() =>
              del.run(async () => {
                await api.deleteRepo(repo.id);
                router.push(`/projects/${projectId}`);
              })
            }
          >
            Remove
          </ConfirmButton>
        </div>
      </div>
      <ErrorText error={del.error} />
      {repo.installation_id === null && (
        <p className="mb-6 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          The Mogo GitHub App no longer covers this repo, so runs cannot read it or post reviews.{" "}
          <a
            className="underline underline-offset-2"
            href={`/api/auth/github/install?next=${encodeURIComponent(`/projects/${projectId}/repos/${repo.id}`)}`}
          >
            Install Mogo on {repo.full_name}
          </a>
        </p>
      )}
      {legacy.length > 0 && (
        <p className="mb-6 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          This repo still lists GitHub Actions secret names (env_from), which are no longer read: {legacy.join(", ")}.
          Add their values under Environment variables below. Saving this form removes the old list.
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <Field label="Role" htmlFor="role" hint="Free text. The agent judges the PR as this kind of repo.">
              <RoleInput id="role" value={role} onChange={setRole} />
            </Field>
            <Field label="Source of truth branch" htmlFor="branch" hint="Settings and conventions are read from here.">
              <Input id="branch" className="font-mono" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <RunProjectCard
          form={form}
          branch={repo.default_branch}
          suggestions={suggestions}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onRead={onRead}
        />

        <AgentNotesCard
          form={form}
          branch={repo.default_branch}
          suggestions={suggestions}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onRead={onRead}
        />
      </div>

      {dirty && (
        <>
          {/* room so the bar never covers the end of the page */}
          <div className="h-20" aria-hidden />
          <div
            role="region"
            aria-label="Unsaved changes"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur animate-in fade-in slide-in-from-bottom-4"
          >
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {legacy.length > 0 ? "Save to remove the old env_from list" : "Unsaved changes"}
                </p>
                {save.error ? (
                  <p className="text-destructive">{save.error}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Repo settings above. Environment variables save on their own.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={discard} disabled={save.busy}>
                  Discard
                </Button>
                <Button loading={save.busy}>
                  Save
                  <kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1 font-mono text-[10px] sm:inline">
                    {shortcut}
                  </kbd>
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </form>
  );
}

// ------------------------------------------------------------------ environment variables

function EnvPanel({ repoId }: { repoId: string }) {
  const list = useApi(() => api.env(repoId), `env-${repoId}`);
  const [editing, setEditing] = useState<EnvVarInfo | "new" | null>(null);
  const [pending, setPending] = useState<string | null>(null); // "toggle:NAME" or "delete:NAME"
  const action = useAction();
  const keyMissing = !!list.data && !list.data.key_configured;
  const track = (key: string, fn: () => Promise<unknown>) => {
    setPending(key);
    return action.run(fn).finally(() => setPending(null));
  };

  return (
    <Card className="mt-6">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
        <div className="max-w-2xl space-y-1.5">
          <CardTitle>Environment variables</CardTitle>
          <CardDescription>
            Only this repo&apos;s commands get them. Sensitive values are encrypted, can&apos;t be shown again (only
            replaced) and are masked in logs and reviews. Use test credentials: the PR&apos;s code can read them.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <EnvImportButton repoId={repoId} vars={list.data?.vars ?? []} onDone={list.reload} />
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus /> Add variable
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {keyMissing && (
          <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            MOGO_SECRET_KEY is not set on the web app, so sensitive variables can&apos;t be saved (plain ones can). Set
            the same key on the web app and as an Actions secret of the runner repo (openssl rand -base64 32).
          </p>
        )}
        <ErrorText error={list.error || action.error} />
        {!list.data && !list.error && <ListSkeleton rows={3} />}
        {list.data && list.data.vars.length > 0 && (
          <div className="divide-y divide-border rounded-md border">
            <div className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_6rem_auto] items-center gap-3 px-3 py-2 text-xs text-muted-foreground">
              <span>Name</span>
              <span>Value</span>
              <span>Sensitive</span>
              <span className="w-40" />
            </div>
            {list.data.vars.map((v) => (
              <div
                key={v.name}
                className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_6rem_auto] items-center gap-3 px-3 py-2"
              >
                <span className="truncate font-mono text-sm" title={v.name}>
                  {v.name}
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground" title={v.value ?? undefined}>
                  {v.sensitive ? `•••••••• · set ${timeAgo(v.updated_at)}` : v.value}
                </span>
                <Switch
                  aria-label={`${v.name} is sensitive`}
                  checked={v.sensitive}
                  disabled={pending === `toggle:${v.name}`}
                  onCheckedChange={(on) => {
                    // a sensitive value can't be revealed: making it plain needs a new value
                    if (!on) return setEditing({ ...v, sensitive: false });
                    track(`toggle:${v.name}`, async () => {
                      await api.setEnvVar(repoId, v.name, { sensitive: true });
                      toast.success(`${v.name} is now sensitive`, {
                        description: "Its value is encrypted and hidden.",
                      });
                      list.reload();
                    });
                  }}
                />
                <span className="flex w-40 justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(v)}>
                    <Pencil /> {v.sensitive ? "Replace" : "Edit"}
                  </Button>
                  <ConfirmButton
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    loading={pending === `delete:${v.name}`}
                    title={`Delete ${v.name}?`}
                    description="Runs of this repo will no longer get this variable."
                    onConfirm={() =>
                      track(`delete:${v.name}`, async () => {
                        await api.deleteEnvVar(repoId, v.name);
                        list.reload();
                      })
                    }
                  >
                    Delete
                  </ConfirmButton>
                </span>
              </div>
            ))}
          </div>
        )}
        {list.data?.vars.length === 0 && (
          <p className="text-sm text-muted-foreground">No variables yet. Import a .env file or add them one by one.</p>
        )}
      </CardContent>
      <EnvVarDialog
        key={editing === "new" ? "new" : editing ? `${editing.name}:${editing.sensitive}` : "closed"}
        repoId={repoId}
        editing={editing}
        keyMissing={keyMissing}
        onClose={() => setEditing(null)}
        onSaved={list.reload}
      />
    </Card>
  );
}

/**
 * Add a variable, or edit / replace one. `editing.sensitive` is the state the dialog opens in; a sensitive one
 * opened as plain (its switch turned off) must get a new value.
 */
function EnvVarDialog({
  repoId,
  editing,
  keyMissing,
  onClose,
  onSaved,
}: {
  repoId: string;
  editing: EnvVarInfo | "new" | null;
  keyMissing: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = editing === "new";
  const current = isNew || !editing ? null : editing;
  // The list sends no value for sensitive variables: the stored one is secret.
  const storedSecret = !!current && current.value === null;
  const [name, setName] = useState(current?.name ?? "");
  const [value, setValue] = useState(storedSecret ? "" : (current?.value ?? ""));
  const [sensitive, setSensitive] = useState(current?.sensitive ?? false);
  const [touched, setTouched] = useState(!isNew); // pick "sensitive" from the name until the user decides
  const action = useAction();
  const valueRequired = isNew || (storedSecret && !sensitive);

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={!current ? "Add variable" : storedSecret ? `Replace ${current.name}` : `Edit ${current.name}`}
      description={
        storedSecret && !sensitive
          ? "A sensitive value can't be revealed. Enter a new value to make it plain."
          : undefined
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            const n = name.trim();
            await api.setEnvVar(repoId, n, {
              sensitive,
              ...(value || valueRequired ? { value } : {}),
            });
            toast.success(`${n} saved`);
            onClose();
            onSaved();
          });
        }}
      >
        <Field label="Name" htmlFor="env-name">
          <Input
            id="env-name"
            className="font-mono"
            required
            disabled={!isNew}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!touched) setSensitive(looksSensitive(e.target.value));
            }}
            placeholder="DATABASE_URL"
            autoFocus={isNew}
          />
        </Field>
        <Field
          label="Value"
          htmlFor="env-value"
          hint={storedSecret && sensitive ? "Leave empty to keep the current value." : undefined}
        >
          <Input
            id="env-value"
            className="font-mono"
            type={sensitive ? "password" : "text"}
            autoComplete="new-password"
            required={valueRequired}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={storedSecret && sensitive ? "unchanged" : ""}
            autoFocus={!isNew}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Checkbox
            id="env-sensitive"
            checked={sensitive}
            onCheckedChange={(v) => {
              setTouched(true);
              setSensitive(v === true);
            }}
          />
          <Label htmlFor="env-sensitive">
            Sensitive <span className="font-normal text-muted-foreground">(encrypted, hidden after saving)</span>
          </Label>
        </div>
        {sensitive && keyMissing && (
          <p className="text-xs text-warning">
            MOGO_SECRET_KEY is not set: sensitive variables can&apos;t be saved yet.
          </p>
        )}
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

interface PendingImport {
  file: string;
  content: string;
  entries: { name: string; sensitive: boolean; existing: boolean }[];
  problems: { line: number; reason: string }[];
}

/** Pick a .env file, preview names (new / replaced, sensitive or not), then import. Values are never shown. */
function EnvImportButton({ repoId, vars, onDone }: { repoId: string; vars: EnvVarInfo[]; onDone: () => void }) {
  const [pending, setPending] = useState<PendingImport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const action = useAction();

  async function pick(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    const { entries, problems } = parseEnv(content);
    if (entries.length === 0) {
      toast.error(`${file.name}: no NAME=value lines found`);
      return;
    }
    const current = new Map(vars.map((v) => [v.name, v.sensitive]));
    setPending({
      file: file.name,
      content,
      entries: entries.map((e) => ({
        name: e.name,
        existing: current.has(e.name),
        sensitive: current.get(e.name) ?? looksSensitive(e.name),
      })),
      problems,
    });
  }

  const added = pending?.entries.filter((e) => !e.existing) ?? [];
  const replaced = pending?.entries.filter((e) => e.existing) ?? [];
  const names = (list: PendingImport["entries"]) => (
    <span className="flex flex-wrap gap-1.5">
      {list.map((e) => (
        <Chip key={e.name} className="gap-1">
          {e.sensitive && <Lock className="h-3 w-3" />}
          {e.name}
        </Chip>
      ))}
    </span>
  );

  return (
    <>
      <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
        <FileUp /> Import .env file
      </Button>
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        accept=".env,.txt,text/plain"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = ""; // the same file can be picked again
        }}
      />
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Import ${pending?.file ?? ""}`}
        description="Existing names get the new value; variables not in the file are kept. Names with a lock are stored as sensitive (change it later in the list)."
        wide
      >
        {pending && (
          <div className="space-y-4 text-sm">
            {added.length > 0 && (
              <div className="space-y-2">
                <p className="font-medium">New ({added.length})</p>
                {names(added)}
              </div>
            )}
            {replaced.length > 0 && (
              <div className="space-y-2">
                <p className="font-medium text-warning">Replace ({replaced.length})</p>
                {names(replaced)}
              </div>
            )}
            {pending.problems.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Skipped: {pending.problems.map((p) => `line ${p.line} (${p.reason})`).join(", ")}
              </p>
            )}
            <ErrorText error={action.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                loading={action.busy}
                onClick={() =>
                  action.run(async () => {
                    try {
                      const r = await api.importEnv(repoId, pending.content);
                      setPending(null);
                      toast.success("Variables imported", {
                        description:
                          `${r.added.length} added, ${r.replaced.length} replaced, ${r.sensitive.length} sensitive` +
                          (r.skipped.length ? `, ${r.skipped.length} line(s) skipped` : ""),
                      });
                      onDone();
                    } catch (e) {
                      toast.error("Import failed", {
                        description: errorMessage(e),
                      });
                      throw e;
                    }
                  })
                }
              >
                Import {pending.entries.length} variables
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ learned conventions

function ProfilePanel({ repo, waiting, onRelearn }: { repo: Repo; waiting: boolean; onRelearn: () => void }) {
  const action = useAction();
  const p = repo.profile;
  return (
    <Card className="mt-6">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Conventions learned from {repo.default_branch}</CardTitle>
          <CardDescription>
            Folders, file names and type definitions of the source of truth branch. Refreshed automatically when the
            branch moves; the built-in checks compare each PR with this.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          loading={action.busy || waiting}
          onClick={() =>
            action.run(async () => {
              await api.relearn(repo.id);
              onRelearn();
            })
          }
        >
          <RefreshCw />
          {waiting ? "Re-learning…" : "Re-learn now"}
        </Button>
      </CardHeader>
      <CardContent>
        <ErrorText error={action.error} />
        {p?.error && (
          <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 font-mono text-xs text-warning">
            {p.error}
          </p>
        )}
        {p?.main_sha ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Chip>@ {p.main_sha.slice(0, 7)}</Chip>
              <Chip>{p.files ?? 0} files</Chip>
              <Chip>{p.types ?? 0} types</Chip>
              <Chip>{timeAgo(p.built_at)}</Chip>
            </div>
            {p.summary && (
              <pre className="mt-4 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                {p.summary}
              </pre>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not learned yet. It happens when a repo is added, on the first review, or now with Re-learn.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
