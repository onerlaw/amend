import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toggleSetItem } from '@/lib/fileUtils';

export type PanelMode = 'diff' | 'browse' | null;
export type ThemeMode = 'light' | 'dark' | 'system';
export type FocusedPanel = 'terminal' | 'editor';

interface UIState {
  panelMode: PanelMode;
  collapsedDiffFiles: Set<string>;
  scrollTargetFile: string | null;
  themeMode: ThemeMode;
  focusedPanel: FocusedPanel;

  setPanelMode: (mode: PanelMode) => void;
  toggleDiffFileCollapse: (path: string) => void;
  setScrollTargetFile: (path: string | null) => void;
  setCollapsedDiffFiles: (files: Set<string>) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setFocusedPanel: (panel: FocusedPanel) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      panelMode: 'diff',
      collapsedDiffFiles: new Set(),
      scrollTargetFile: null,
      themeMode: 'system',
      focusedPanel: 'terminal',

      setPanelMode: (mode: PanelMode) => set({ panelMode: mode }),
      setFocusedPanel: (panel: FocusedPanel) => set({ focusedPanel: panel }),
      toggleDiffFileCollapse: (path: string) =>
        set((state) => ({
          collapsedDiffFiles: toggleSetItem(state.collapsedDiffFiles, path),
        })),
      setScrollTargetFile: (path: string | null) => set({ scrollTargetFile: path }),
      setCollapsedDiffFiles: (files: Set<string>) => set({ collapsedDiffFiles: files }),
      setThemeMode: (mode: ThemeMode) => set({ themeMode: mode }),
    }),
    {
      name: 'amend-ui',
      partialize: (state) => ({
        panelMode: state.panelMode,
        themeMode: state.themeMode,
      }),
    }
  )
);
