import { create } from 'zustand';

export interface TerminalTab {
  id: string;
  title: string;
  worktreePath: string;
  projectId: string | null;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  addTab: (id: string, worktreePath: string, projectId: string | null, title?: string) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabTitle: (id: string, title: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (id: string, worktreePath: string, projectId: string | null, title?: string) => {
    const { tabs } = get();
    const tabNumber = tabs.length + 1;
    set({
      tabs: [...tabs, { id, worktreePath, projectId, title: title || `Terminal ${tabNumber}` }],
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

  updateTabTitle: (id: string, title: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },
}));
