import { create } from 'zustand';
import { reorderArray } from '@/lib/fileUtils';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';

export interface TerminalTab {
  id: string;
  cwd: string;
  title?: string;
  customName?: string;
  gitRoot?: string | null; // undefined = not resolved, null = not in a repo, string = git root
  repoName?: string | null;
  mainRepoRoot?: string | null;
  worktreeName?: string | null;
  branchName?: string | null;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  busyMap: Record<string, boolean>;
  addTab: (id: string, cwd: string, afterTabId?: string) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabTitle: (id: string, title: string) => void;
  setTabCustomName: (id: string, customName: string | undefined) => void;
  updateTabCwd: (id: string, cwd: string) => void;
  setTabRepoInfo: (
    id: string,
    info: {
      gitRoot: string | null;
      repoName?: string | null;
      mainRepoRoot?: string | null;
      worktreeName?: string | null;
      branchName?: string | null;
    }
  ) => void;
  setTerminalBusy: (id: string, busy: boolean) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  busyMap: {},

  addTab: (id: string, cwd: string, afterTabId?: string) => {
    const tabs = get().tabs;
    const newTab = { id, cwd };
    if (afterTabId) {
      const afterIndex = tabs.findIndex((t) => t.id === afterTabId);
      if (afterIndex !== -1) {
        const newTabs = [...tabs];
        newTabs.splice(afterIndex + 1, 0, newTab);
        set({ tabs: newTabs, activeTabId: id });
        return;
      }
    }
    set({ tabs: [...tabs, newTab], activeTabId: id });
  },

  removeTab: (id: string) => {
    // Remove from layout first (layout store handles focus transfer)
    useTerminalLayoutStore.getState().removeFromLayout(id);

    const { tabs, activeTabId } = get();
    const newTabs = tabs.filter((t) => t.id !== id);
    let newActiveId = activeTabId;

    if (activeTabId === id) {
      const removedIndex = tabs.findIndex((t) => t.id === id);
      if (newTabs.length > 0) {
        newActiveId = newTabs[Math.min(removedIndex, newTabs.length - 1)].id;
      } else {
        newActiveId = null;
      }
    }

    const busyMap = { ...get().busyMap };
    delete busyMap[id];
    set({ tabs: newTabs, activeTabId: newActiveId, busyMap });
  },

  setActiveTab: (id: string) => {
    set({ activeTabId: id });
  },

  setTabTitle: (id: string, title: string) => {
    set({
      tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
    });
  },

  setTabCustomName: (id: string, customName: string | undefined) => {
    set({
      tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, customName } : tab)),
    });
  },

  updateTabCwd: (id: string, cwd: string) => {
    const tabs = get().tabs;
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tab.cwd === cwd) {
      if (!tab) console.warn('[CWD] updateTabCwd: tab not found', { id });
      return;
    }

    if (import.meta.env.DEV)
      console.log('[CWD] Store updated:', { tabId: id, from: tab.cwd, to: cwd });
    set({
      tabs: tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              cwd,
              gitRoot: undefined,
              repoName: undefined,
              mainRepoRoot: undefined,
              worktreeName: undefined,
              branchName: undefined,
            }
          : t
      ),
    });
  },

  setTabRepoInfo: (id, info) => {
    set({
      tabs: get().tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              gitRoot: info.gitRoot,
              repoName: info.repoName ?? null,
              mainRepoRoot: info.mainRepoRoot ?? null,
              worktreeName: info.worktreeName ?? null,
              branchName: info.branchName ?? null,
            }
          : t
      ),
    });
  },

  setTerminalBusy: (id: string, busy: boolean) => {
    if (get().busyMap[id] === busy) return;
    set({ busyMap: { ...get().busyMap, [id]: busy } });
  },

  reorderTabs: (fromIndex: number, toIndex: number) => {
    set({ tabs: reorderArray(get().tabs, fromIndex, toIndex) });
  },
}));
