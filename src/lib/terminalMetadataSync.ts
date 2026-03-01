import { useTerminalStore, type TerminalTab } from '@/stores/terminalStore';
import {
  syncTerminalMetadata,
  removeTerminalMetadata,
  type TerminalMetadataPayload,
} from '@/lib/tauri';

let unsubscribe: (() => void) | null = null;

function buildMetadata(tab: TerminalTab): TerminalMetadataPayload {
  return {
    cwd: tab.cwd ?? null,
    title: tab.title ?? null,
    gitRoot: tab.gitRoot ?? null,
    repoName: tab.repoName ?? null,
    mainRepoRoot: tab.mainRepoRoot ?? null,
    worktreeName: tab.worktreeName ?? null,
  };
}

export function startTerminalMetadataSync() {
  if (unsubscribe) return;

  let prevTabIds = new Set<string>();
  const prevSnapshots = new Map<string, string>();

  // Sync all current tabs immediately
  const { tabs } = useTerminalStore.getState();
  for (const tab of tabs) {
    const meta = buildMetadata(tab);
    const snapshot = JSON.stringify(meta);
    prevSnapshots.set(tab.id, snapshot);
    prevTabIds.add(tab.id);
    syncTerminalMetadata(tab.id, meta).catch(() => {});
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  unsubscribe = useTerminalStore.subscribe((state) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;

      const currentTabIds = new Set(state.tabs.map((t) => t.id));

      // Sync updated or new tabs
      for (const tab of state.tabs) {
        const meta = buildMetadata(tab);
        const snapshot = JSON.stringify(meta);
        if (prevSnapshots.get(tab.id) !== snapshot) {
          prevSnapshots.set(tab.id, snapshot);
          syncTerminalMetadata(tab.id, meta).catch(() => {});
        }
      }

      // Remove tabs that no longer exist
      for (const id of prevTabIds) {
        if (!currentTabIds.has(id)) {
          prevSnapshots.delete(id);
          removeTerminalMetadata(id).catch(() => {});
        }
      }

      prevTabIds = currentTabIds;
    }, 100);
  });
}

export function stopTerminalMetadataSync() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
