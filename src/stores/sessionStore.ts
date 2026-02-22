import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LayoutNode, SerializedLayoutNode, serializeLayout } from '@/lib/layoutTree';

interface BrowseContextState {
  paths: string[];
  activePath: string | null;
}

interface SessionState {
  terminalCwds: string[];
  activeTerminalIndex: number;
  terminalLayout: SerializedLayoutNode | null;
  browseFilePaths: Record<string, BrowseContextState>;
  saveTerminals: (
    cwds: string[],
    activeIndex: number,
    layout?: LayoutNode | null,
    terminalIds?: string[]
  ) => void;
  saveBrowseState: (state: Record<string, BrowseContextState>) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      terminalCwds: [],
      activeTerminalIndex: 0,
      terminalLayout: null,
      browseFilePaths: {},
      saveTerminals: (cwds, activeIndex, layout, terminalIds) => {
        let serializedLayout: SerializedLayoutNode | null = null;
        if (layout && terminalIds && terminalIds.length > 0) {
          try {
            serializedLayout = serializeLayout(layout, terminalIds);
          } catch {
            // Fallback: don't persist layout if serialization fails
          }
        }
        set({
          terminalCwds: cwds,
          activeTerminalIndex: activeIndex,
          terminalLayout: serializedLayout,
        });
      },
      saveBrowseState: (browseFilePaths) => set({ browseFilePaths }),
    }),
    {
      name: 'amend-session',
      partialize: (state) => ({
        terminalCwds: state.terminalCwds,
        activeTerminalIndex: state.activeTerminalIndex,
        terminalLayout: state.terminalLayout,
        browseFilePaths: state.browseFilePaths,
      }),
    }
  )
);
