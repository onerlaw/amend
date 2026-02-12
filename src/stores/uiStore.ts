import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toggleSetItem } from '@/lib/fileUtils';

export type PanelMode = 'diff' | 'browse' | null;
export type ThemeMode = 'light' | 'dark' | 'system';
export type FocusedPanel = 'terminal' | 'editor' | 'file-list';
export type DiffMode = 'working' | 'branch';

interface UIState {
  panelMode: PanelMode;
  collapsedDiffFiles: Set<string>;
  scrollTargetFile: string | null;
  selectedDiffFile: string | null;
  themeMode: ThemeMode;
  focusedPanel: FocusedPanel;
  diffFileListVisible: boolean;
  browseExpandedDirs: Set<string>;
  collapsedDiffTreePaths: Set<string>;
  fontSize: number;
  diffMode: DiffMode;
  diffBaseBranch: string | null;

  setPanelMode: (mode: PanelMode) => void;
  toggleDiffFileCollapse: (path: string) => void;
  setScrollTargetFile: (path: string | null) => void;
  setSelectedDiffFile: (path: string | null) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setFocusedPanel: (panel: FocusedPanel) => void;
  toggleDiffFileList: () => void;
  toggleBrowseExpandedDir: (path: string) => void;
  toggleDiffTreePath: (path: string) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  resetFontSize: () => void;
  setDiffMode: (mode: DiffMode) => void;
  setDiffBaseBranch: (branch: string | null) => void;
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
      diffFileListVisible: false,
      browseExpandedDirs: new Set(),
      collapsedDiffTreePaths: new Set(),
      fontSize: 13,
      diffMode: 'working',
      diffBaseBranch: null,

      setPanelMode: (mode: PanelMode) => set({ panelMode: mode }),
      setFocusedPanel: (panel: FocusedPanel) =>
        set((state) => (state.focusedPanel === panel ? state : { focusedPanel: panel })),
      toggleDiffFileList: () =>
        set((state) => ({ diffFileListVisible: !state.diffFileListVisible })),
      toggleDiffFileCollapse: (path: string) =>
        set((state) => ({
          collapsedDiffFiles: toggleSetItem(state.collapsedDiffFiles, path),
        })),
      toggleBrowseExpandedDir: (path: string) =>
        set((state) => ({
          browseExpandedDirs: toggleSetItem(state.browseExpandedDirs, path),
        })),
      toggleDiffTreePath: (path: string) =>
        set((state) => ({
          collapsedDiffTreePaths: toggleSetItem(state.collapsedDiffTreePaths, path),
        })),
      setScrollTargetFile: (path: string | null) => set({ scrollTargetFile: path }),
      setSelectedDiffFile: (path: string | null) => set({ selectedDiffFile: path }),
      setThemeMode: (mode: ThemeMode) => set({ themeMode: mode }),
      increaseFontSize: () =>
        set((state) => ({ fontSize: Math.min(32, state.fontSize + 1) })),
      decreaseFontSize: () =>
        set((state) => ({ fontSize: Math.max(8, state.fontSize - 1) })),
      resetFontSize: () => set({ fontSize: 13 }),
      setDiffMode: (mode: DiffMode) => set({ diffMode: mode }),
      setDiffBaseBranch: (branch: string | null) => set({ diffBaseBranch: branch }),
    }),
    {
      name: 'amend-ui',
      partialize: (state) => ({
        panelMode: state.panelMode,
        themeMode: state.themeMode,
        diffFileListVisible: state.diffFileListVisible,
        fontSize: state.fontSize,
        diffMode: state.diffMode,
        diffBaseBranch: state.diffBaseBranch,
      }),
    }
  )
);
