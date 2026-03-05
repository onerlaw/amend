import { create } from 'zustand';
import {
  createSnapshot as createSnapshotCmd,
  listSnapshots as listSnapshotsCmd,
  deleteSnapshot as deleteSnapshotCmd,
  restoreSnapshot as restoreSnapshotCmd,
  diffSnapshot as diffSnapshotCmd,
  getSnapshotFileDiff as getSnapshotFileDiffCmd,
  type Snapshot,
  type SnapshotFileDiff,
  type SnapshotDiff,
} from '@/lib/tauri';

interface SnapshotState {
  snapshots: Snapshot[];
  selectedSnapshotId: string | null;
  diffFiles: SnapshotFileDiff[];
  selectedDiffFile: string | null;
  selectedFileDiff: SnapshotDiff | null;
  isCreating: boolean;
  isLoading: boolean;
  isRestoring: boolean;

  loadSnapshots: (repoPath: string) => Promise<void>;
  createSnapshot: (repoPath: string, label: string) => Promise<void>;
  deleteSnapshot: (repoPath: string, snapshotId: string) => Promise<void>;
  restoreSnapshot: (repoPath: string, snapshotId: string) => Promise<void>;
  selectSnapshot: (repoPath: string, snapshotId: string) => Promise<void>;
  selectDiffFile: (repoPath: string, snapshotId: string, filePath: string) => Promise<void>;
  clearSelection: () => void;
}

export const useSnapshotStore = create<SnapshotState>()((set, get) => ({
  snapshots: [],
  selectedSnapshotId: null,
  diffFiles: [],
  selectedDiffFile: null,
  selectedFileDiff: null,
  isCreating: false,
  isLoading: false,
  isRestoring: false,

  loadSnapshots: async (repoPath: string) => {
    set({ isLoading: true });
    try {
      const snapshots = await listSnapshotsCmd(repoPath);
      set({ snapshots, isLoading: false });
    } catch (err) {
      console.error('[Snapshots] Failed to load:', err);
      set({ snapshots: [], isLoading: false });
    }
  },

  createSnapshot: async (repoPath: string, label: string) => {
    set({ isCreating: true });
    try {
      await createSnapshotCmd(repoPath, label);
      // Reload list after creation
      const snapshots = await listSnapshotsCmd(repoPath);
      set({ snapshots, isCreating: false });
    } catch (err) {
      console.error('[Snapshots] Failed to create:', err);
      set({ isCreating: false });
      throw err;
    }
  },

  deleteSnapshot: async (repoPath: string, snapshotId: string) => {
    try {
      await deleteSnapshotCmd(repoPath, snapshotId);
      const { selectedSnapshotId } = get();
      const snapshots = await listSnapshotsCmd(repoPath);
      set({
        snapshots,
        // Clear selection if deleted snapshot was selected
        ...(selectedSnapshotId === snapshotId
          ? {
              selectedSnapshotId: null,
              diffFiles: [],
              selectedDiffFile: null,
              selectedFileDiff: null,
            }
          : {}),
      });
    } catch (err) {
      console.error('[Snapshots] Failed to delete:', err);
      throw err;
    }
  },

  restoreSnapshot: async (repoPath: string, snapshotId: string) => {
    set({ isRestoring: true });
    try {
      await restoreSnapshotCmd(repoPath, snapshotId);
      set({ isRestoring: false });
    } catch (err) {
      console.error('[Snapshots] Failed to restore:', err);
      set({ isRestoring: false });
      throw err;
    }
  },

  selectSnapshot: async (repoPath: string, snapshotId: string) => {
    set({
      selectedSnapshotId: snapshotId,
      diffFiles: [],
      selectedDiffFile: null,
      selectedFileDiff: null,
    });
    try {
      const diffFiles = await diffSnapshotCmd(repoPath, snapshotId);
      set({ diffFiles });
    } catch (err) {
      console.error('[Snapshots] Failed to load diff:', err);
    }
  },

  selectDiffFile: async (repoPath: string, snapshotId: string, filePath: string) => {
    set({ selectedDiffFile: filePath, selectedFileDiff: null });
    try {
      const diff = await getSnapshotFileDiffCmd(repoPath, snapshotId, filePath);
      set({ selectedFileDiff: diff });
    } catch (err) {
      console.error('[Snapshots] Failed to load file diff:', err);
    }
  },

  clearSelection: () => {
    set({
      selectedSnapshotId: null,
      diffFiles: [],
      selectedDiffFile: null,
      selectedFileDiff: null,
    });
  },
}));
