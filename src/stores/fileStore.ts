import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FileEntry } from '@/lib/tauri';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  language: string;
}

// Internal tab helpers
function tabOpen(files: OpenFile[], file: OpenFile): { files: OpenFile[]; activePath: string } {
  const existing = files.find((f) => f.path === file.path);
  if (!existing) {
    return { files: [...files, file], activePath: file.path };
  }
  return { files, activePath: file.path };
}

function tabClose(files: OpenFile[], activePath: string | null, path: string): { files: OpenFile[]; activePath: string | null } {
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

function tabOpenAtLine(
  files: OpenFile[],
  file: OpenFile,
  line: number
): { files: OpenFile[]; activePath: string; pendingScrollToLine: number; pendingScrollToFile: string } {
  const { files: newFiles, activePath } = tabOpen(files, file);
  return {
    files: newFiles,
    activePath,
    pendingScrollToLine: line,
    pendingScrollToFile: file.path,
  };
}

interface FileState {
  currentDirectory: string | null;
  setCurrentDirectory: (path: string) => void;
  activeWorktreePath: string | null;
  setActiveWorktreePath: (path: string | null) => void;
  fileTree: FileEntry[];
  setFileTree: (entries: FileEntry[]) => void;
  expandedDirs: Set<string>;
  toggleDirectory: (path: string) => void;
  // Editor mode files
  openFiles: OpenFile[];
  activeFilePath: string | null;
  openFile: (file: OpenFile) => void;
  setActiveFile: (path: string) => void;
  closeFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string) => void;
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
  openFileAtLine: (file: OpenFile, line: number) => void;
}

export const useFileStore = create<FileState>()(
  persist(
    (set, get) => ({
      currentDirectory: null,
      setCurrentDirectory: (path: string) =>
        set({
          currentDirectory: path,
          activeWorktreePath: path, // Default activeWorktreePath to project root
          browseOpenFiles: [],
          browseActiveFilePath: null,
        }),
      activeWorktreePath: null,
      setActiveWorktreePath: (path: string | null) => set({ activeWorktreePath: path }),
      fileTree: [],
      setFileTree: (entries: FileEntry[]) => set({ fileTree: entries }),
      expandedDirs: new Set<string>(),
      toggleDirectory: (path: string) => {
        const expanded = new Set(get().expandedDirs);
        if (expanded.has(path)) {
          expanded.delete(path);
        } else {
          expanded.add(path);
        }
        set({ expandedDirs: expanded });
      },
      openFiles: [],
      activeFilePath: null,
      openFile: (file: OpenFile) => {
        const { files, activePath } = tabOpen(get().openFiles, file);
        set({ openFiles: files, activeFilePath: activePath });
      },
      setActiveFile: (path: string) => {
        set({ activeFilePath: path });
      },
      closeFile: (path: string) => {
        const { files, activePath } = tabClose(get().openFiles, get().activeFilePath, path);
        set({ openFiles: files, activeFilePath: activePath });
      },
      updateFileContent: (path: string, content: string) => {
        set({ openFiles: tabUpdateContent(get().openFiles, path, content) });
      },
      markFileSaved: (path: string) => {
        set({ openFiles: tabMarkSaved(get().openFiles, path) });
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
        const { files, activePath } = tabClose(get().browseOpenFiles, get().browseActiveFilePath, path);
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
      openFileAtLine: (file: OpenFile, line: number) => {
        const result = tabOpenAtLine(get().openFiles, file, line);
        set({
          openFiles: result.files,
          activeFilePath: result.activePath,
          pendingScrollToLine: result.pendingScrollToLine,
          pendingScrollToFile: result.pendingScrollToFile,
        });
      },
    }),
    {
      name: 'amend-files',
      partialize: (state) => ({
        currentDirectory: state.currentDirectory,
      }),
    }
  )
);
