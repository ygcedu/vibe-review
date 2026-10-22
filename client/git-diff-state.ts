import { useQuery, useQueryClient } from "@tanstack/react-query";

export type DiffTab =
  | { id: string; source: "compare"; path: string; hash: string; status: string }
  | { id: string; source: "shelf"; path: string; entryId: string; label: string; status?: string }
  | { id: string; source: "working"; path: string; staged: boolean; status?: string }
  | { id: string; source: "history"; path: string; hash: string; status: string };

type DiffState = { tabs: DiffTab[]; activeTabId: string | null; revision: number };
const emptyState: DiffState = { tabs: [], activeTabId: null, revision: 0 };

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
