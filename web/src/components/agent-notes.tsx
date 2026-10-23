"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { NoneKnown } from "@/components/repo-run-config";
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
import { Textarea } from "@/components/ui/textarea";
import type { Suggestions } from "@/lib/projects";
import { conventionFileError, MAX_ENTRY_CHARS, type ConfigForm } from "@/lib/repo-form";

const mono = "font-mono text-sm";

/**
 * Many one-line entries: type one and press Enter (or Add), remove any with the x. `check` returns what is wrong with
 * an entry; `picker` is an optional dropdown of suggestions next to the input.
 */
function EntryList({
  id,
  items,
  onChange,
  placeholder,
  check,
  picker,
  mono: monoFont,
  chips,
}: {
  id: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  check?: (entry: string) => string | null;
  picker?: (add: (entry: string) => void) => ReactNode;
  mono?: boolean;
  /** Short entries (file names) sit side by side and wrap; long ones (rules) get a line each. */
  chips?: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const add = (raw: string) => {
    const entry = raw.trim();
    const problem = !entry ? "Type one first." : entry.length > MAX_ENTRY_CHARS ? "That is too long." : (check?.(entry) ?? null);
    if (problem) return setError(problem);
    if (!items.includes(entry)) onChange([...items, entry]);
    setText("");
    setError("");
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={id}
          className={monoFont ? mono : undefined}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault(); // Enter adds the entry; it must not save the whole form
            add(text);
          }}
        />
        <Button type="button" variant="outline" onClick={() => add(text)}>
          <Plus /> Add
        </Button>
        {picker?.(add)}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {items.length > 0 && (
        <ul className={chips ? "flex flex-wrap gap-2" : "space-y-1.5"}>
          {items.map((item) => (
            <li key={item} className={`flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5 ${chips ? "max-w-full" : ""}`}>
              <span className={monoFont ? `${mono} break-all` : "text-sm"}>{item}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(items.filter((i) => i !== item))}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A dropdown of the repo's convention files not added yet; a repo that was not read yet offers to read it. */
function ConventionPicker({
  branch,
  added,
  suggestions,
  onPick,
  onRead,
}: {
  branch: string;
  added: string[];
  suggestions: Suggestions | null | undefined;
  onPick: (file: string) => void;
  onRead?: () => void;
}) {
  const found = suggestions?.convention_files && [...suggestions.convention_files, ...(suggestions.markdown_files ?? [])];
  const options = (found ?? []).filter((f) => !added.includes(f));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label="Files found in the repo"
          title="Pick a file found at the repo root"
        >
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>Markdown files at the root of {branch}</DropdownMenuLabel>
        {!options.length && (
          <NoneKnown
            what="files"
            unread={found === undefined}
            empty={found?.length ? "All of them are added." : "No markdown file at the root. Type a path instead."}
            onRead={onRead}
          />
        )}
        {options.map((name) => (
          <DropdownMenuItem key={name} className="font-mono text-sm" onSelect={() => onPick(name)}>
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What the agent is told about a repo on top of the project, the feature and the repo's role. */
export function AgentNotesCard({
  form,
  branch,
  suggestions,
  onChange,
  onRead,
}: {
  form: ConfigForm;
  branch: string;
  suggestions: Suggestions | null | undefined;
  onChange: (patch: Partial<Pick<ConfigForm, "conventions" | "rules" | "notes">>) => void;
  onRead?: () => void;
}) {
  const conventions = form.conventions ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent notes</CardTitle>
        <CardDescription>
          What the agent should know about this repo when it reviews a PR, on top of the project description, the
          feature and the repo&apos;s role. All three are optional.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <Field
          label="Convention files"
          htmlFor="conventions"
          hint="Files in the repo that describe how your team writes code. The agent reads them and judges the PR against them. CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules and the like are added automatically when the repo has them; add any other markdown file (e.g. docs/architecture.md) by typing its path or picking one from the list."
        >
          <EntryList
            id="conventions"
            mono
            chips
            items={conventions}
            onChange={(conventions) => onChange({ conventions })}
            placeholder="CLAUDE.md"
            check={conventionFileError}
            picker={(add) => (
              <ConventionPicker branch={branch} added={conventions} suggestions={suggestions} onPick={add} onRead={onRead} />
            )}
          />
        </Field>
        <Field
          label="Extra rules"
          htmlFor="rules"
          hint="Short rules the agent checks every diff against, one at a time. Use it for what is not written down in a file, or to stress something that matters most. Write each as an instruction."
        >
          <EntryList
            id="rules"
            items={form.rules}
            onChange={(rules) => onChange({ rules })}
            placeholder="Every API route validates its input"
          />
        </Field>
        <Field
          label="Testing notes"
          htmlFor="notes"
          hint="Whatever the agent needs to try the running app: test accounts and how to log in, seeded data, ports and routes worth hitting, and what not to test (payments, emails, third-party services)."
        >
          <Textarea
            id="notes"
            rows={5}
            value={form.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder={
              "Log in as admin@example.com / password123 (seeded).\nThe API is on /api, the health route is /api/health.\nDo not test the email or payment flows."
            }
          />
        </Field>
      </CardContent>
    </Card>
  );
}
