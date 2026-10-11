"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import type { ReviewState } from "@/lib/status";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-mono text-sm font-semibold">
            <span className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">PR</span>
            mogo<span className="text-muted-foreground">/agent</span>
          </Link>
          <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-success" /> self-hosted
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`panel max-h-[90vh] w-full overflow-auto p-6 shadow-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="font-mono text-muted-foreground hover:text-foreground">
            esc
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const stateStyle: Record<ReviewState, string> = {
  idle: "text-muted-foreground border-border bg-muted",
  queued: "text-info border-info/30 bg-info/10",
  running: "text-warning border-warning/30 bg-warning/10",
  failed: "text-destructive border-destructive/30 bg-destructive/10",
  done: "text-success border-success/30 bg-success/10",
};

const stateLabel: Record<ReviewState, string> = {
  idle: "not run",
  queued: "queued",
  running: "running",
  failed: "failed",
  done: "done",
};

export function StatusBadge({ state, label }: { state: ReviewState; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs ${stateStyle[state]}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full bg-current ${state === "running" || state === "queued" ? "animate-pulse-dot" : ""}`}
      />
      {label ?? stateLabel[state]}
    </span>
  );
}

export function ErrorText({ error }: { error: string }) {
  return error ? <p className="text-sm text-destructive">{error}</p> : null;
}

export function timeAgo(t: string | number) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Loads `fn` on mount and whenever `key` changes. While `poll(data)` is true it reloads every 3 s,
 * so pages refresh themselves while a run is in flight.
 */
export function useApi<T>(fn: () => Promise<T>, key: string, poll?: (data: T) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const fnRef = useRef(fn);
  const pollRef = useRef(poll);
  useEffect(() => {
    fnRef.current = fn;
    pollRef.current = poll;
  });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const d = await fnRef.current();
        if (!live) return;
        setData(d);
        setError("");
        if (pollRef.current?.(d)) timer = setTimeout(tick, 3000);
      } catch (e) {
        if (live) setError(errorMessage(e));
      }
    };
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, version]);

  /** Loads again now and restarts polling (call after starting a run). */
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload };
}

/** Wraps an async action with busy and error state for buttons and forms. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
