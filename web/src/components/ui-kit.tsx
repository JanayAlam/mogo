"use client";

import { ArrowLeft, LogOut } from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Button,
  buttonVariants,
  type ButtonProps,
} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/client";
import type { ReviewState } from "@/lib/status";
import { cn } from "@/lib/utils";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 font-mono text-sm font-semibold rounded bg-primary px-1.5 py-0.5 text-primary-foreground">
            mogo
          </Link>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}

/** Shown only when this deployment has a login (APP_PASSWORD). */
function LogoutButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    api
      .session()
      .then((s) => setShow(s.login_required))
      .catch(() => setShow(false));
  }, []);
  if (!show) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await api.logout().catch(() => {});
        // full reload on purpose: drops any client state of the signed-in session
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/login";
      }}>
      <LogOut /> Log out
    </Button>
  );
}

/** Back to the parent page, shown above a page title. */
export function BackLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:bg-transparent px-0">
      <Link href={href}>
        <ArrowLeft /> {children}
      </Link>
    </Button>
  );
}

/** A dialog with a title; open state is owned by the caller. */
export function Modal({
  open,
  onClose,
  title,
  description,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[90vh] overflow-y-auto",
          wide ? "max-w-2xl" : "max-w-lg",
        )}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** A button that asks before doing something destructive. */
export function ConfirmButton({
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  children,
  ...button
}: ButtonProps & {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button {...button}>{children}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Label, control, optional hint. */
export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Small mono uppercase heading (section names, eyebrow text). */
export function Eyebrow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "font-mono text-xs uppercase tracking-wider text-muted-foreground",
        className,
      )}>
      {children}
    </p>
  );
}

/** Mono tag for repo roles and names. */
export function Chip({
  className,
  children,
  title,
}: {
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <Badge
      variant="secondary"
      title={title}
      className={cn("whitespace-nowrap font-mono font-normal", className)}>
      {children}
    </Badge>
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

export function StatusBadge({
  state,
  label,
}: {
  state: ReviewState;
  label?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-mono font-normal", stateStyle[state])}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-current",
          (state === "running" || state === "queued") && "animate-pulse-dot",
        )}
      />
      {label ?? stateLabel[state]}
    </Badge>
  );
}

export function ErrorText({ error }: { error: string }) {
  return error ? <p className="text-sm text-destructive">{error}</p> : null;
}

export function timeAgo(t: string | number) {
  const s = Math.max(
    0,
    Math.floor((Date.now() - new Date(t).getTime()) / 1000),
  );
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

/**
 * Loads `fn` on mount and whenever `key` changes. While `poll(data)` is true it reloads every 3 s,
 * so pages refresh themselves while a run is in flight.
 */
export function useApi<T>(
  fn: () => Promise<T>,
  key: string,
  poll?: (data: T) => boolean,
) {
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
