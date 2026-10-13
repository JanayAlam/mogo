import { create } from "zustand";

import { api, type InstalledRepo } from "@/lib/client";

/**
 * What the browser knows about the user's GitHub connection (the Mogo App installed on an account they can see) and
 * the repos it offers. Kept for the life of the page, not in storage: it is refreshed on every use, so a connection
 * made in another tab or an install finished at GitHub shows up the next time a dialog opens.
 *
 * `connected` is null until the first answer. Dialogs use what is known at once and `load()` in the background.
 */
interface GitHubStore {
  connected: boolean | null;
  repos: InstalledRepo[];
  loading: boolean;
  error: string; // the last load failed; the previous answer, if any, is kept
  load: () => Promise<void>;
}

export const useGitHub = create<GitHubStore>((set, get) => ({
  connected: null,
  repos: [],
  loading: false,
  error: "",
  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: "" });
    try {
      const { connected, repos } = await api.githubAccess();
      set({ connected, repos, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
