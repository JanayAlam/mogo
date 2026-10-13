"use client";

import { ChevronDown, RefreshCw } from "lucide-react";

import { Field } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ConfigForm, NodeScriptsForm } from "@/lib/repo-form";
import { dockerPortHint } from "@/lib/repo-form";
import type { Suggestions } from "@/lib/projects";
import { DEFAULT_COMPOSE_FILE, DEFAULT_DOCKERFILE, type DockerMode } from "@/lib/stack";
import { cn } from "@/lib/utils";

const mono = "font-mono text-sm";

type Script = NonNullable<Suggestions["scripts"]>[number];

/** Which package.json scripts to list first for each field. */
const MATCH: Record<keyof NodeScriptsForm, RegExp> = {
  lint: /lint/i,
  typecheck: /type|tsc/i,
  format: /format|prettier|fmt/i,
  other: /check|audit|verify|validate/i,
  test: /test|jest|vitest|mocha|spec/i,
  build: /build|compile/i,
  before: /migrate|seed|generate|db/i,
  run: /^(dev|start|serve)/i,
};

/**
 * A command: free text, with a dropdown of the repo's package.json scripts to pick from (the likely ones first).
 * Picking one fills the field with the command that runs it (`pnpm lint`); a list field gets it as a new line.
 */
function ScriptField({
  id,
  label,
  hint,
  field,
  value,
  onChange,
  scripts,
  onRead,
  placeholder,
  lines,
}: {
  id: string;
  label: string;
  hint?: string;
  field: keyof NodeScriptsForm;
  value: string;
  onChange: (v: string) => void;
  scripts: Script[] | undefined; // undefined: the repo's profile has not read them yet
  onRead?: () => void;
  placeholder?: string;
  lines?: number; // a list field, one command per line
}) {
  const known = scripts ?? [];
  const likely = known.filter((s) => MATCH[field].test(s.name));
  const rest = known.filter((s) => !MATCH[field].test(s.name));
  const pick = (run: string) =>
    onChange(lines ? [value.trim(), run].filter(Boolean).join("\n") : run);
  const item = (s: Script) => (
    <DropdownMenuItem key={s.name} onSelect={() => pick(s.run)} className="gap-3">
      <span className="font-mono text-sm">{s.name}</span>
      <span className="ml-auto max-w-56 truncate font-mono text-xs text-muted-foreground">{s.body}</span>
    </DropdownMenuItem>
  );
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className={cn("flex gap-2", lines && "items-start")}>
        {lines ? (
          <Textarea
            id={id}
            rows={Math.max(lines, value.split("\n").length + 1)}
            className={mono}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
          />
        ) : (
          <Input id={id} className={mono} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label={`Suggested scripts for ${label}`}
              title="Pick a script from package.json">
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
            <DropdownMenuLabel>package.json scripts</DropdownMenuLabel>
            {!known.length && <NoneKnown what="scripts" unread={scripts === undefined} empty="package.json has no scripts." onRead={onRead} />}
            {likely.map(item)}
            {likely.length > 0 && rest.length > 0 && <DropdownMenuSeparator />}
            {rest.map(item)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Field>
  );
}

/** What a suggestion dropdown says when it has nothing to list: not read yet (offer to read it), or really none. */
function NoneKnown({
  what,
  unread,
  empty,
  onRead,
}: {
  what: string;
  unread: boolean;
  empty: string;
  onRead?: () => void;
}) {
  return (
    <>
      <p className="px-2 py-1.5 text-sm text-muted-foreground">
        {unread ? `The ${what} of this repo have not been read yet.` : empty}
      </p>
      {unread && onRead && (
        <DropdownMenuItem onSelect={onRead} className="gap-2">
          <RefreshCw className="size-4" /> Read from GitHub now
        </DropdownMenuItem>
      )}
    </>
  );
}

/** Lint, type check, format and the other checks of a Node.js, TypeScript or JavaScript repo. */
export function NodeChecksCard({
  form,
  suggestions,
  onChange,
  onRead,
}: {
  form: ConfigForm;
  suggestions: Suggestions | null | undefined;
  onChange: <K extends keyof NodeScriptsForm>(k: K, v: string) => void;
  onRead?: () => void;
}) {
  const scripts = suggestions?.scripts;
  const s = form.scripts;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Checks</CardTitle>
        <CardDescription>
          Run on every review after installing dependencies. Pick a script from package.json or type a command. Any
          failure requests changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <ScriptField id="lint" label="Lint" field="lint" value={s.lint} onChange={(v) => onChange("lint", v)} scripts={scripts} onRead={onRead} placeholder="pnpm lint" />
        <ScriptField id="typecheck" label="Type check" field="typecheck" value={s.typecheck} onChange={(v) => onChange("typecheck", v)} scripts={scripts} onRead={onRead} placeholder="pnpm exec tsc --noEmit" />
        <ScriptField id="format" label="Format check" field="format" value={s.format} onChange={(v) => onChange("format", v)} scripts={scripts} onRead={onRead} placeholder="pnpm format:check" />
        <div className="sm:col-span-2">
          <ScriptField
            id="other-checks"
            label="Other checks"
            field="other"
            hint="One command per line."
            value={s.other}
            onChange={(v) => onChange("other", v)}
            scripts={scripts} onRead={onRead}
            lines={2}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** The test command, the steps before the app starts, and the command that starts it. */
export function NodeRunCard({
  form,
  suggestions,
  onChange,
  onUrl,
  onRead,
}: {
  form: ConfigForm;
  suggestions: Suggestions | null | undefined;
  onChange: <K extends keyof NodeScriptsForm>(k: K, v: string) => void;
  onUrl: (v: string) => void;
  onRead?: () => void;
}) {
  const scripts = suggestions?.scripts;
  const s = form.scripts;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Test &amp; run</CardTitle>
        <CardDescription>
          Lets the agent try the feature over HTTP. With no run command the PR is reviewed and checked, but the app is
          not run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ScriptField
          id="test"
          label="Test"
          field="test"
          hint="The agent runs it to check behaviour; it is not a pass/fail check."
          value={s.test}
          onChange={(v) => onChange("test", v)}
          scripts={scripts} onRead={onRead}
          placeholder="pnpm test"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <ScriptField
            id="build"
            label="Build"
            field="build"
            hint="Runs before the app starts. With no run command it is a check instead."
            value={s.build}
            onChange={(v) => onChange("build", v)}
            scripts={scripts} onRead={onRead}
            placeholder="pnpm build"
          />
          <ScriptField id="run" label="Run" field="run" hint="Starts the app and keeps running." value={s.run} onChange={(v) => onChange("run", v)} scripts={scripts} onRead={onRead} placeholder="pnpm dev" />
        </div>
        <ScriptField
          id="before"
          label="Before running"
          field="before"
          hint="Start a database, migrate, seed: one command per line, in this order, after the build."
          value={s.before}
          onChange={(v) => onChange("before", v)}
          scripts={scripts} onRead={onRead}
          lines={2}
          placeholder={"docker compose up -d db\npnpm prisma migrate deploy"}
        />
        {s.run.trim() && (
          <Field
            label="Ready URL (optional)"
            htmlFor="app-url"
            hint="The agent starts once this answers. Any response counts, even a 404: use a health route for an API, the home page for a frontend. Empty: http://localhost:<PORT>, with this repo's PORT variable, else 3000.">
            <Input id="app-url" className={mono} value={form.appUrl} onChange={(e) => onUrl(e.target.value)} placeholder={suggestions?.app_url || "http://localhost:3000"} />
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

const MODES: { id: DockerMode; label: string }[] = [
  { id: "compose", label: "Docker Compose" },
  { id: "dockerfile", label: "Dockerfile" },
];

/**
 * A Docker repo has no checks and no scripts: the runner builds and runs the Compose file (or the Dockerfile)
 * directly. The file name is empty for the default.
 */
export function DockerCard({
  form,
  branch,
  suggestions,
  onChange,
  onRead,
}: {
  form: ConfigForm;
  branch: string;
  suggestions: Suggestions | null | undefined;
  onRead?: () => void;
  onChange: (patch: Partial<Pick<ConfigForm, "dockerMode" | "dockerFile" | "dockerPort" | "appUrl">>) => void;
}) {
  const compose = form.dockerMode === "compose";
  const foundFiles = compose ? suggestions?.compose_files : suggestions?.dockerfiles; // undefined: not read yet
  const known = foundFiles ?? [];
  const defaultFile = compose ? DEFAULT_COMPOSE_FILE : DEFAULT_DOCKERFILE;
  const port = dockerPortHint(suggestions);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Docker</CardTitle>
        <CardDescription>
          The project is started straight from the repo with Docker Compose or a Dockerfile: no checks and no scripts.
          The repo&apos;s environment variables are passed in, and everything is removed when the run ends.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Run with" htmlFor="docker-mode">
            <Select value={form.dockerMode} onValueChange={(v) => onChange({ dockerMode: v as DockerMode, dockerFile: "" })}>
              <SelectTrigger id="docker-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={compose ? "Compose file" : "Dockerfile"}
            htmlFor="docker-file"
            hint={`A file at the repo root. Empty: ${defaultFile}.`}>
            <div className="flex gap-2">
              <Input
                id="docker-file"
                className={mono}
                value={form.dockerFile}
                onChange={(e) => onChange({ dockerFile: e.target.value })}
                placeholder={defaultFile}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label="Files found in the repo"
                    title="Pick a file found at the repo root">
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                  <DropdownMenuLabel>Found at the root of {branch}</DropdownMenuLabel>
                  {!known.length && (
                    <NoneKnown
                      what="files"
                      unread={foundFiles === undefined}
                      empty={compose ? "No Compose file at the root." : "No Dockerfile at the root."}
                      onRead={onRead}
                    />
                  )}
                  {known.map((name) => (
                    <DropdownMenuItem key={name} className="font-mono text-sm" onSelect={() => onChange({ dockerFile: name })}>
                      {name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {!compose && (
            <Field label="Port" htmlFor="docker-port" hint="The port the app listens on, published on the same port. Empty: the Dockerfile's EXPOSE, else 3000.">
              <Input
                id="docker-port"
                className={mono}
                inputMode="numeric"
                value={form.dockerPort}
                onChange={(e) => onChange({ dockerPort: e.target.value.replace(/\D/g, "") })}
                placeholder={String(port)}
              />
            </Field>
          )}
          <Field
            label="Ready URL (optional)"
            htmlFor="app-url"
            hint={
              compose
                ? "After starting, the runner polls this address until the app answers, and only then lets the agent test it. Any answer counts, even a 404, so a health route is best. Empty: the first port the compose file publishes, read from the file."
                : "After starting, the runner polls this address until the app answers, and only then lets the agent test it. Any answer counts, even a 404. Empty: the port above."
            }>
            <Input
              id="app-url"
              className={mono}
              value={form.appUrl}
              onChange={(e) => onChange({ appUrl: e.target.value })}
              placeholder={compose ? "automatic, from the compose file" : `http://localhost:${form.dockerPort || port}`}
            />
          </Field>
        </div>
        <DockerFileStatus form={form} branch={branch} suggestions={suggestions} onChange={onChange} onRead={onRead} />
      </CardContent>
    </Card>
  );
}

function DockerFileStatus({
  form,
  branch,
  suggestions,
  onChange,
  onRead,
}: {
  form: ConfigForm;
  branch: string;
  suggestions: Suggestions | null | undefined;
  onChange: (patch: Partial<Pick<ConfigForm, "dockerMode" | "dockerFile">>) => void;
  onRead?: () => void;
}) {
  if (!suggestions || suggestions.dockerfiles === undefined || suggestions.compose_files === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        Needs {form.dockerMode === "compose" ? DEFAULT_COMPOSE_FILE : "a Dockerfile"} at the root of {branch}; it is read
        from GitHub when this page opens.
      </p>
    );
  }
  const compose = form.dockerMode === "compose";
  const file = form.dockerFile.trim() || (compose ? DEFAULT_COMPOSE_FILE : DEFAULT_DOCKERFILE);
  const found = (compose ? suggestions.compose_files : suggestions.dockerfiles).includes(file);
  if (found) {
    return (
      <p className="text-sm text-success">
        {file} found
        {!compose && file === DEFAULT_DOCKERFILE && suggestions.docker_port ? `, it exposes port ${suggestions.docker_port}` : ""}.
      </p>
    );
  }

  // The file is missing. Offer what the repo has instead: another file of the same kind, or the other kind.
  const sameKind = (compose ? suggestions.compose_files : suggestions.dockerfiles)[0];
  const otherKind = compose ? suggestions.dockerfiles : suggestions.compose_files;
  const otherDefault = compose ? DEFAULT_DOCKERFILE : DEFAULT_COMPOSE_FILE;
  const other = otherKind.includes(otherDefault) ? otherDefault : otherKind[0];
  const alternatives: { label: string; patch: Partial<Pick<ConfigForm, "dockerMode" | "dockerFile">> }[] = [];
  if (sameKind) alternatives.push({ label: `Use ${sameKind}`, patch: { dockerFile: sameKind } });
  if (other) {
    alternatives.push({
      label: `Run with ${compose ? "the Dockerfile" : "Docker Compose"} instead`,
      patch: { dockerMode: compose ? "dockerfile" : "compose", dockerFile: other === otherDefault ? "" : other },
    });
  }
  const has = [sameKind, other].filter(Boolean).join(" and ");
  return (
    <div className="space-y-2 text-sm">
      <p className="text-warning">
        {file} was not found at the root of {branch}
        {has ? `, but ${has} ${sameKind && other ? "are" : "is"} there.` : ". Without a file the app is not started."}
      </p>
      <div className="flex flex-wrap gap-2">
        {alternatives.map((a) => (
          <Button key={a.label} type="button" variant="outline" size="sm" onClick={() => onChange(a.patch)}>
            {a.label}
          </Button>
        ))}
        {onRead && (
          <Button type="button" variant="ghost" size="sm" onClick={onRead}>
            Check GitHub again
          </Button>
        )}
      </div>
    </div>
  );
}
