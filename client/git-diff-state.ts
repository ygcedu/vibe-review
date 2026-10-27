import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTabState, type PluginTab } from "@getpaseo/plugin/client";
import { savedDiffSchema, emptySavedDiff, serializeSavedDiff } from "./diff/saved-diff-state";

export type DiffTab =
  | { id: string; source: "compare"; path: string; hash: string; status: string }
  | { id: string; source: "shelf"; path: string; entryId: string; label: string; status?: string }
  | { id: string; source: "working"; path: string; staged: boolean; status?: string }
  | { id: string; source: "history"; path: string; hash: string; status: string };

type DiffState = { tabs: DiffTab[]; activeTabId: string | null; revision: number };
const emptyState: DiffState = { tabs: [], activeTabId: null, revision: 0 };

/** Keep the workspace cache for cross-panel actions; persist the visible diff tab
 * through Paseo so reopening the app restores its file selection. */
export function useGitDiffPersistence(workspaceId: string, tab: PluginTab) {
  const cache = useQueryClient();
  const state = useGitDiffState(workspaceId);
  const [saved, save] = useTabState(tab, savedDiffSchema, emptySavedDiff);
  const hydration = useRef({ workspaceId: "", pending: false });
  useEffect(() => {
    if (hydration.current.workspaceId !== workspaceId) {
      hydration.current = { workspaceId, pending: false };
      // A file opened from Commit/History just before mount takes precedence.
      if (state.revision === 0 && state.tabs.length === 0 && saved.tabs.length > 0) {
        hydration.current.pending = true;
        cache.setQueryData<DiffState>(["vibe-review", "git-diff", workspaceId], {
          ...saved,
          activeTabId: saved.tabs.some((item) => item.id === saved.activeTabId) ? saved.activeTabId : saved.tabs[0].id,
          revision: 1,
        });
        return;
      }
    }
    // Strict Mode can replay the mount effect before the cache update renders.
    // Do not overwrite the restored selection with that render's empty state.
    if (hydration.current.pending && state.revision === 0) return;
    hydration.current.pending = false;
    const next = { tabs: state.tabs, activeTabId: state.activeTabId };
    if (serializeSavedDiff(next) !== serializeSavedDiff(saved)) save(next);
  }, [workspaceId, cache, state.tabs, state.activeTabId, state.revision, saved, save]);
}

export function useGitDiffState(workspaceId: string) {
  const cache = useQueryClient();
  const key = ["vibe-review", "git-diff", workspaceId];
  const { data: state = emptyState } = useQuery<DiffState>({
    queryKey: key,
    queryFn: () => emptyState,
    enabled: false,
    initialData: emptyState,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  function update(change: (current: DiffState) => DiffState) {
    cache.setQueryData<DiffState>(key, (current) => change(current ?? emptyState));
  }

  function openTab(tab: DiffTab) {
    update((current) => {
      const alreadyOpen = current.tabs.some((item) => item.id === tab.id);
      const tabs = alreadyOpen
        ? current.tabs.map((item) => item.id === tab.id ? tab : item)
        : [...current.tabs, tab];
      return { ...current, tabs, activeTabId: tab.id, revision: current.revision + 1 };
    });
  }

  function closeTab(id: string) {
    update((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      const tabs = current.tabs.filter((tab) => tab.id !== id);
      const neighbor = tabs[Math.min(index, tabs.length - 1)];
      const activeTabId = current.activeTabId === id ? neighbor?.id ?? null : current.activeTabId;
      return { ...current, tabs, activeTabId };
    });
  }

  return {
    ...state,
    openTab,
    closeTab,
    refresh: () => update((current) => ({ ...current, revision: current.revision + 1 })),
    setTabs: (change: (tabs: DiffTab[]) => DiffTab[]) => update((current) => ({ ...current, tabs: change(current.tabs) })),
    setActiveTabId: (activeTabId: string | null) => update((current) => ({ ...current, activeTabId })),
  };
}
