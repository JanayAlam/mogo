"use client";

import { useEffect, useRef, useState } from "react";

import { useGitHub } from "@/lib/github-store";

/** The popup lands on CONNECTED_PATH when GitHub is done; that page tells the app over this channel. */
export const GITHUB_CHANNEL = "mogo-github";
export const CONNECTED_PATH = "/github/connected";

const installPath = (next: string) => `/api/auth/github/install?next=${encodeURIComponent(next)}`;

/**
 * Connect GitHub (install the Mogo App, or change its repos) in a popup window, so the page and its open dialog stay
 * where they are. GitHub cannot be shown inside a dialog (it refuses to be framed), so a popup is the closest thing.
 *
 * When the popup is done the GitHub store reloads and whatever dialog shows it updates. It reloads too when the
 * window regains focus, which covers a popup that was closed by hand. If the browser blocks the popup, the page goes
 * to GitHub as a full page and comes back to `returnTo`.
 */
export function useConnectGitHub(returnTo: string) {
  const load = useGitHub((s) => s.load);
  const [waiting, setWaiting] = useState(false);
  const waitingRef = useRef(false);

  useEffect(() => {
    const refresh = () => {
      if (!waitingRef.current) return;
      void load().then(() => {
        waitingRef.current = false;
        setWaiting(false);
      });
    };
    const channel = new BroadcastChannel(GITHUB_CHANNEL);
    channel.onmessage = refresh;
    window.addEventListener("focus", refresh);
    return () => {
      channel.close();
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const open = () => {
    const popup = window.open(installPath(CONNECTED_PATH), "mogo-github", "popup,width=780,height=860");
    if (!popup) {
      window.location.href = installPath(returnTo);
      return;
    }
    popup.focus();
    waitingRef.current = true;
    setWaiting(true);
  };

  return { open, waiting };
}
