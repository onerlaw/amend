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
  selectedDiffFile: string | null;
  themeMode: ThemeMode;
  focusedPanel: FocusedPanel;
  diffFileListVisible: boolean;

  setPanelMode: (mode: PanelMode) => void;
  toggleDiffFileCollapse: (path: string) => void;
  setScrollTargetFile: (path: string | null) => void;
  setSelectedDiffFile: (path: string | null) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setFocusedPanel: (panel: FocusedPanel) => void;
  toggleDiffFileList: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      panelMode: 'diff',
      collapsedDiffFiles: new Set(),
      scrollTargetFile: null,
      selectedDiffFile: null,
      themeMode: 'system',
      focusedPanel: 'terminal',
      diffFileListVisible: true,

      setPanelMode: (mode: PanelMode) => set({ panelMode: mode }),
      setFocusedPanel: (panel: FocusedPanel) => set({ focusedPanel: panel }),
      toggleDiffFileList: () => set((state) => ({ diffFileListVisible: !state.diffFileListVisible })),
      toggleDiffFileCollapse: (path: string) =>
        set((state) => ({
          collapsedDiffFiles: toggleSetItem(state.collapsedDiffFiles, path),
        })),
      setScrollTargetFile: (path: string | null) => set({ scrollTargetFile: path }),
      setSelectedDiffFile: (path: string | null) => set({ selectedDiffFile: path }),
      setThemeMode: (mode: ThemeMode) => set({ themeMode: mode }),
    }),
    {
      name: 'amend-ui',
      partialize: (state) => ({
        panelMode: state.panelMode,
        themeMode: state.themeMode,
        diffFileListVisible: state.diffFileListVisible,
      }),
    }
  )
);
