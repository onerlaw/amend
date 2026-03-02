import { create } from 'zustand';
import { FileEntry } from '@/lib/tauri';

interface ClipboardState {
  entry: FileEntry | null;
  operation: 'cut' | 'copy' | null;
}

interface NewEntryTarget {
  dirPath: string;
  kind: 'file' | 'folder';
}

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  targetEntry: FileEntry | null;
  selectedEntries: FileEntry[];
  clipboard: ClipboardState;
  renameTarget: FileEntry | null;
  deleteTargets: FileEntry[];
  newEntryTarget: NewEntryTarget | null;
  openMenu: (entry: FileEntry | null, x: number, y: number, selectedEntries?: FileEntry[]) => void;
  closeMenu: () => void;
  setCutEntry: (entry: FileEntry) => void;
  setCopyEntry: (entry: FileEntry) => void;
  clearClipboard: () => void;
  openRenameDialog: (entry: FileEntry) => void;
  closeRenameDialog: () => void;
  openDeleteDialog: (entries: FileEntry[]) => void;
  closeDeleteDialog: () => void;
  openNewEntryDialog: (dirPath: string, kind: 'file' | 'folder') => void;
  closeNewEntryDialog: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  isOpen: false,
  position: { x: 0, y: 0 },
  targetEntry: null,
  selectedEntries: [],
  clipboard: { entry: null, operation: null },
  renameTarget: null,
  deleteTargets: [],
  newEntryTarget: null,

  openMenu: (entry, x, y, selectedEntries) =>
    set({
      isOpen: true,
      position: { x, y },
      targetEntry: entry,
      selectedEntries: selectedEntries ?? [],
    }),

  closeMenu: () =>
    set({
      isOpen: false,
      targetEntry: null,
    }),

  setCutEntry: (entry) =>
    set({
      clipboard: { entry, operation: 'cut' },
    }),

  setCopyEntry: (entry) =>
    set({
      clipboard: { entry, operation: 'copy' },
    }),

  clearClipboard: () =>
    set({
      clipboard: { entry: null, operation: null },
    }),

  openRenameDialog: (entry) =>
    set({
      renameTarget: entry,
      isOpen: false,
      targetEntry: null,
    }),

  closeRenameDialog: () =>
    set({
      renameTarget: null,
    }),

  openDeleteDialog: (entries) =>
    set({
      deleteTargets: entries,
      isOpen: false,
      targetEntry: null,
    }),

  closeDeleteDialog: () =>
    set({
      deleteTargets: [],
    }),

  openNewEntryDialog: (dirPath, kind) =>
    set({
      newEntryTarget: { dirPath, kind },
      isOpen: false,
      targetEntry: null,
    }),

  closeNewEntryDialog: () =>
    set({
      newEntryTarget: null,
    }),
}));
