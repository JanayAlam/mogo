"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { RoleInput } from "@/components/project-view";
import { ErrorText, Shell, timeAgo, useAction, useApi } from "@/components/ui-kit";
import { api, type Repo } from "@/lib/client";
import { parseEnv } from "@/lib/dotenv";
import { type ConfigForm, configToForm, formToConfig, legacyEnvFrom } from "@/lib/repo-form";

export function RepoSettings() {
  const { id, repoId } = useParams<{ id: string; repoId: string }>();
  const [waiting, setWaiting] = useState<string | null>(null); // built_at|error before "Re-learn"
  const stamp = (r: Repo) => `${r.profile?.built_at ?? ""}|${r.profile?.error ?? ""}`;
  const repo = useApi(() => api.repo(repoId), repoId, (r) => waiting !== null && stamp(r) === waiting);
  const relearning = waiting !== null && !!repo.data && stamp(repo.data) === waiting;
  return (
    <Shell>
      <Link href={`/projects/${id}`} className="font-mono text-xs text-muted-foreground hover:text-foreground">← project</Link>
      <ErrorText error={repo.error} />
      {repo.data && (
        <>
          <RepoForm key={repo.data.id} repo={repo.data} projectId={id} onSaved={repo.reload} />
          <SecretsPanel repoId={repo.data.id} />
          <ProfilePanel
            repo={repo.data}
            waiting={relearning}
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

type TextKey = Exclude<keyof ConfigForm, "allow_forks">;

const SECTIONS: { title: string; hint: string; fields: { key: TextKey; label: string; hint?: string; multi?: boolean; mono?: boolean; rows?: number }[] }[] = [
  {
    title: "Install and checks",
    hint: "Run on every review, in order. One command per line.",
    fields: [
      { key: "setup", label: "Setup", hint: "install dependencies", multi: true, mono: true },
      { key: "gates", label: "Gates", hint: "linters / type checks; a failing gate requests changes", multi: true, mono: true },
      { key: "test_cmd", label: "Test command", mono: true },
    ],
  },
  {
    title: "Boot the app",
    hint: "Only when a feature is described. Without a start command the run is review only.",
    fields: [
      { key: "services_cmd", label: "Services", hint: "e.g. docker run a database", mono: true, rows: 3 },
      { key: "services_down", label: "Services down", hint: "always run at the end", mono: true },
      { key: "prepare", label: "Prepare", hint: "after services, before start: migrate, seed", multi: true, mono: true },
      { key: "start", label: "Start", mono: true },
      { key: "healthcheck", label: "Healthcheck URL", mono: true },
    ],
  },
  {
    title: "Environment",
    hint: "Commands see only this repo's env and secrets, never the runner's own credentials.",
    fields: [
      { key: "env", label: "Env (plain values)", hint: "NAME=value per line, stored as plain text: ports, local URLs. Keys and passwords go in Secrets below; a secret wins over an env value of the same name.", multi: true, mono: true },
    ],
  },
  {
    title: "What the agent reads",
    hint: "On top of the project description, the feature and this repo's role.",
    fields: [
      { key: "conventions", label: "Convention files", hint: "paths in the repo, e.g. CLAUDE.md", multi: true, mono: true },
      { key: "rules", label: "Extra rules", hint: "one rule per line", multi: true },
      { key: "notes", label: "Testing notes", hint: "accounts, how to log in, known limits", rows: 6 },
    ],
  },
];

function RepoForm({ repo, projectId, onSaved }: { repo: Repo; projectId: string; onSaved: () => void }) {
  const router = useRouter();
  const [role, setRole] = useState(repo.role);
  const [branch, setBranch] = useState(repo.default_branch);
  const [form, setForm] = useState<ConfigForm>(() => configToForm(repo.config));
  const legacy = legacyEnvFrom(repo.config);
  const [saved, setSaved] = useState(false);
  const save = useAction();
  const del = useAction();
  const set = (k: keyof ConfigForm, v: string | boolean) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  return (
    <form
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.run(async () => {
          await api.updateRepo(repo.id, { role: role.trim(), default_branch: branch.trim() || "main", config: formToConfig(form) });
          setSaved(true);
          onSaved();
        });
      }}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-widest text-primary uppercase">Repository</p>
          <h1 className="mt-1 font-mono text-2xl font-semibold">{repo.full_name}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {repo.profile?.main_sha
              ? `conventions learned from ${repo.default_branch} @ ${repo.profile.main_sha.slice(0, 7)}, ${timeAgo(repo.profile.built_at)}`
              : `conventions are learned from ${repo.default_branch} on the first run`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="font-mono text-xs text-success">saved</span>}
          <button
            type="button"
            className="btn-danger"
            disabled={del.busy}
            onClick={() => {
              if (!confirm(`Remove ${repo.full_name} from the project? Its feature entries and runs are deleted too.`)) return;
              del.run(async () => {
                await api.deleteRepo(repo.id);
                router.push(`/projects/${projectId}`);
              });
            }}>
            Remove
          </button>
          <button className="btn-primary" disabled={save.busy}>Save</button>
        </div>
      </div>
      <ErrorText error={save.error || del.error} />
      {legacy.length > 0 && (
        <p className="mb-6 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          This repo still lists GitHub Actions secret names (env_from), which are no longer read: {legacy.join(", ")}.
          Add their values under Secrets below. Saving this form removes the old list.
        </p>
      )}

      <div className="space-y-6">
        <section className="panel grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="role">Role</label>
            <RoleInput id="role" value={role} onChange={(v) => { setSaved(false); setRole(v); }} />
            <p className="mt-1 text-xs text-muted-foreground">Free text. The agent judges the PR as this kind of repo.</p>
          </div>
          <div>
            <label className="label" htmlFor="branch">Source of truth branch</label>
            <input id="branch" className="field font-mono" value={branch} onChange={(e) => { setSaved(false); setBranch(e.target.value); }} />
            <p className="mt-1 text-xs text-muted-foreground">Structure and type conventions are learned from here.</p>
          </div>
        </section>

        {SECTIONS.map((s) => (
          <section key={s.title} className="panel p-5">
            <h2 className="font-medium">{s.title}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{s.hint}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {s.fields.map((f) => (
                <div key={f.key} className={f.multi || f.rows ? "md:col-span-2" : ""}>
                  <label className="label" htmlFor={f.key}>{f.label}</label>
                  {f.multi || f.rows ? (
                    <textarea
                      id={f.key}
                      rows={f.rows ?? Math.max(2, form[f.key].split("\n").length + 1)}
                      className={`field ${f.mono ? "font-mono text-xs" : ""}`}
                      value={form[f.key]}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  ) : (
                    <input id={f.key} className={`field ${f.mono ? "font-mono text-xs" : ""}`} value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                  )}
                  {f.hint && <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>}
                </div>
              ))}
            </div>
          </section>
        ))}

        <label className="panel flex items-center gap-3 p-5 text-sm">
          <input type="checkbox" checked={form.allow_forks} onChange={(e) => set("allow_forks", e.target.checked)} />
          Allow PRs from forks <span className="text-muted-foreground">(their code can read the env and secrets above)</span>
        </label>
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="font-mono text-xs text-success">saved</span>}
          <ErrorText error={save.error} />
          <button className="btn-primary" disabled={save.busy}>Save</button>
        </div>
      </div>
    </form>
  );
}

function ProfilePanel({ repo, waiting, onRelearn }: { repo: Repo; waiting: boolean; onRelearn: () => void }) {
  const action = useAction();
  const p = repo.profile;
  return (
    <section className="panel mt-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Conventions learned from {repo.default_branch}</h2>
          <p className="text-sm text-muted-foreground">
            Folders, file names and type definitions of the source of truth branch. Refreshed automatically when the branch
            moves; the built-in checks compare each PR with this.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          disabled={action.busy || waiting}
          onClick={() => action.run(async () => {
            await api.relearn(repo.id);
            onRelearn();
          })}>
          {waiting ? "Re-learning…" : "Re-learn now"}
        </button>
      </div>
      <ErrorText error={action.error} />
      {p?.error && <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 font-mono text-xs text-warning">{p.error}</p>}
      {p?.main_sha ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs">
            <span className="chip">@ {p.main_sha.slice(0, 7)}</span>
            <span className="chip">{p.files ?? 0} files</span>
            <span className="chip">{p.types ?? 0} types</span>
            <span className="chip">{timeAgo(p.built_at)}</span>
          </div>
          {p.summary && <pre className="mt-4 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{p.summary}</pre>}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Not learned yet. It happens on the first review, or now with Re-learn.</p>
      )}
    </section>
  );
}

function SecretsPanel({ repoId }: { repoId: string }) {
  const list = useApi(() => api.secrets(repoId), `secrets-${repoId}`);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replacement, setReplacement] = useState("");
  const action = useAction();
  const save = (n: string, v: string, done: () => void) =>
    action.run(async () => {
      await api.setSecret(repoId, n, v);
      done();
      list.reload();
    });
  const keyMissing = list.data && !list.data.key_configured;

  return (
    <section className="panel mt-6 p-5">
      <h2 className="font-medium">Secrets</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Env values for this repo only: API keys, passwords, database URLs. Encrypted before they are stored; they cannot be
        shown again, only replaced. The runner decrypts them for this repo&apos;s commands and masks them in logs and reviews.
        Use test credentials: the PR&apos;s code can read them.
      </p>
      {keyMissing && (
        <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          MOGO_SECRET_KEY is not set on the web app, so secrets cannot be saved. Set the same key on the web app and as an
          Actions secret of the runner repo (openssl rand -base64 32).
        </p>
      )}
      <ErrorText error={list.error || action.error} />
      <EnvImport
        repoId={repoId}
        existing={list.data?.secrets.map((x) => x.name) ?? []}
        disabled={!!keyMissing}
        onDone={list.reload}
      />
      <ul className="divide-y divide-border">
        {list.data?.secrets.map((sec) => (
          <li key={sec.name} className="flex flex-wrap items-center gap-3 py-2">
            <span className="font-mono text-sm">{sec.name}</span>
            <span className="font-mono text-xs text-muted-foreground">•••••••• · set {timeAgo(sec.updated_at)}</span>
            <span className="ml-auto flex items-center gap-2">
              {replacing === sec.name ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(sec.name, replacement, () => {
                      setReplacing(null);
                      setReplacement("");
                    });
                  }}>
                  <input type="password" autoFocus required aria-label={`New value for ${sec.name}`} className="field w-64 font-mono text-xs" value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="new value" autoComplete="new-password" />
                  <button className="btn-primary px-2.5 py-1 text-xs" disabled={action.busy}>Save</button>
                  <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setReplacing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => { setReplacing(sec.name); setReplacement(""); }}>Replace</button>
                  <button
                    type="button"
                    className="btn-danger px-2.5 py-1 text-xs"
                    onClick={() => {
                      if (!confirm(`Delete secret ${sec.name}?`)) return;
                      action.run(async () => {
                        await api.deleteSecret(repoId, sec.name);
                        list.reload();
                      });
                    }}>
                    Delete
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
        {list.data?.secrets.length === 0 && <li className="py-2 text-sm text-muted-foreground">No secrets yet.</li>}
      </ul>
      <form
        className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          save(name.trim(), value, () => {
            setName("");
            setValue("");
          });
        }}>
        <input aria-label="Secret name" className="field font-mono text-xs" required value={name} onChange={(e) => setName(e.target.value)} placeholder="NAME" />
        <input aria-label="Secret value" type="password" className="field font-mono text-xs" required value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" autoComplete="new-password" />
        <button className="btn-primary" disabled={action.busy || !!keyMissing}>Add secret</button>
      </form>
    </section>
  );
}

interface PendingImport {
  file: string;
  content: string;
  added: string[];
  replaced: string[];
  problems: { line: number; reason: string }[];
}

/** Pick a .env file, preview the names, then save every value as a secret of this repo. */
function EnvImport({ repoId, existing, disabled, onDone }: { repoId: string; existing: string[]; disabled: boolean; onDone: () => void }) {
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [result, setResult] = useState("");
  const action = useAction();

  async function pick(file: File | undefined) {
    if (!file) return;
    setResult("");
    action.setError("");
    const content = await file.text();
    const { entries, problems } = parseEnv(content);
    if (entries.length === 0) {
      action.setError(`${file.name}: no NAME=value lines found`);
      return;
    }
    const names = entries.map((e) => e.name);
    setPending({
      file: file.name,
      content,
      added: names.filter((n) => !existing.includes(n)),
      replaced: names.filter((n) => existing.includes(n)),
      problems,
    });
  }

  const names = (list: string[]) => <span className="font-mono text-xs">{list.join(", ")}</span>;

  return (
    <div className="mb-4">
      <label className={`btn-ghost cursor-pointer ${disabled ? "pointer-events-none opacity-50" : ""}`}>
        Import .env file
        <input
          type="file"
          className="sr-only"
          accept=".env,.txt,text/plain"
          disabled={disabled}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = ""; // the same file can be picked again
          }}
        />
      </label>
      <span className="ml-3 text-xs text-muted-foreground">
        Every NAME=value becomes a secret. Existing names are replaced; secrets not in the file are kept.
      </span>
      <ErrorText error={action.error} />
      {result && <p className="mt-2 font-mono text-xs text-success">{result}</p>}
      {pending && (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-muted p-4 text-sm">
          <p className="font-medium">{pending.file}</p>
          {pending.added.length > 0 && <p>New ({pending.added.length}): {names(pending.added)}</p>}
          {pending.replaced.length > 0 && (
            <p className="text-warning">Replace ({pending.replaced.length}): {names(pending.replaced)}</p>
          )}
          {pending.problems.length > 0 && (
            <p className="text-muted-foreground">
              Skipped: {pending.problems.map((p) => `line ${p.line} (${p.reason})`).join(", ")}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="btn-primary"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  const r = await api.importSecrets(repoId, pending.content);
                  setPending(null);
                  setResult(`${r.added.length} added, ${r.replaced.length} replaced` + (r.skipped.length ? `, ${r.skipped.length} line(s) skipped` : ""));
                  onDone();
                })
              }>
              Import {pending.added.length + pending.replaced.length} secrets
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
