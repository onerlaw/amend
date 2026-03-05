import { useState, useEffect, useCallback, memo, lazy, Suspense } from 'react';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useFileStore } from '@/stores/fileStore';
import { PlusIcon, TrashIcon, RefreshIcon, DocumentIcon, CloseIcon } from '@/components/Icons';
import { ModalOverlay } from '@/components/ModalOverlay';

const DiffFileSection = lazy(() =>
  import('@/components/DiffViewer/DiffFileSection').then((m) => ({
    default: m.DiffFileSection,
  }))
);

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `Today ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return `Yesterday ${time}`;

  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SnapshotIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2zm-.5 2v4.5l3.5 2.1.5-.87-3-1.78V4h-1z" />
    </svg>
  );
}

function RestoreIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 3a5 5 0 100 10A5 5 0 008 3zM2 8a6 6 0 1112 0A6 6 0 012 8z" />
      <path d="M8 5v3.5l2.5 1.5.5-.87L9 7.85V5H8z" />
      <path d="M1.5 4.5L4 2v2a6 6 0 000 8l-1 .73A7 7 0 014 4h-.01L1.5 6.5v-2z" />
    </svg>
  );
}

const SnapshotListItem = memo(function SnapshotListItem({
  snapshot,
  isSelected,
  onSelect,
  onDelete,
  onRestore,
}: {
  snapshot: { id: string; label: string; timestamp: number; changedFiles: string[] };
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  return (
    <div
      className={`group cursor-pointer border-b border-surface-3 px-3 py-2 transition-colors ${
        isSelected ? 'bg-surface-3' : 'hover:bg-surface-3/50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <SnapshotIcon className="h-3.5 w-3.5 text-tertiary flex-shrink-0" />
          <span className="text-sm text-primary truncate">{snapshot.label}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRestore();
            }}
            className="rounded p-1 text-secondary hover:bg-surface-4 hover:text-primary"
            title="Restore this snapshot"
          >
            <RestoreIcon className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 text-secondary hover:bg-red-500/20 hover:text-red-400"
            title="Delete this snapshot"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-0.5 ml-5.5">
        <span className="text-xs text-tertiary">{formatTimestamp(snapshot.timestamp)}</span>
        {snapshot.changedFiles.length > 0 && (
          <span className="text-xs text-tertiary">
            {snapshot.changedFiles.length} file{snapshot.changedFiles.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
});

function CreateSnapshotForm({
  onSubmit,
  isCreating,
}: {
  onSubmit: (label: string) => void;
  isCreating: boolean;
}) {
  const [label, setLabel] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || isCreating) return;
    onSubmit(trimmed);
    setLabel('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-1.5 px-3 py-2 border-b border-surface-3"
    >
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Snapshot label..."
        disabled={isCreating}
        className="flex-1 rounded-md bg-surface-0 border border-surface-3 px-2 py-1 text-xs text-primary placeholder:text-tertiary outline-none focus:border-accent disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={!label.trim() || isCreating}
        className="rounded-md bg-accent px-2 py-1 text-xs text-white hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
      >
        <PlusIcon className="h-3 w-3" />
        {isCreating ? 'Creating...' : 'Create'}
      </button>
    </form>
  );
}

function SnapshotDiffPanel({ repoPath, snapshotId }: { repoPath: string; snapshotId: string }) {
  const { diffFiles, selectedDiffFile, selectedFileDiff, selectDiffFile } = useSnapshotStore();

  if (diffFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-tertiary">
        No differences from current state
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* File list */}
      <div className="border-b border-surface-3">
        <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-secondary">
          Changed Files ({diffFiles.length})
        </div>
        <div className="max-h-40 overflow-y-auto">
          {diffFiles.map((file) => {
            const statusColor =
              file.status === 'added'
                ? 'text-diff-add-text'
                : file.status === 'deleted'
                  ? 'text-diff-remove-text'
                  : 'text-yellow-500';
            const statusChar =
              file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M';

            return (
              <button
                key={file.path}
                onClick={() => selectDiffFile(repoPath, snapshotId, file.path)}
                className={`flex w-full items-center gap-2 px-3 py-1 text-xs hover:bg-surface-3/50 ${
                  selectedDiffFile === file.path ? 'bg-surface-3' : ''
                }`}
              >
                <span className={`font-mono ${statusColor}`}>{statusChar}</span>
                <span className="truncate text-primary">{file.path}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-y-auto">
        {selectedDiffFile && selectedFileDiff ? (
          selectedFileDiff.isBinary ? (
            <div className="flex h-full items-center justify-center text-xs text-tertiary">
              Binary file
            </div>
          ) : (
            <Suspense fallback={<div className="p-4 text-xs text-tertiary">Loading diff...</div>}>
              <DiffFileSection
                filePath={selectedDiffFile}
                category="unstaged"
                oldContent={selectedFileDiff.oldContent}
                newContent={selectedFileDiff.newContent}
                isBinary={false}
                isCollapsed={false}
                isLoading={false}
                error={null}
                onToggleCollapse={() => {}}
                onEditFile={() => {}}
              />
            </Suspense>
          )
        ) : selectedDiffFile ? (
          <div className="flex h-full items-center justify-center text-xs text-tertiary">
            Loading...
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-tertiary">
            Select a file to view diff
          </div>
        )}
      </div>
    </div>
  );
}

export function SnapshotPanel({ onClose }: { onClose: () => void }) {
  const contextPath = useFileStore((s) => s.contextPath);
  const {
    snapshots,
    selectedSnapshotId,
    isCreating,
    isLoading,
    isRestoring,
    loadSnapshots,
    createSnapshot,
    deleteSnapshot,
    restoreSnapshot,
    selectSnapshot,
    clearSelection,
  } = useSnapshotStore();

  // Load snapshots when contextPath changes
  useEffect(() => {
    if (contextPath) {
      loadSnapshots(contextPath);
    }
  }, [contextPath, loadSnapshots]);

  const handleCreate = useCallback(
    async (label: string) => {
      if (!contextPath) return;
      try {
        await createSnapshot(contextPath, label);
      } catch {
        // Error already logged in store
      }
    },
    [contextPath, createSnapshot]
  );

  const handleDelete = useCallback(
    async (snapshotId: string) => {
      if (!contextPath) return;
      try {
        await deleteSnapshot(contextPath, snapshotId);
      } catch {
        // Error already logged in store
      }
    },
    [contextPath, deleteSnapshot]
  );

  const handleRestore = useCallback(
    async (snapshotId: string) => {
      if (!contextPath) return;
      try {
        await restoreSnapshot(contextPath, snapshotId);
      } catch {
        // Error already logged in store
      }
    },
    [contextPath, restoreSnapshot]
  );

  const handleSelect = useCallback(
    (snapshotId: string) => {
      if (!contextPath) return;
      if (selectedSnapshotId === snapshotId) {
        clearSelection();
      } else {
        selectSnapshot(contextPath, snapshotId);
      }
    },
    [contextPath, selectedSnapshotId, selectSnapshot, clearSelection]
  );

  const handleRefresh = useCallback(() => {
    if (contextPath) loadSnapshots(contextPath);
  }, [contextPath, loadSnapshots]);

  const handleClose = useCallback(() => {
    clearSelection();
    onClose();
  }, [clearSelection, onClose]);

  if (!contextPath) {
    return (
      <ModalOverlay onClose={handleClose}>
        <div
          className="w-[720px] max-h-[80vh] rounded-xl bg-surface-2 shadow-xl flex flex-col overflow-hidden"
          onKeyDown={(e) => e.key === 'Escape' && handleClose()}
          tabIndex={-1}
        >
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              Snapshots
            </span>
            <div className="flex-1" />
            <button
              onClick={handleClose}
              className="rounded-md p-1 text-secondary hover:bg-surface-3"
              title="Close"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex py-12 flex-col items-center justify-center bg-surface-0 px-6 text-center">
            <DocumentIcon className="h-16 w-16 text-tertiary mb-4" />
            <h3 className="text-lg font-medium text-primary mb-2">No Repository Open</h3>
            <p className="text-sm text-tertiary max-w-sm">
              Open a folder to create and manage snapshots.
            </p>
          </div>
        </div>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay onClose={handleClose}>
    <div
      className="w-[720px] max-h-[80vh] rounded-xl bg-surface-2 shadow-xl flex flex-col overflow-hidden"
      onKeyDown={(e) => e.key === 'Escape' && handleClose()}
      tabIndex={-1}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          Snapshots
        </span>
        {snapshots.length > 0 && (
          <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-medium text-white">
            {snapshots.length}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={handleRefresh}
          className="rounded-md p-1 text-secondary hover:bg-surface-3"
          title="Refresh"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleClose}
          className="rounded-md p-1 text-secondary hover:bg-surface-3"
          title="Close"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Create form */}
      <CreateSnapshotForm onSubmit={handleCreate} isCreating={isCreating} />

      {/* Restoring overlay */}
      {isRestoring && (
        <div className="px-3 py-2 bg-accent/10 text-accent text-xs text-center border-b border-surface-3">
          Restoring snapshot...
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-tertiary">
            Loading snapshots...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <SnapshotIcon className="h-10 w-10 text-tertiary mb-3" />
            <h3 className="text-sm font-medium text-primary mb-1">No Snapshots</h3>
            <p className="text-xs text-tertiary">
              Create a snapshot to save a checkpoint of your current working state.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Snapshot list */}
            <div
              className={`overflow-y-auto ${selectedSnapshotId ? 'max-h-[50%] border-b border-surface-3' : 'flex-1'}`}
            >
              {snapshots.map((snapshot) => (
                <SnapshotListItem
                  key={snapshot.id}
                  snapshot={snapshot}
                  isSelected={selectedSnapshotId === snapshot.id}
                  onSelect={() => handleSelect(snapshot.id)}
                  onDelete={() => handleDelete(snapshot.id)}
                  onRestore={() => handleRestore(snapshot.id)}
                />
              ))}
            </div>

            {/* Diff panel */}
            {selectedSnapshotId && contextPath && (
              <div className="flex-1 overflow-hidden">
                <SnapshotDiffPanel repoPath={contextPath} snapshotId={selectedSnapshotId} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </ModalOverlay>
  );
}
