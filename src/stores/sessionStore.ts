import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BrowseContextState {
  paths: string[];
  activePath: string | null;
}

interface SessionState {
  terminalCwds: string[];
  activeTerminalIndex: number;
  browseFilePaths: Record<string, BrowseContextState>;
  saveTerminals: (cwds: string[], activeIndex: number) => void;
  saveBrowseState: (state: Record<string, BrowseContextState>) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      terminalCwds: [],
      activeTerminalIndex: 0,
      browseFilePaths: {},
      saveTerminals: (cwds, activeIndex) =>
        set({ terminalCwds: cwds, activeTerminalIndex: activeIndex }),
      saveBrowseState: (browseFilePaths) => set({ browseFilePaths }),
    }),
    {
      name: 'amend-session',
      partialize: (state) => ({
        terminalCwds: state.terminalCwds,
        activeTerminalIndex: state.activeTerminalIndex,
        browseFilePaths: state.browseFilePaths,
      }),
    }
  )
);
