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
  activeFile: string | null;
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
      activeFile: null,
      activeFilePath: null,
      openFile: (file: OpenFile) => {
        const openFiles = get().openFiles;
        const existing = openFiles.find((f) => f.path === file.path);
        if (!existing) {
          set({ openFiles: [...openFiles, file], activeFile: file.path, activeFilePath: file.path });
        } else {
          set({ activeFile: file.path, activeFilePath: file.path });
        }
      },
      setActiveFile: (path: string) => {
        set({ activeFile: path, activeFilePath: path });
      },
      closeFile: (path: string) => {
        const openFiles = get().openFiles.filter((f) => f.path !== path);
        const activeFile = get().activeFile;
        const newActiveFile =
          activeFile === path
            ? openFiles.length > 0
              ? openFiles[openFiles.length - 1].path
              : null
            : activeFile;
        set({
          openFiles,
          activeFile: newActiveFile,
          activeFilePath: newActiveFile,
        });
      },
      updateFileContent: (path: string, content: string) => {
        const openFiles = get().openFiles.map((f) =>
          f.path === path ? { ...f, content, isDirty: true } : f
        );
        set({ openFiles });
      },
      markFileSaved: (path: string) => {
        const openFiles = get().openFiles.map((f) =>
          f.path === path ? { ...f, isDirty: false } : f
        );
        set({ openFiles });
      },
      // Browse mode state
      browseOpenFiles: [],
      browseActiveFilePath: null,
      openBrowseFile: (file: OpenFile) => {
        const browseOpenFiles = get().browseOpenFiles;
        const existing = browseOpenFiles.find((f) => f.path === file.path);
        if (!existing) {
          set({
            browseOpenFiles: [...browseOpenFiles, file],
            browseActiveFilePath: file.path,
          });
        } else {
          set({ browseActiveFilePath: file.path });
        }
      },
      setBrowseActiveFile: (path: string) => {
        set({ browseActiveFilePath: path });
      },
      closeBrowseFile: (path: string) => {
        const browseOpenFiles = get().browseOpenFiles.filter((f) => f.path !== path);
        const browseActiveFilePath = get().browseActiveFilePath;
        const newActiveFilePath =
          browseActiveFilePath === path
            ? browseOpenFiles.length > 0
              ? browseOpenFiles[browseOpenFiles.length - 1].path
              : null
            : browseActiveFilePath;
        set({
          browseOpenFiles,
          browseActiveFilePath: newActiveFilePath,
        });
      },
      updateBrowseFileContent: (path: string, content: string) => {
        const browseOpenFiles = get().browseOpenFiles.map((f) =>
          f.path === path ? { ...f, content, isDirty: true } : f
        );
        set({ browseOpenFiles });
      },
      markBrowseFileSaved: (path: string) => {
        const browseOpenFiles = get().browseOpenFiles.map((f) =>
          f.path === path ? { ...f, isDirty: false } : f
        );
        set({ browseOpenFiles });
      },
      // Line navigation (for go-to-definition)
      pendingScrollToLine: null,
      pendingScrollToFile: null,
      clearPendingScrollToLine: () => set({ pendingScrollToLine: null, pendingScrollToFile: null }),
      openBrowseFileAtLine: (file: OpenFile, line: number) => {
        const browseOpenFiles = get().browseOpenFiles;
        const existing = browseOpenFiles.find((f) => f.path === file.path);
        if (!existing) {
          set({
            browseOpenFiles: [...browseOpenFiles, file],
            browseActiveFilePath: file.path,
            pendingScrollToLine: line,
            pendingScrollToFile: file.path,
          });
        } else {
          set({
            browseActiveFilePath: file.path,
            pendingScrollToLine: line,
            pendingScrollToFile: file.path,
          });
        }
      },
      openFileAtLine: (file: OpenFile, line: number) => {
        const openFiles = get().openFiles;
        const existing = openFiles.find((f) => f.path === file.path);
        if (!existing) {
          set({
            openFiles: [...openFiles, file],
            activeFile: file.path,
            activeFilePath: file.path,
            pendingScrollToLine: line,
            pendingScrollToFile: file.path,
          });
        } else {
          set({
            activeFile: file.path,
            activeFilePath: file.path,
            pendingScrollToLine: line,
            pendingScrollToFile: file.path,
          });
        }
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
