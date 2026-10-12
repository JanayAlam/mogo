"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSkeleton } from "@/components/skeletons";
import {
  ErrorText,
  Eyebrow,
  Field,
  refreshSession,
  Shell,
  useAction,
  useApi,
  useSession,
} from "@/components/ui-kit";
import { api, type LlmSettings } from "@/lib/client";

/** Base URLs of common OpenAI-compatible APIs; anything else goes in by hand. */
const PRESETS = [
  { name: "OpenAI", base_url: "https://api.openai.com/v1" },
  { name: "Anthropic", base_url: "https://api.anthropic.com/v1" },
  { name: "DeepSeek", base_url: "https://api.deepseek.com" },
  { name: "OpenRouter", base_url: "https://openrouter.ai/api/v1" },
];

export function SettingsView() {
  const llm = useApi(api.llm, "llm");
  const session = useSession();
  return (
    <Shell>
      <div className="mb-8">
        <Eyebrow className="tracking-widest text-primary">Account</Eyebrow>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Settings</h1>
      </div>
      <div className="grid max-w-2xl gap-6">
        <ErrorText error={llm.error} />
        {llm.data ? <LlmCard current={llm.data} onSaved={llm.reload} /> : !llm.error && <FormSkeleton />}
        <Card>
          <CardHeader>
            <CardTitle>GitHub</CardTitle>
            <CardDescription>
              Mogo reads pull requests and posts its reviews as <span className="font-mono">mogo[bot]</span> on the
              repos where you install its GitHub App. Signed in as{" "}
              <span className="font-mono">{session?.user.login ?? "…"}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="/api/auth/github/install?next=/settings">Choose repos for Mogo</a>
            </Button>
            {session && (
              <Button asChild variant="ghost">
                <a href={session.app_url} target="_blank" rel="noreferrer">
                  The App on GitHub <ExternalLink />
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function LlmCard({ current, onSaved }: { current: LlmSettings; onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState(current.base_url);
  const [model, setModel] = useState(current.model);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const action = useAction();

  return (
    <Card>
      <CardHeader>
        <CardTitle>LLM</CardTitle>
        <CardDescription>
          The model that reviews your pull requests, billed to your own account. Any OpenAI-compatible API works,
          including a local server behind a public tunnel. The key is stored encrypted and never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await api.setLlm({
                base_url: baseUrl.trim(),
                model: model.trim(),
                api_key: key.trim() ? key.trim() : removeKey ? null : undefined,
              });
              setKey("");
              setRemoveKey(false);
              onSaved();
              refreshSession();
              toast.success("LLM saved");
            });
          }}>
          <Field label="API base URL" htmlFor="llm-url">
            <Input
              id="llm-url"
              className="font-mono"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.name} type="button" variant="outline" size="sm" onClick={() => setBaseUrl(p.base_url)}>
                {p.name}
              </Button>
            ))}
          </div>
          <Field label="Model" htmlFor="llm-model">
            <Input
              id="llm-model"
              className="font-mono"
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="the model id your provider uses"
            />
          </Field>
          <Field
            label="API key"
            htmlFor="llm-key"
            hint={current.has_key ? "A key is stored. Leave empty to keep it." : "Optional for local servers."}>
            <Input
              id="llm-key"
              type="password"
              autoComplete="off"
              className="font-mono"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={current.has_key ? "••••••••" : ""}
            />
          </Field>
          {current.has_key && !key && (
            <div className="flex items-center gap-2">
              <Checkbox id="llm-remove" checked={removeKey} onCheckedChange={(v) => setRemoveKey(v === true)} />
              <Label htmlFor="llm-remove" className="font-normal text-muted-foreground">
                Remove the stored key
              </Label>
            </div>
          )}
          <ErrorText error={action.error} />
          <div className="flex justify-end">
            <Button loading={action.busy}>Save</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
