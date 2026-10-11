"use client";

import { useParams } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSkeleton } from "@/components/skeletons";
import {
  BackLink,
  Chip,
  ErrorText,
  Eyebrow,
  Field,
  Shell,
  useAction,
  useApi,
} from "@/components/ui-kit";
import { api, type Feature, type Project } from "@/lib/client";
import { cn } from "@/lib/utils";

/** /projects/[id]/features/new and /projects/[id]/features/[featureId]/edit */
export function FeatureFormPage() {
  const { id, featureId } = useParams<{ id: string; featureId?: string }>();
  const project = useApi(() => api.project(id), id);
  const feature = useApi(
    () => (featureId ? api.feature(featureId) : Promise.resolve(null)),
    featureId ?? "new",
  );
  const back = featureId
    ? `/projects/${id}/features/${featureId}`
    : `/projects/${id}`;
  const ready = project.data && (!featureId || feature.data);
  return (
    <Shell>
      <BackLink href={back}>back</BackLink>
      <ErrorText error={project.error || feature.error} />
      {ready ? (
        <FeatureForm project={project.data!} feature={feature.data} />
      ) : (
        !project.error && !feature.error && <FormSkeleton sections={2} />
      )}
    </Shell>
  );
}

interface Entry {
  included: boolean;
  pr_url: string;
  requirements: string;
}

function FeatureForm({
  project,
  feature,
}: {
  project: Project;
  feature: Feature | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(feature?.title ?? "");
  const [description, setDescription] = useState(feature?.description ?? "");
  const initialEntries = (): Record<string, Entry> =>
    Object.fromEntries(
      project.repos.map((r) => {
        const fr = feature?.repos.find((x) => x.repo_id === r.id);
        return [
          r.id,
          {
            included: !!fr || (!feature && project.repos.length === 1),
            pr_url: fr?.pr_url ?? "",
            requirements: fr?.requirements ?? "",
          },
        ];
      }),
    );
  const [entries, setEntries] = useState(initialEntries);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const action = useAction();
  const patch = (repoId: string, p: Partial<Entry>) =>
    setEntries((e) => ({ ...e, [repoId]: { ...e[repoId], ...p } }));
  const dropped =
    feature?.repos.filter(
      (r) => !entries[r.repo_id]?.included && r.latest_run,
    ) ?? [];

  function save() {
    const repos = project.repos
      .filter((r) => entries[r.id].included)
      .map((r) => ({
        repo_id: r.id,
        pr_url: entries[r.id].pr_url.trim(),
        requirements: entries[r.id].requirements.trim(),
      }));
    const body = { title: title.trim(), description: description.trim(), repos };
    action.run(async () => {
      const fid = feature
        ? (await api.updateFeature(feature.id, body), feature.id)
        : (await api.createFeature(project.id, body)).id;
      if (!feature) {
        // The page stays mounted in the background: start empty next time "New feature" is opened.
        setTitle("");
        setDescription("");
        setEntries(initialEntries());
      }
      router.push(`/projects/${project.id}/features/${fid}`);
    });
  }

  return (
    <form
      className="mt-3 space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!project.repos.some((r) => entries[r.id].included)) {
          action.setError("Pick at least one repo and give its PR link.");
          return;
        }
        if (dropped.length) setConfirmDrop(true);
        else save();
      }}>
      <div>
        <Eyebrow className="tracking-widest text-primary">{project.name}</Eyebrow>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {feature ? "Edit feature" : "New feature"}
        </h1>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <Field label="Feature name" htmlFor="f-title">
            <Input
              id="f-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Refund an order"
              autoFocus
            />
          </Field>
          <Field
            label="What the feature does"
            htmlFor="f-desc"
            hint="The agent turns this into acceptance criteria for each repo, read through the repo's role.">
            <Textarea
              id="f-desc"
              className="min-h-32"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Users can refund a paid order from the order page. The refund is idempotent, an order can be refunded once…"
            />
          </Field>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Repos and pull requests</h2>
          <p className="text-sm text-muted-foreground">
            Tick each repo the feature touches. Built-in checks (no duplicate
            types, file and folder conventions learned from the source branch)
            always run.
          </p>
        </div>
        {project.repos.map((r) => {
          const e = entries[r.id];
          return (
            <Card
              key={r.id}
              className={cn("transition-colors", e.included && "border-primary/40")}>
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={`inc-${r.id}`}
                    checked={e.included}
                    onCheckedChange={(v) => patch(r.id, { included: v === true })}
                  />
                  <Label
                    htmlFor={`inc-${r.id}`}
                    className="flex cursor-pointer items-center gap-2">
                    <Chip>{r.role || "no role"}</Chip>
                    <span className="font-mono">{r.full_name}</span>
                  </Label>
                </div>
              </CardHeader>
              {e.included && (
                <CardContent className="grid gap-4 p-4 pt-0">
                  <Field label="PR link" htmlFor={`pr-${r.id}`}>
                    <Input
                      id={`pr-${r.id}`}
                      className="font-mono"
                      required
                      value={e.pr_url}
                      onChange={(ev) => patch(r.id, { pr_url: ev.target.value })}
                      placeholder={`https://github.com/${r.full_name}/pull/123`}
                    />
                  </Field>
                  <Field
                    label="Requirements for this repo (optional)"
                    htmlFor={`req-${r.id}`}>
                    <Textarea
                      id={`req-${r.id}`}
                      className="min-h-20"
                      value={e.requirements}
                      onChange={(ev) =>
                        patch(r.id, { requirements: ev.target.value })
                      }
                      placeholder={`What to check in ${r.role || "this repo"} in particular: endpoints, screens, edge cases…`}
                    />
                  </Field>
                </CardContent>
              )}
            </Card>
          );
        })}
      </section>

      <ErrorText error={action.error} />
      <div className="flex justify-end gap-2">
        <Button loading={action.busy}>
          {feature ? "Save" : "Create feature"}
        </Button>
      </div>

      <AlertDialog open={confirmDrop} onOpenChange={setConfirmDrop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove repos from this feature?</AlertDialogTitle>
            <AlertDialogDescription>
              Removing {dropped.map((r) => r.full_name).join(", ")} deletes
              their run history for this feature.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={save}>
              Remove and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
