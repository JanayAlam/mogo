"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, Copy, GripVertical, KeyRound, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FormSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ConfirmButton,
  ErrorText,
  errorMessage,
  Eyebrow,
  Field,
  Modal,
  refreshSession,
  useAction,
  useApi,
} from "@/components/ui-kit";
import { api, type LlmConnection } from "@/lib/client";
import { MODEL_NOTE, PROVIDER_INFO, PROVIDERS, type Provider } from "@/lib/llm-providers";
import { cn } from "@/lib/utils";

/** Settings > LLM connections: one card per connection, two columns on desktop, one on mobile. */
export function LlmConnections() {
  const list = useApi(api.llmConnections, "llm-connections");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LlmConnection | null>(null);
  // The order shown right after a drop, until the server's list is reloaded (a new list replaces it).
  const [dropped, setDropped] = useState<{ base: LlmConnection[]; items: LlmConnection[] } | null>(null);
  const server = list.data?.connections;
  const items = dropped && dropped.base === server ? dropped.items : (server ?? []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // The session says whether runs can start (a connection is on); it changes with every save here.
  const changed = () => {
    list.reload();
    refreshSession();
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((c) => c.id === active.id);
    const to = items.findIndex((c) => c.id === over.id);
    const next = arrayMove(items, from, to);
    setDropped({ base: server ?? [], items: next });
    try {
      await api.reorderLlmConnections(next.map((c) => c.id));
      changed();
    } catch (e) {
      toast.error(errorMessage(e));
      list.reload(); // back to what the server has
    }
  };

  // Rank among the switched-on connections: the first is tried first, the rest are fallbacks in this order.
  const ranks = new Map(items.filter((c) => c.active).map((c, i) => [c.id, i + 1]));

  const connections = list.data?.connections;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold tracking-tight">LLM connections</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reviews run on your own model, billed to your own account. They try the switched-on connections from first to
            last and move to the next one when a connection fails. Drag a card by its handle to change the order. API
            keys are stored encrypted and never shown again.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus /> Add connection
        </Button>
      </div>

      <ErrorText error={list.error} />
      {!connections && !list.error && <FormSkeleton />}
      {connections?.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No connection yet. Add one to start running reviews.
          </CardContent>
        </Card>
      )}
      {connections && connections.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((c) => c.id)} strategy={rectSortingStrategy}>
            <div className="grid gap-4 md:grid-cols-2">
              {items.map((c) => (
                <ConnectionCard
                  key={c.id}
                  c={c}
                  rank={ranks.get(c.id) ?? 0}
                  onChanged={changed}
                  onEdit={() => setEditing(c)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Modal
        wide
        open={adding}
        onClose={() => setAdding(false)}
        title="Add an LLM connection"
        description="The key is checked with the provider before it is saved."
      >
        <ConnectionForm
          key={String(adding)}
          onDone={() => {
            setAdding(false);
            changed();
          }}
        />
      </Modal>
      <Modal
        wide
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${PROVIDER_INFO[editing.provider].label}` : ""}
        description="Changes are checked with the provider before they are saved."
      >
        {editing && (
          <ConnectionForm
            key={editing.id}
            existing={editing}
            onDone={() => {
              setEditing(null);
              changed();
            }}
          />
        )}
      </Modal>
    </section>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ConnectionCard({
  c,
  rank,
  onChanged,
  onEdit,
}: {
  c: LlmConnection;
  rank: number; // 1 = tried first, 2 = first fallback, ...; 0 when switched off
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: c.id,
  });
  const toggle = useAction();
  const test = useAction();
  const remove = useAction();
  const [guideOpen, setGuideOpen] = useState(false);
  const label = PROVIDER_INFO[c.provider].label;

  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "h-full transition-colors",
        c.active && "border-primary/50",
        isDragging && "relative z-10 shadow-lg",
      )}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag to change the order of ${label}`}
            className="-ml-2 mt-0.5 shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing">
            <GripVertical className="size-4" />
          </button>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="truncate font-semibold leading-tight">{label}</h3>
            <Eyebrow className={c.active ? "text-success" : undefined}>
              {!c.active ? "off" : rank === 1 ? "primary" : `fallback ${rank - 1}`}
            </Eyebrow>
          </div>
          <Switch
            aria-label={c.active ? `Switch off ${label}` : `Switch on ${label}`}
            checked={c.active}
            disabled={toggle.busy}
            onCheckedChange={(active) =>
              toggle.run(async () => {
                await api.updateLlmConnection(c.id, { active });
                onChanged();
                toast.success(active ? `${label} is on` : `${label} is off`);
              })
            }
          />
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Model</dt>
          <dd className="truncate font-mono" title={c.model}>
            {c.model}
          </dd>
          <dt className="text-muted-foreground">Endpoint</dt>
          <dd className="truncate font-mono" title={c.base_url}>
            {hostOf(c.base_url)}
          </dd>
          <dt className="text-muted-foreground">API key</dt>
          <dd className="flex items-center gap-1.5">
            <KeyRound className="size-3.5 text-muted-foreground" />
            {c.has_key ? "Stored, encrypted" : "None"}
          </dd>
        </dl>

        {c.provider === "custom" && (
          <Collapsible open={guideOpen} onOpenChange={setGuideOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
                <ChevronDown className={cn("transition-transform", guideOpen && "rotate-180")} />
                How the tunnel works
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <TunnelGuide />
            </CollapsibleContent>
          </Collapsible>
        )}

        <ErrorText error={toggle.error || test.error || remove.error} />
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            loading={test.busy}
            onClick={() =>
              test.run(async () => {
                await api.testLlmConnection(c.id);
                toast.success(`${label} works`);
              })
            }
          >
            <Zap /> Test
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
          <ConfirmButton
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            title={`Delete ${label}?`}
            description="The stored key is deleted with it. Reviews use the remaining switched-on connections."
            onConfirm={() =>
              remove.run(async () => {
                await api.deleteLlmConnection(c.id);
                onChanged();
                toast.success("Connection deleted");
              })
            }
          >
            <Trash2 /> Delete
          </ConfirmButton>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionForm({ existing, onDone }: { existing?: LlmConnection; onDone: () => void }) {
  const [provider, setProvider] = useState<Provider>(existing?.provider ?? "openai");
  const [baseUrl, setBaseUrl] = useState(existing?.provider === "custom" ? existing.base_url : "");
  const [model, setModel] = useState(existing?.model ?? "");
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const action = useAction();
  const info = PROVIDER_INFO[provider];
  const isCustom = provider === "custom";
  const keyStored = !!existing?.has_key && !removeKey;

  const submit = () =>
    action.run(async () => {
      if (existing) {
        await api.updateLlmConnection(existing.id, {
          model: model.trim(),
          ...(isCustom && { base_url: baseUrl.trim() }),
          ...(key.trim() ? { api_key: key.trim() } : removeKey ? { api_key: null } : {}),
        });
      } else {
        await api.addLlmConnection({
          provider,
          model: model.trim(),
          ...(isCustom && { base_url: baseUrl.trim() }),
          ...(key.trim() && { api_key: key.trim() }),
        });
      }
      toast.success(existing ? "Connection saved" : "Connection added");
      onDone();
    });

  return (
    <form
      className="min-w-0 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!existing && (
        <Field label="Provider">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {PROVIDERS.map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={p === provider ? "default" : "outline"}
                aria-pressed={p === provider}
                onClick={() => setProvider(p)}
              >
                {PROVIDER_INFO[p].label}
              </Button>
            ))}
          </div>
        </Field>
      )}

      {isCustom && (
        <Field
          label="Base URL"
          htmlFor="llm-url"
          hint="The public https address of your server, ending in /v1. See the steps below."
        >
          <Input
            id="llm-url"
            className="font-mono"
            required
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-tunnel.trycloudflare.com/v1"
          />
        </Field>
      )}

      <Field label="Model" htmlFor="llm-model" hint={`${info.model_hint}. ${MODEL_NOTE}`}>
        <Input
          id="llm-model"
          className="font-mono"
          required
          autoCapitalize="none"
          spellCheck={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </Field>

      <Field
        label={isCustom ? "API key (optional)" : "API key"}
        htmlFor="llm-key"
        hint={keyStored ? "A key is stored. Leave empty to keep it." : info.key_hint}
      >
        <Input
          id="llm-key"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono"
          required={!isCustom && !existing}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={keyStored ? "••••••••" : isCustom ? "" : `${info.key_prefix}…`}
        />
      </Field>
      {isCustom && existing?.has_key && !key && (
        <div className="flex items-center gap-2">
          <Checkbox id="llm-remove" checked={removeKey} onCheckedChange={(v) => setRemoveKey(v === true)} />
          <Label htmlFor="llm-remove" className="font-normal text-muted-foreground">
            Remove the stored key
          </Label>
        </div>
      )}

      {isCustom && (
        <div className="space-y-2">
          <Eyebrow>Reach your local model</Eyebrow>
          <TunnelGuide />
        </div>
      )}

      <ErrorText error={action.error} />
      <div className="flex justify-end">
        <Button loading={action.busy}>{existing ? "Save" : "Check and add"}</Button>
      </div>
    </form>
  );
}

/**
 * Reviews run on GitHub Actions, which cannot reach a server on the user's machine: it has to be exposed to the
 * internet with a tunnel first. Ollama's port is used in the examples (LM Studio listens on 1234).
 */
function TunnelGuide() {
  return (
    <div className="min-w-0 space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
      <p className="text-muted-foreground">
        Reviews run on GitHub, which cannot reach <span className="font-mono">localhost</span>. Expose your server with
        a tunnel, then paste the public address here.
      </p>
      <ol className="list-decimal space-y-3 pl-5 marker:text-muted-foreground [&>li]:min-w-0">
        <li className="space-y-1.5">
          Start your server. Ollama listens on port 11434, LM Studio on 1234.
          <Command text="ollama serve" />
        </li>
        <li className="space-y-1.5">
          Open a tunnel to that port. Pick one:
          <p className="text-xs text-muted-foreground">Cloudflare (no account needed)</p>
          <Command text="cloudflared tunnel --url http://localhost:11434" />
          <p className="text-xs text-muted-foreground">ngrok</p>
          <Command text="ngrok http 11434 --host-header=localhost:11434" />
        </li>
        <li>
          The tunnel prints an https address such as{" "}
          <span className="font-mono">https://abc-123.trycloudflare.com</span>. Use it with{" "}
          <span className="font-mono">/v1</span> added as the Base URL:{" "}
          <span className="font-mono break-all">https://abc-123.trycloudflare.com/v1</span>
        </li>
        <li className="space-y-1.5">
          Use the model name your server lists as the Model.
          <Command text="ollama list" />
        </li>
        <li>Leave the API key empty unless you put your own authentication in front of the server.</li>
      </ol>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground marker:text-muted-foreground">
        <li>Keep the server and the tunnel running while reviews run.</li>
        <li>Free tunnel addresses change when the tunnel restarts. Edit the connection with the new one.</li>
        <li>Anyone who has the address can use your model. Do not share it.</li>
        <li>{MODEL_NOTE}</li>
      </ul>
    </div>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 rounded-md border bg-background px-3 py-1.5">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">{text}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="size-7 shrink-0 p-0"
        aria-label={`Copy ${text}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch (e) {
            toast.error(`Cannot copy: ${errorMessage(e)}`);
          }
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
