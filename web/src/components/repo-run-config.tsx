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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ConfigForm } from "@/lib/repo-form";
import { dockerPortHint } from "@/lib/repo-form";
import type { Suggestions } from "@/lib/projects";
import { DEFAULT_COMPOSE_FILE, DEFAULT_DOCKERFILE, type DockerMode } from "@/lib/stack";

const mono = "font-mono text-sm";

/** What a suggestion dropdown says when it has nothing to list: not read yet (offer to read it), or really none. */
export function NoneKnown({
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

const MODES: { id: DockerMode; label: string }[] = [
  { id: "compose", label: "Docker Compose" },
  { id: "dockerfile", label: "Dockerfile" },
];

/**
 * How the repo is run: only with Docker. The runner builds and starts the Compose file (or the Dockerfile) straight
 * from the repo, with no checks and no scripts. The file name is empty for the default.
 */
export function RunProjectCard({
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
  // Only once the branch was read: no list yet means nothing is known.
  const noDockerFiles =
    !!suggestions && !!suggestions.dockerfiles && !!suggestions.compose_files &&
    !suggestions.dockerfiles.length && !suggestions.compose_files.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run the project</CardTitle>
        <CardDescription>
          The project must have a Dockerfile or a Docker Compose file at the root of the repo: it is the only way Mogo
          runs an app. It is started straight from that file, the repo&apos;s environment variables are passed in, and
          everything is removed when the run ends.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {noDockerFiles && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            No Dockerfile or Docker Compose file at the root of {branch}. Mogo can review this repo&apos;s PRs, but it
            cannot run the app until the repo has one.
          </p>
        )}
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
                    className="shrink-0"
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
