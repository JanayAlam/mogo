"use client";

import { ChevronDown, FileUp, Lock, Pencil, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import { useRef, useState } from "react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, type Repo } from "@/lib/client";
import { looksSensitive, parseEnv } from "@/lib/dotenv";
import type { EnvVarInfo } from "@/lib/env";
import type { Suggestions } from "@/lib/projects";
import {
  applySuggestions,
  configToForm,
  formError,
  formToConfig,
  legacyEnvFrom,
  type ConfigForm,
} from "@/lib/repo-form";
import { cn } from "@/lib/utils";

const mono = "font-mono text-xs md:text-xs";

export function RepoSettings() {
  const { id, repoId } = useParams<{ id: string; repoId: string }>();
  const search = useSearchParams();
  // built_at|error of the profile when learning started; "|" = none yet (the repo was just added)
  const [waiting, setWaiting] = useState<string | null>(() =>
    search.get("learning") ? "|" : null,
  );
  const stamp = (r: Repo) =>
    `${r.profile?.built_at ?? ""}|${r.profile?.error ?? ""}`;
  const repo = useApi(
    () => api.repo(repoId),
    repoId,
    (r) => waiting !== null && stamp(r) === waiting,
  );
  const learning =
    waiting !== null && !!repo.data && stamp(repo.data) === waiting;
  return (
    <Shell>
      <BackLink href={`/projects/${id}`}>project</BackLink>
      <ErrorText error={repo.error} />
      {!repo.data && !repo.error && <FormSkeleton sections={4} />}
      {repo.data && (
        <>
          <RepoForm
            key={repo.data.id}
            repo={repo.data}
            projectId={id}
            learning={learning}
            onSaved={repo.reload}
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
  learning,
  onSaved,
}: {
  repo: Repo;
  projectId: string;
  learning: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [role, setRole] = useState(repo.role);
  const [branch, setBranch] = useState(repo.default_branch);
  const [form, setForm] = useState<ConfigForm>(() => configToForm(repo.config));
  const [advancedOpen, setAdvancedOpen] = useState(
    () => !!(form.install || form.testCmd || form.stopCmd || form.allowForks),
  );
  const legacy = legacyEnvFrom(repo.config);
  const suggestions = repo.profile?.suggestions;
  const save = useAction();
  const del = useAction();
  const set = <K extends keyof ConfigForm>(k: K, v: ConfigForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const saveButton = <Button loading={save.busy}>Save</Button>;

  return (
    <form
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = formError(form);
        if (problem) return save.setError(problem);
        save.run(async () => {
          await api.updateRepo(repo.id, {
            role: role.trim(),
            default_branch: branch.trim() || "main",
            config: formToConfig(form),
          });
          toast.success("Repo settings saved");
          onSaved();
        });
      }}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow className="tracking-widest text-primary">Repository</Eyebrow>
          <h1 className="mt-1 font-mono text-2xl font-semibold">
            {repo.full_name}
          </h1>
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
            }>
            Remove
          </ConfirmButton>
          {saveButton}
        </div>
      </div>
      <ErrorText error={save.error || del.error} />
      {legacy.length > 0 && (
        <p className="mb-6 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          This repo still lists GitHub Actions secret names (env_from), which
          are no longer read: {legacy.join(", ")}. Add their values under
          Environment variables below. Saving this form removes the old list.
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <Field
              label="Role"
              htmlFor="role"
              hint="Free text. The agent judges the PR as this kind of repo.">
              <RoleInput id="role" value={role} onChange={setRole} />
            </Field>
            <Field
              label="Source of truth branch"
              htmlFor="branch"
              hint="Settings and conventions are read from here.">
              <Input
                id="branch"
                className="font-mono"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <Detected
          branch={repo.default_branch}
          learning={learning}
          suggestions={suggestions}
          form={form}
          onApply={(s) => {
            setForm((f) => applySuggestions(f, s));
            toast.success("Detected settings filled in", {
              description: "Review them, then Save.",
            });
          }}
        />

        <Card>
          <CardHeader>
            <CardTitle>Checks</CardTitle>
            <CardDescription>
              Run on every review after installing dependencies, one command
              per line. Any failure requests changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              aria-label="Checks"
              rows={Math.max(3, form.checks.split("\n").length + 1)}
              className={mono}
              value={form.checks}
              onChange={(e) => set("checks", e.target.value)}
              placeholder={"pnpm lint\npnpm exec tsc --noEmit"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Run the app</CardTitle>
              <CardDescription>
                Lets the agent try the feature over HTTP. Off: the PR is
                reviewed and checked, but not run.
              </CardDescription>
            </div>
            <Switch
              aria-label="Run the app"
              checked={form.runApp}
              onCheckedChange={(v) => set("runApp", v)}
            />
          </CardHeader>
          {form.runApp && (
            <CardContent className="grid gap-4">
              <Field
                label="Start script"
                htmlFor="start"
                hint="One command per line. Earlier lines run first (start a database, migrate); the last line starts the app and keeps running.">
                <Textarea
                  id="start"
                  rows={Math.max(3, form.startScript.split("\n").length + 1)}
                  className={mono}
                  value={form.startScript}
                  onChange={(e) => set("startScript", e.target.value)}
                  placeholder={"docker compose up -d db\npnpm prisma migrate deploy\npnpm dev"}
                />
              </Field>
              <Field
                label="App URL"
                htmlFor="app-url"
                hint="The run waits until this answers, then the agent starts testing.">
                <Input
                  id="app-url"
                  className={mono}
                  value={form.appUrl}
                  onChange={(e) => set("appUrl", e.target.value)}
                  placeholder="http://localhost:3000/health"
                />
              </Field>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent notes</CardTitle>
            <CardDescription>
              Read by the agent on top of the project description, the feature
              and this repo&apos;s role.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field
              label="Convention files"
              htmlFor="conventions"
              hint="Paths in the repo, one per line, e.g. CLAUDE.md">
              <Textarea
                id="conventions"
                rows={2}
                className={mono}
                value={form.conventions}
                onChange={(e) => set("conventions", e.target.value)}
              />
            </Field>
            <Field label="Extra rules" htmlFor="rules" hint="One rule per line">
              <Textarea
                id="rules"
                rows={2}
                value={form.rules}
                onChange={(e) => set("rules", e.target.value)}
              />
            </Field>
            <Field
              label="Testing notes"
              htmlFor="notes"
              hint="Accounts, how to log in, known limits">
              <Textarea
                id="notes"
                rows={5}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="px-0 hover:bg-transparent">
              <ChevronDown
                className={cn("transition-transform", !advancedOpen && "-rotate-90")}
              />
              Advanced
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2">
              <CardContent className="grid gap-4 p-6">
                <Field
                  label="Install command"
                  htmlFor="install"
                  hint="Leave empty to install from the lockfile (pnpm, yarn, npm, bun, uv, poetry or pip). One command per line.">
                  <Textarea
                    id="install"
                    rows={2}
                    className={mono}
                    value={form.install}
                    onChange={(e) => set("install", e.target.value)}
                    placeholder={suggestions?.install || "pnpm install --frozen-lockfile"}
                  />
                </Field>
                <Field
                  label="Test command"
                  htmlFor="test-cmd"
                  hint="Tells the agent how to run the tests. Add it to Checks as well if failing tests should request changes.">
                  <Input
                    id="test-cmd"
                    className={mono}
                    value={form.testCmd}
                    onChange={(e) => set("testCmd", e.target.value)}
                  />
                </Field>
                <Field
                  label="Stop command"
                  htmlFor="stop-cmd"
                  hint="Runs at the end, e.g. docker compose down. Only matters for local CLI runs: the Actions machine is thrown away.">
                  <Input
                    id="stop-cmd"
                    className={mono}
                    value={form.stopCmd}
                    onChange={(e) => set("stopCmd", e.target.value)}
                  />
                </Field>
                <div className="flex items-center gap-3">
                  <Switch
                    id="allow-forks"
                    checked={form.allowForks}
                    onCheckedChange={(v) => set("allowForks", v)}
                  />
                  <Label htmlFor="allow-forks">
                    Allow PRs from forks{" "}
                    <span className="font-normal text-muted-foreground">
                      (their code can read this repo&apos;s environment
                      variables)
                    </span>
                  </Label>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <div className="flex justify-end">{saveButton}</div>
      </div>
    </form>
  );
}

/** Settings read from the branch, offered while the form's checks and start script are still empty. */
function Detected({
  branch,
  learning,
  suggestions,
  form,
  onApply,
}: {
  branch: string;
  learning: boolean;
  suggestions: Suggestions | null | undefined;
  form: ConfigForm;
  onApply: (s: Suggestions) => void;
}) {
  if (learning) {
    return (
      <Card className="border-primary/30">
        <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
          Reading {branch}: settings found in package.json and the lockfile
          will be suggested here.
        </CardContent>
      </Card>
    );
  }
  const useful =
    suggestions && (suggestions.checks.length || suggestions.start || suggestions.test_cmd);
  if (!useful || form.checks.trim() || form.startScript.trim()) return null;
  const row = (label: string, value: string) =>
    value && (
      <div className="flex gap-3">
        <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
        <code className="font-mono text-xs leading-5 whitespace-pre-wrap">{value}</code>
      </div>
    );
  return (
    <Card className="border-primary/40">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Detected on {branch}
          </CardTitle>
          <CardDescription>
            From package.json, the lockfile and .env.example. Nothing is saved
            until you click Save.
          </CardDescription>
        </div>
        <Button type="button" onClick={() => onApply(suggestions)}>
          Use these
        </Button>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {row("Install", suggestions.install && `${suggestions.install}  (automatic)`)}
        {row("Checks", suggestions.checks.join("\n"))}
        {row("Tests", suggestions.test_cmd)}
        {row("Start", suggestions.start)}
        {row("App URL", suggestions.app_url)}
        {suggestions.env_names.length > 0 && (
          <p className="pt-1 text-xs text-muted-foreground">
            .env.example lists {suggestions.env_names.length} variables: import
            your .env under Environment variables below.
          </p>
        )}
      </CardContent>
    </Card>
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
            Only this repo&apos;s commands get them. Sensitive values are
            encrypted, can&apos;t be shown again (only replaced) and are masked
            in logs and reviews. Use test credentials: the PR&apos;s code can
            read them.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <EnvImportButton
            repoId={repoId}
            vars={list.data?.vars ?? []}
            onDone={list.reload}
          />
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus /> Add variable
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {keyMissing && (
          <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            MOGO_SECRET_KEY is not set on the web app, so sensitive variables
            can&apos;t be saved (plain ones can). Set the same key on the web
            app and as an Actions secret of the runner repo (openssl rand
            -base64 32).
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
              <span className="w-[10rem]" />
            </div>
            {list.data.vars.map((v) => (
              <div
                key={v.name}
                className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_6rem_auto] items-center gap-3 px-3 py-2">
                <span className="truncate font-mono text-sm" title={v.name}>
                  {v.name}
                </span>
                <span
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={v.value ?? undefined}>
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
                <span className="flex w-[10rem] justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(v)}>
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
                    }>
                    Delete
                  </ConfirmButton>
                </span>
              </div>
            ))}
          </div>
        )}
        {list.data?.vars.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No variables yet. Import a .env file or add them one by one.
          </p>
        )}
      </CardContent>
      <EnvVarDialog
        key={
          editing === "new"
            ? "new"
            : editing
              ? `${editing.name}:${editing.sensitive}`
              : "closed"
        }
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
      title={
        !current
          ? "Add variable"
          : storedSecret
            ? `Replace ${current.name}`
            : `Edit ${current.name}`
      }
      description={
        storedSecret && !sensitive
          ? "A sensitive value can't be revealed. Enter a new value to make it plain."
          : undefined
      }>
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
        }}>
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
          hint={storedSecret && sensitive ? "Leave empty to keep the current value." : undefined}>
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
            Sensitive{" "}
            <span className="font-normal text-muted-foreground">
              (encrypted, hidden after saving)
            </span>
          </Label>
        </div>
        {sensitive && keyMissing && (
          <p className="text-xs text-warning">
            MOGO_SECRET_KEY is not set: sensitive variables can&apos;t be saved
            yet.
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
function EnvImportButton({
  repoId,
  vars,
  onDone,
}: {
  repoId: string;
  vars: EnvVarInfo[];
  onDone: () => void;
}) {
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
      <Button
        type="button"
        variant="outline"
        onClick={() => fileInput.current?.click()}>
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
        wide>
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
                <p className="font-medium text-warning">
                  Replace ({replaced.length})
                </p>
                {names(replaced)}
              </div>
            )}
            {pending.problems.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Skipped:{" "}
                {pending.problems
                  .map((p) => `line ${p.line} (${p.reason})`)
                  .join(", ")}
              </p>
            )}
            <ErrorText error={action.error} />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPending(null)}>
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
                          (r.skipped.length
                            ? `, ${r.skipped.length} line(s) skipped`
                            : ""),
                      });
                      onDone();
                    } catch (e) {
                      toast.error("Import failed", {
                        description: errorMessage(e),
                      });
                      throw e;
                    }
                  })
                }>
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

function ProfilePanel({
  repo,
  waiting,
  onRelearn,
}: {
  repo: Repo;
  waiting: boolean;
  onRelearn: () => void;
}) {
  const action = useAction();
  const p = repo.profile;
  return (
    <Card className="mt-6">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Conventions learned from {repo.default_branch}</CardTitle>
          <CardDescription>
            Folders, file names and type definitions of the source of truth
            branch. Refreshed automatically when the branch moves; the built-in
            checks compare each PR with this.
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
          }>
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
            Not learned yet. It happens when a repo is added, on the first
            review, or now with Re-learn.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
