import { create } from 'zustand';

export interface TerminalTab {
  id: string;
  worktreePath: string;
  projectId: string | null;
  title?: string;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  addTab: (id: string, worktreePath: string, projectId: string | null) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabTitle: (id: string, title: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (id: string, worktreePath: string, projectId: string | null) => {
    set({
      tabs: [...get().tabs, { id, worktreePath, projectId }],
      activeTabId: id,
    });
  },

  removeTab: (id: string) => {
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

    set({ tabs: newTabs, activeTabId: newActiveId });
  },

  setActiveTab: (id: string) => {
    set({ activeTabId: id });
  },

  setTabTitle: (id: string, title: string) => {
    set({
      tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
    });
  },
}));
