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
  clipboard: ClipboardState;
  renameTarget: FileEntry | null;
  deleteTarget: FileEntry | null;
  newEntryTarget: NewEntryTarget | null;
  openMenu: (entry: FileEntry, x: number, y: number) => void;
  closeMenu: () => void;
  setCutEntry: (entry: FileEntry) => void;
  setCopyEntry: (entry: FileEntry) => void;
  clearClipboard: () => void;
  openRenameDialog: (entry: FileEntry) => void;
  closeRenameDialog: () => void;
  openDeleteDialog: (entry: FileEntry) => void;
  closeDeleteDialog: () => void;
  openNewEntryDialog: (dirPath: string, kind: 'file' | 'folder') => void;
  closeNewEntryDialog: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  isOpen: false,
  position: { x: 0, y: 0 },
  targetEntry: null,
  clipboard: { entry: null, operation: null },
  renameTarget: null,
  deleteTarget: null,
  newEntryTarget: null,

  openMenu: (entry, x, y) =>
    set({
      isOpen: true,
      position: { x, y },
      targetEntry: entry,
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

  openDeleteDialog: (entry) =>
    set({
      deleteTarget: entry,
      isOpen: false,
      targetEntry: null,
    }),

  closeDeleteDialog: () =>
    set({
      deleteTarget: null,
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
