import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GitStatus, GitFileStatus, FileEntry, restoreFile, unstageFile } from '@/lib/tauri';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useFileStore } from '@/stores/fileStore';

interface DiffFileListProps {
  status: GitStatus | null;
  onScrollToFile: (path: string) => void;
  isLoading: boolean;
  onRefresh?: () => void;
  repoPath?: string | null;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: Map<string, FileTreeNode>;
  status?: string;
}

function buildFileTree(paths: string[]): FileTreeNode {
  const root: FileTreeNode = {
    name: '',
    path: '',
    isDirectory: true,
    children: new Map(),
  };

  for (const filePath of paths) {
    const parts = filePath.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          children: new Map(),
        });
      }

      current = current.children.get(part)!;
    }
  }

  return root;
}

function buildStatusFileTree(files: GitFileStatus[]): FileTreeNode {
  const root: FileTreeNode = {
    name: '',
    path: '',
    isDirectory: true,
    children: new Map(),
  };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          children: new Map(),
          status: isLast ? file.status : undefined,
        });
      }

      current = current.children.get(part)!;
    }
  }

  return root;
}

function getStatusIcon(statusType: string) {
  switch (statusType) {
    case 'added':
      return <span className="text-diff-add-text font-mono text-xs w-4 text-center">A</span>;
    case 'modified':
      return <span className="text-amber-500 dark:text-yellow-400 font-mono text-xs w-4 text-center">M</span>;
    case 'deleted':
      return <span className="text-diff-remove-text font-mono text-xs w-4 text-center">D</span>;
    case 'renamed':
      return <span className="text-blue-600 dark:text-blue-400 font-mono text-xs w-4 text-center">R</span>;
    default:
      return <span className="text-tertiary font-mono text-xs w-4 text-center">U</span>;
  }
}

interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  onScrollToFile: (path: string) => void;
  onContextMenuEntry?: (e: React.MouseEvent, entry: FileEntry) => void;
  defaultExpanded?: boolean;
  onDiscardClick?: (e: React.MouseEvent, filePath: string) => void;
}

function FileTreeItem({
  node,
  depth,
  onScrollToFile,
  onContextMenuEntry,
  defaultExpanded = true,
  onDiscardClick,
}: FileTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (node.isDirectory) {
    const children = Array.from(node.children.values()).sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return (
      <div>
        {node.name && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full select-none items-center gap-1 px-2 py-0.5 text-sm hover:bg-surface-3/50"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <svg
              className={`h-3 w-3 text-tertiary transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M6 4l4 4-4 4V4z" />
            </svg>
            <svg className="h-4 w-4 text-yellow-500" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14.5 3H7.707l-.853-.854L6.5 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zM14 13H2V3h4.293l.853.854.354.146H14v9z" />
            </svg>
            <span className="text-primary">{node.name}</span>
          </button>
        )}
        {(isExpanded || !node.name) && (
          <div>
            {children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={node.name ? depth + 1 : depth}
                onScrollToFile={onScrollToFile}
                onContextMenuEntry={onContextMenuEntry}
                defaultExpanded={defaultExpanded}
                onDiscardClick={onDiscardClick}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onScrollToFile(node.path)}
      onContextMenu={onContextMenuEntry ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenuEntry(e, {
          name: node.name,
          path: node.path,
          isDirectory: false,
          isSymlink: false,
        });
      } : undefined}
      className="group flex w-full select-none items-center gap-1 py-0.5 text-sm hover:bg-surface-3/50"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {getStatusIcon(node.status || '')}
      <span className="truncate text-primary flex-1 text-left">{node.name}</span>
      {onDiscardClick && (
        <span
          role="button"
          tabIndex={-1}
          title={node.status === 'staged' ? 'Unstage file' : 'Discard changes'}
          className="mr-2 flex-shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-surface-3 text-secondary hover:text-primary transition-opacity"
          onClick={(e) => onDiscardClick(e, node.path)}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.11 9.34l-1.06 1.06L8 9.35l-2.05 2.05-1.06-1.06L6.94 8.3 4.89 6.25l1.06-1.06L8 7.24l2.05-2.05 1.06 1.06L9.06 8.3l2.05 2.04z" />
          </svg>
        </span>
      )}
    </button>
  );
}

interface ConfirmRestoreDialogProps {
  target: { path: string; action: 'restore' | 'unstage' } | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmRestoreDialog({ target, onConfirm, onCancel }: ConfirmRestoreDialogProps) {
  if (!target) return null;

  const isRestore = target.action === 'restore';
  const fileName = target.path.split('/').pop() || target.path;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-80 rounded-lg border border-surface-3 bg-surface-2 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-sm font-medium text-primary">
          {isRestore ? 'Discard Changes' : 'Unstage File'}
        </div>
        <p className="mb-4 text-sm text-secondary">
          {isRestore
            ? <>Are you sure you want to discard changes to &ldquo;{fileName}&rdquo;? This cannot be undone.</>
            : <>Are you sure you want to unstage &ldquo;{fileName}&rdquo;?</>
          }
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1 text-xs text-secondary hover:bg-surface-3"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-3 py-1 text-xs text-white ${
              isRestore
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {isRestore ? 'Discard' : 'Unstage'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function DiffFileList({ status, onScrollToFile, isLoading, onRefresh, repoPath }: DiffFileListProps) {
  const { openMenu } = useContextMenuStore();
  const { currentDirectory } = useFileStore();
  const [restoreTarget, setRestoreTarget] = useState<{ path: string; action: 'restore' | 'unstage' } | null>(null);

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const absolutePath = entry.path.startsWith('/')
      ? entry.path
      : `${currentDirectory}/${entry.path}`;
    openMenu({ ...entry, path: absolutePath }, e.clientX, e.clientY);
  };

  const handleRestoreConfirm = async () => {
    if (!restoreTarget || !repoPath) return;

    try {
      if (restoreTarget.action === 'restore') {
        await restoreFile(repoPath, restoreTarget.path);
      } else {
        await unstageFile(repoPath, restoreTarget.path);
      }
      onRefresh?.();
    } catch (error) {
      console.error(`Failed to ${restoreTarget.action} file:`, error);
    }
    setRestoreTarget(null);
  };

  const stagedTree = useMemo(() => {
    if (!status || status.staged.length === 0) return null;
    return buildStatusFileTree(status.staged);
  }, [status]);

  const unstagedTree = useMemo(() => {
    if (!status || status.unstaged.length === 0) return null;
    return buildStatusFileTree(status.unstaged);
  }, [status]);

  const untrackedTree = useMemo(() => {
    if (!status || status.untracked.length === 0) return null;
    return buildFileTree(status.untracked);
  }, [status]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-tertiary">Loading...</div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center h-full text-tertiary text-sm">
        No git repository
      </div>
    );
  }

  const hasChanges =
    status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0;

  if (!hasChanges) {
    return (
      <div className="flex items-center justify-center h-full text-tertiary text-sm">
        No changes
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Staged changes */}
      {stagedTree && status.staged.length > 0 && (
        <div className="mb-2">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-diff-add-text">
            Staged ({status.staged.length})
          </div>
          <FileTreeItem
            node={stagedTree}
            depth={0}
            onScrollToFile={onScrollToFile}
            onContextMenuEntry={handleContextMenu}
            onDiscardClick={repoPath ? (e, path) => {
              e.stopPropagation();
              setRestoreTarget({ path, action: 'unstage' });
            } : undefined}
          />
        </div>
      )}

      {/* Unstaged changes */}
      {unstagedTree && status.unstaged.length > 0 && (
        <div className="mb-2">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-500 dark:text-yellow-400">
            Changed ({status.unstaged.length})
          </div>
          <FileTreeItem
            node={unstagedTree}
            depth={0}
            onScrollToFile={onScrollToFile}
            onContextMenuEntry={handleContextMenu}
            onDiscardClick={repoPath ? (e, path) => {
              e.stopPropagation();
              setRestoreTarget({ path, action: 'restore' });
            } : undefined}
          />
        </div>
      )}

      {/* Untracked files - tree view */}
      {untrackedTree && status.untracked.length > 0 && (
        <div className="mb-2">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-tertiary">
            Untracked ({status.untracked.length})
          </div>
          <FileTreeItem node={untrackedTree} depth={0} onScrollToFile={onScrollToFile} onContextMenuEntry={handleContextMenu} />
        </div>
      )}

      <ConfirmRestoreDialog
        target={restoreTarget}
        onConfirm={handleRestoreConfirm}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  );
}
