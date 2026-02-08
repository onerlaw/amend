import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  language: string;
  isImage?: boolean;
}

// Internal tab helpers
function tabOpen(files: OpenFile[], file: OpenFile): { files: OpenFile[]; activePath: string } {
  const existing = files.find((f) => f.path === file.path);
  if (!existing) {
    return { files: [...files, file], activePath: file.path };
  }
  return { files, activePath: file.path };
}

function tabClose(
  files: OpenFile[],
  activePath: string | null,
  path: string
): { files: OpenFile[]; activePath: string | null } {
  const filtered = files.filter((f) => f.path !== path);
  const newActivePath =
    activePath === path
      ? filtered.length > 0
        ? filtered[filtered.length - 1].path
        : null
      : activePath;
  return { files: filtered, activePath: newActivePath };
}

function tabUpdateContent(files: OpenFile[], path: string, content: string): OpenFile[] {
  return files.map((f) => (f.path === path ? { ...f, content, isDirty: true } : f));
}

function tabMarkSaved(files: OpenFile[], path: string): OpenFile[] {
  return files.map((f) => (f.path === path ? { ...f, isDirty: false } : f));
}

function tabReorder<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...items];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

function tabOpenAtLine(
  files: OpenFile[],
  file: OpenFile,
  line: number
): {
  files: OpenFile[];
  activePath: string;
  pendingScrollToLine: number;
  pendingScrollToFile: string;
} {
  const { files: newFiles, activePath } = tabOpen(files, file);
  return {
    files: newFiles,
    activePath,
    pendingScrollToLine: line,
    pendingScrollToFile: file.path,
  };
}

interface SavedBrowseState {
  files: OpenFile[];
  activePath: string | null;
}

interface FileState {
  currentDirectory: string | null;
  setCurrentDirectory: (path: string) => void;
  activeWorktreePath: string | null;
  setActiveWorktreePath: (path: string | null) => void;
  contextPath: string | null;
  // Per-context browse state saved when switching tabs
  savedBrowseState: Record<string, SavedBrowseState>;
  syncTabContext: (projectPath: string, worktreePath: string | null) => void;
  // Browse mode files
  browseOpenFiles: OpenFile[];
  browseActiveFilePath: string | null;
  openBrowseFile: (file: OpenFile) => void;
  setBrowseActiveFile: (path: string) => void;
  closeBrowseFile: (path: string) => void;
  updateBrowseFileContent: (path: string, content: string) => void;
  markBrowseFileSaved: (path: string) => void;
  // Line navigation (for go-to-definition)
  pendingScrollToLine: number | null;
  pendingScrollToFile: string | null;
  clearPendingScrollToLine: () => void;
  openBrowseFileAtLine: (file: OpenFile, line: number) => void;
  reorderBrowseFiles: (fromIndex: number, toIndex: number) => void;
}

export const useFileStore = create<FileState>()(
  persist(
    (set, get) => ({
      currentDirectory: null,
      setCurrentDirectory: (path: string) =>
        set({
          currentDirectory: path,
          contextPath: path,
          browseOpenFiles: [],
          browseActiveFilePath: null,
        }),
      activeWorktreePath: null,
      setActiveWorktreePath: (path: string | null) =>
        set({ activeWorktreePath: path, contextPath: path ?? get().currentDirectory }),
      contextPath: null,
      savedBrowseState: {},
      syncTabContext: (projectPath: string, worktreePath: string | null) => {
        const state = get();
        const newContextPath = worktreePath ?? projectPath;
        const oldContextPath = state.contextPath;

        // Nothing to do if context hasn't changed
        if (oldContextPath === newContextPath) return;

        // Save current browse state for the old context
        const saved = { ...state.savedBrowseState };
        if (oldContextPath) {
          saved[oldContextPath] = {
            files: state.browseOpenFiles,
            activePath: state.browseActiveFilePath,
          };
        }

        // Restore browse state for the new context (or start empty)
        const restored = saved[newContextPath];

        set({
          currentDirectory: projectPath,
          activeWorktreePath: worktreePath,
          contextPath: newContextPath,
          browseOpenFiles: restored?.files ?? [],
          browseActiveFilePath: restored?.activePath ?? null,
          savedBrowseState: saved,
        });
      },
      // Browse mode state
      browseOpenFiles: [],
      browseActiveFilePath: null,
      openBrowseFile: (file: OpenFile) => {
        const { files, activePath } = tabOpen(get().browseOpenFiles, file);
        set({ browseOpenFiles: files, browseActiveFilePath: activePath });
      },
      setBrowseActiveFile: (path: string) => {
        set({ browseActiveFilePath: path });
      },
      closeBrowseFile: (path: string) => {
        const { files, activePath } = tabClose(
          get().browseOpenFiles,
          get().browseActiveFilePath,
          path
        );
        set({ browseOpenFiles: files, browseActiveFilePath: activePath });
      },
      updateBrowseFileContent: (path: string, content: string) => {
        set({ browseOpenFiles: tabUpdateContent(get().browseOpenFiles, path, content) });
      },
      markBrowseFileSaved: (path: string) => {
        set({ browseOpenFiles: tabMarkSaved(get().browseOpenFiles, path) });
      },
      // Line navigation (for go-to-definition)
      pendingScrollToLine: null,
      pendingScrollToFile: null,
      clearPendingScrollToLine: () => set({ pendingScrollToLine: null, pendingScrollToFile: null }),
      openBrowseFileAtLine: (file: OpenFile, line: number) => {
        const result = tabOpenAtLine(get().browseOpenFiles, file, line);
        set({
          browseOpenFiles: result.files,
          browseActiveFilePath: result.activePath,
          pendingScrollToLine: result.pendingScrollToLine,
          pendingScrollToFile: result.pendingScrollToFile,
        });
      },
      reorderBrowseFiles: (fromIndex: number, toIndex: number) => {
        set({ browseOpenFiles: tabReorder(get().browseOpenFiles, fromIndex, toIndex) });
      },
    }),
    {
      name: 'amend-files',
      partialize: (state) => ({
        currentDirectory: state.currentDirectory,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.contextPath = state.activeWorktreePath ?? state.currentDirectory;
        }
      },
    }
  )
);
