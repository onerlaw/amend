import { useState, useMemo, useCallback } from 'react';
import { GitStatus, FileEntry, restoreFile, unstageFile } from '@/lib/tauri';
import { sortDirectoriesFirst, getFileName } from '@/lib/fileUtils';
import { ContextMenu } from '@/components/ContextMenu/ContextMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ChevronIcon, FolderIcon, DiscardIcon } from '@/components/Icons';

interface DiffFileListProps {
  status: GitStatus | null;
  onScrollToFile: (path: string) => void;
  isLoading: boolean;
  onRefresh?: () => void;
  repoPath?: string | null;
  selectedFile?: string | null;
  onSelectFile?: (path: string) => void;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: Map<string, FileTreeNode>;
  status?: string;
}

interface BuildTreeOptions<T> {
  getPath: (item: T) => string;
  getLeafData?: (item: T) => { status: string };
}

function buildTree<T>(items: T[], options: BuildTreeOptions<T>): FileTreeNode {
  const root: FileTreeNode = {
    name: '',
    path: '',
    isDirectory: true,
    children: new Map(),
  };

  for (const item of items) {
    const filePath = options.getPath(item);
    const parts = filePath.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');

      if (!current.children.has(part)) {
        const leafData = isLast && options.getLeafData ? options.getLeafData(item) : undefined;
        current.children.set(part, {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          children: new Map(),
          status: leafData?.status,
        });
      }

      current = current.children.get(part)!;
    }
  }

  return root;
}

const STATUS_DISPLAY: Record<string, { color: string; letter: string }> = {
  added: { color: 'text-diff-add-text', letter: 'A' },
  modified: { color: 'text-amber-500 dark:text-yellow-400', letter: 'M' },
  deleted: { color: 'text-diff-remove-text', letter: 'D' },
  renamed: { color: 'text-blue-600 dark:text-blue-400', letter: 'R' },
};

function getStatusIcon(statusType: string) {
  const display = STATUS_DISPLAY[statusType] ?? { color: 'text-tertiary', letter: 'U' };
  return <span className={`${display.color} font-mono text-xs w-4 text-center`}>{display.letter}</span>;
}

interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  onScrollToFile: (path: string) => void;
  onContextMenuEntry?: (e: React.MouseEvent, entry: FileEntry) => void;
  defaultExpanded?: boolean;
  onDiscardClick?: (e: React.MouseEvent, filePath: string) => void;
  selectedFile?: string | null;
}

function FileTreeItem({
  node,
  depth,
  onScrollToFile,
  onContextMenuEntry,
  defaultExpanded = true,
  onDiscardClick,
  selectedFile,
}: FileTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (node.isDirectory) {
    const children = sortDirectoriesFirst(Array.from(node.children.values()));

    return (
      <div>
        {node.name && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full select-none items-center gap-1 px-2 py-0.5 text-sm hover:bg-surface-3/50"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <ChevronIcon className={`h-3 w-3 text-tertiary transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            <FolderIcon className="h-4 w-4 text-yellow-500" />
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
                selectedFile={selectedFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedFile === node.path;

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
      className={`group flex w-full select-none items-center gap-1 py-0.5 text-sm hover:bg-surface-3/50 ${
        isSelected ? 'bg-surface-3' : ''
      }`}
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
          <DiscardIcon />
        </span>
      )}
    </button>
  );
}

export function DiffFileList({ status, onScrollToFile, isLoading, onRefresh, repoPath, selectedFile, onSelectFile }: DiffFileListProps) {
  const [restoreTarget, setRestoreTarget] = useState<{ path: string; action: 'restore' | 'unstage' } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; action: 'restore' | 'unstage' } | null>(null);

  const handleScrollToFile = useCallback((path: string) => {
    onSelectFile?.(path);
    onScrollToFile(path);
  }, [onSelectFile, onScrollToFile]);

  const makeContextMenuHandler = useCallback((action: 'unstage' | 'restore') =>
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectFile?.(entry.path);
      setContextMenu({ x: e.clientX, y: e.clientY, path: entry.path, action });
    }, [onSelectFile]);

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
    return buildTree(status.staged, { getPath: (f) => f.path, getLeafData: (f) => ({ status: f.status }) });
  }, [status]);

  const unstagedTree = useMemo(() => {
    if (!status || status.unstaged.length === 0) return null;
    return buildTree(status.unstaged, { getPath: (f) => f.path, getLeafData: (f) => ({ status: f.status }) });
  }, [status]);

  const untrackedTree = useMemo(() => {
    if (!status || status.untracked.length === 0) return null;
    return buildTree(status.untracked, { getPath: (p) => p });
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

  const isRestore = restoreTarget?.action === 'restore';

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
            onScrollToFile={handleScrollToFile}
            onContextMenuEntry={makeContextMenuHandler('unstage')}
            onDiscardClick={repoPath ? (e, path) => {
              e.stopPropagation();
              setRestoreTarget({ path, action: 'unstage' });
            } : undefined}
            selectedFile={selectedFile}
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
            onScrollToFile={handleScrollToFile}
            onContextMenuEntry={makeContextMenuHandler('restore')}
            onDiscardClick={repoPath ? (e, path) => {
              e.stopPropagation();
              setRestoreTarget({ path, action: 'restore' });
            } : undefined}
            selectedFile={selectedFile}
          />
        </div>
      )}

      {/* Untracked files - tree view */}
      {untrackedTree && status.untracked.length > 0 && (
        <div className="mb-2">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-tertiary">
            Untracked ({status.untracked.length})
          </div>
          <FileTreeItem node={untrackedTree} depth={0} onScrollToFile={handleScrollToFile} selectedFile={selectedFile} />
        </div>
      )}

      <ContextMenu
        isOpen={contextMenu !== null}
        position={contextMenu ?? { x: 0, y: 0 }}
        onClose={() => setContextMenu(null)}
        items={contextMenu ? [{
          label: contextMenu.action === 'unstage' ? 'Unstage File' : 'Discard Changes',
          onClick: () => setRestoreTarget({ path: contextMenu.path, action: contextMenu.action }),
        }] : []}
      />

      {restoreTarget && (
        <ConfirmDialog
          title={isRestore ? 'Discard Changes' : 'Unstage File'}
          message={
            isRestore
              ? <>Are you sure you want to discard changes to &ldquo;{getFileName(restoreTarget.path)}&rdquo;? This cannot be undone.</>
              : <>Are you sure you want to unstage &ldquo;{getFileName(restoreTarget.path)}&rdquo;?</>
          }
          confirmLabel={isRestore ? 'Discard' : 'Unstage'}
          confirmClassName={isRestore ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent-hover'}
          onConfirm={handleRestoreConfirm}
          onCancel={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}
