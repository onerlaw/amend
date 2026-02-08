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
  addTab: (id: string, worktreePath: string, projectId: string | null, afterTabId?: string) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabTitle: (id: string, title: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (id: string, worktreePath: string, projectId: string | null, afterTabId?: string) => {
    const tabs = get().tabs;
    const newTab = { id, worktreePath, projectId };
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

  reorderTabs: (fromIndex: number, toIndex: number) => {
    const tabs = [...get().tabs];
    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);
    set({ tabs });
  },
}));
