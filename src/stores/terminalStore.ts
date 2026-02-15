import { create } from 'zustand';
import { reorderArray } from '@/lib/fileUtils';
import { useProjectStore } from '@/stores/projectStore';

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
  updateTabCwd: (id: string, cwd: string) => void;
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

  updateTabCwd: (id: string, cwd: string) => {
    const tabs = get().tabs;
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tab.worktreePath === cwd) return;

    // Try to match cwd to a known project (most specific path wins)
    const projects = useProjectStore.getState().projects;
    const matchedProject = projects
      .filter((p) => cwd.startsWith(p.path))
      .sort((a, b) => b.path.length - a.path.length)[0];

    set({
      tabs: tabs.map((t) =>
        t.id === id
          ? { ...t, worktreePath: cwd, projectId: matchedProject?.id ?? t.projectId }
          : t
      ),
    });
  },

  reorderTabs: (fromIndex: number, toIndex: number) => {
    set({ tabs: reorderArray(get().tabs, fromIndex, toIndex) });
  },
}));
