import { useState, useMemo, useCallback } from 'react';
import { GitStatus, GitFileStatus, restoreFile, unstageFile } from '@/lib/tauri';
import { sortDirectoriesFirst, getFileName } from '@/lib/fileUtils';
import { useUIStore, DiffMode } from '@/stores/uiStore';
import { ContextMenu } from '@/components/ContextMenu/ContextMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DiscardIcon } from '@/components/Icons';
import { TreeRow, DirectoryIndicator } from '@/components/FileTree/TreePrimitives';

interface DiffFileListProps {
  status: GitStatus | null;
  onScrollToFile: (path: string) => void;
  isLoading: boolean;
  onRefresh?: () => void;
  repoPath?: string | null;
  selectedFile?: string | null;
  onSelectFile?: (path: string) => void;
  branchFiles?: GitFileStatus[];
  mode?: DiffMode;
}

interface FileCategories {
  staged?: string;
  unstaged?: string;
  untracked?: boolean;
  conflicted?: boolean;
  branch?: string;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: Map<string, FileTreeNode>;
  categories?: FileCategories;
}

function buildUnifiedTree(status: GitStatus): FileTreeNode {
  const root: FileTreeNode = {
    name: '',
    path: '',
    isDirectory: true,
    children: new Map(),
  };

  function ensurePath(filePath: string): FileTreeNode {
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

    if (!current.categories) {
      current.categories = {};
    }

    return current;
  }

  for (const file of status.staged) {
    const node = ensurePath(file.path);
    node.categories!.staged = file.status;
  }

  for (const file of status.unstaged) {
    const node = ensurePath(file.path);
    node.categories!.unstaged = file.status;
  }

  for (const path of status.untracked) {
    const node = ensurePath(path);
    node.categories!.untracked = true;
  }

  if (status.conflicted) {
    for (const path of status.conflicted) {
      const node = ensurePath(path);
      node.categories!.conflicted = true;
    }
  }

  return root;
}

function buildBranchTree(files: GitFileStatus[]): FileTreeNode {
  const root: FileTreeNode = {
    name: '',
    path: '',
    isDirectory: true,
    children: new Map(),
  };

  function ensurePath(filePath: string): FileTreeNode {
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

    if (!current.categories) {
      current.categories = {};
    }

    return current;
  }

  for (const file of files) {
    const node = ensurePath(file.path);
    node.categories!.branch = file.status;
  }

  return root;
}

const STATUS_LETTERS: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
};

function getStatusIndicator(categories: FileCategories) {
  if (categories.branch) {
    const letter = STATUS_LETTERS[categories.branch] ?? '?';
    return (
      <span className="font-mono text-xs w-5 text-center flex-shrink-0">
        <span className="text-blue-500 dark:text-blue-400">{letter}</span>
      </span>
    );
  }

  if (categories.conflicted) {
    return (
      <span className="font-mono text-xs w-5 text-center flex-shrink-0">
        <span className="text-red-500 dark:text-red-400">U</span>
        <span className="text-red-500 dark:text-red-400">U</span>
      </span>
    );
  }

  if (categories.untracked) {
    return (
      <span className="font-mono text-xs w-5 text-center flex-shrink-0">
        <span className="text-tertiary">?</span>
        <span className="text-tertiary">?</span>
      </span>
    );
  }

  const indexLetter = categories.staged ? (STATUS_LETTERS[categories.staged] ?? '?') : '\u00B7';
  const workLetter = categories.unstaged ? (STATUS_LETTERS[categories.unstaged] ?? '?') : '\u00B7';

  return (
    <span className="font-mono text-xs w-5 text-center flex-shrink-0">
      <span className={categories.staged ? 'text-diff-add-text' : 'text-tertiary'}>
        {indexLetter}
      </span>
      <span
        className={categories.unstaged ? 'text-amber-500 dark:text-yellow-400' : 'text-tertiary'}
      >
        {workLetter}
      </span>
    </span>
  );
}

interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  onScrollToFile: (path: string) => void;
  onAction?: (path: string, action: 'restore' | 'unstage') => void;
  onContextMenu?: (e: React.MouseEvent, path: string, categories: FileCategories) => void;
  selectedFile?: string | null;
  repoPath?: string | null;
}

function FileTreeItem({
  node,
  depth,
  onScrollToFile,
  onAction,
  onContextMenu,
  selectedFile,
  repoPath,
}: FileTreeItemProps) {
  const collapsedDiffTreePaths = useUIStore((s) => s.collapsedDiffTreePaths);
  const toggleDiffTreePath = useUIStore((s) => s.toggleDiffTreePath);
  const isExpanded = !collapsedDiffTreePaths.has(node.path);

  if (node.isDirectory) {
    const children = sortDirectoriesFirst(Array.from(node.children.values()));

    return (
      <div>
        {node.name && (
          <TreeRow depth={depth} onClick={() => toggleDiffTreePath(node.path)}>
            <DirectoryIndicator isExpanded={isExpanded} />
            <span className="text-primary">{node.name}</span>
          </TreeRow>
        )}
        {(isExpanded || !node.name) && (
          <div>
            {children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={node.name ? depth + 1 : depth}
                onScrollToFile={onScrollToFile}
                onAction={onAction}
                onContextMenu={onContextMenu}
                selectedFile={selectedFile}
                repoPath={repoPath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const categories = node.categories ?? {};
  const isSelected = selectedFile === node.path;

  const hasUnstaged = !!categories.unstaged;
  const hasStaged = !!categories.staged;
  const isBranch = !!categories.branch;
  const hasInlineAction =
    repoPath &&
    (hasUnstaged || hasStaged) &&
    !categories.untracked &&
    !categories.conflicted &&
    !isBranch;
  const inlineAction: 'restore' | 'unstage' = hasUnstaged ? 'restore' : 'unstage';

  return (
    <TreeRow
      depth={depth}
      isSelected={isSelected}
      className="group"
      onClick={() => onScrollToFile(node.path)}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(e, node.path, categories);
            }
          : undefined
      }
    >
      {getStatusIndicator(categories)}
      <span className="truncate text-primary flex-1 text-left">{node.name}</span>
      {hasInlineAction && onAction && (
        <span
          role="button"
          tabIndex={-1}
          title={inlineAction === 'restore' ? 'Discard changes' : 'Unstage file'}
          className="mr-2 flex-shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-surface-3 text-secondary hover:text-primary transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onAction(node.path, inlineAction);
          }}
        >
          <DiscardIcon />
        </span>
      )}
    </TreeRow>
  );
}

export function DiffFileList({
  status,
  onScrollToFile,
  isLoading,
  onRefresh,
  repoPath,
  selectedFile,
  onSelectFile,
  branchFiles,
  mode = 'working',
}: DiffFileListProps) {
  const [restoreTarget, setRestoreTarget] = useState<{
    path: string;
    action: 'restore' | 'unstage';
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    items: { label: string; action: 'restore' | 'unstage' }[];
  } | null>(null);

  const handleScrollToFile = useCallback(
    (path: string) => {
      onSelectFile?.(path);
      onScrollToFile(path);
    },
    [onSelectFile, onScrollToFile]
  );

  const handleAction = useCallback((path: string, action: 'restore' | 'unstage') => {
    setRestoreTarget({ path, action });
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, categories: FileCategories) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectFile?.(path);

      // No restore/unstage actions for branch files
      if (categories.branch) return;

      const items: { label: string; action: 'restore' | 'unstage' }[] = [];
      if (categories.staged) {
        items.push({ label: 'Unstage File', action: 'unstage' });
      }
      if (categories.unstaged) {
        items.push({ label: 'Discard Changes', action: 'restore' });
      }
      if (items.length > 0) {
        setContextMenu({ x: e.clientX, y: e.clientY, path, items });
      }
    },
    [onSelectFile]
  );

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

  const unifiedTree = useMemo(() => {
    if (mode === 'branch' && branchFiles && branchFiles.length > 0) {
      return buildBranchTree(branchFiles);
    }
    if (!status) return null;
    return buildUnifiedTree(status);
  }, [status, branchFiles, mode]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-tertiary">Loading...</div>;
  }

  if (mode === 'branch') {
    if (!branchFiles || branchFiles.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-tertiary text-sm">
          No branch changes
        </div>
      );
    }
  } else {
    if (!status) {
      return (
        <div className="flex items-center justify-center h-full text-tertiary text-sm">
          No git repository
        </div>
      );
    }

    const hasChanges =
      (status.conflicted?.length ?? 0) > 0 ||
      status.staged.length > 0 ||
      status.unstaged.length > 0 ||
      status.untracked.length > 0;

    if (!hasChanges) {
      return (
        <div className="flex items-center justify-center h-full text-tertiary text-sm">
          No changes
        </div>
      );
    }
  }

  const isRestore = restoreTarget?.action === 'restore';

  return (
    <div className="h-full overflow-y-auto">
      {unifiedTree && (
        <FileTreeItem
          node={unifiedTree}
          depth={0}
          onScrollToFile={handleScrollToFile}
          onAction={handleAction}
          onContextMenu={handleContextMenu}
          selectedFile={selectedFile}
          repoPath={repoPath}
        />
      )}

      <ContextMenu
        isOpen={contextMenu !== null}
        position={contextMenu ?? { x: 0, y: 0 }}
        onClose={() => setContextMenu(null)}
        items={
          contextMenu
            ? contextMenu.items.map((item) => ({
                label: item.label,
                onClick: () => setRestoreTarget({ path: contextMenu.path, action: item.action }),
              }))
            : []
        }
      />

      {restoreTarget && (
        <ConfirmDialog
          title={isRestore ? 'Discard Changes' : 'Unstage File'}
          message={
            isRestore ? (
              <>
                Are you sure you want to discard changes to &ldquo;{getFileName(restoreTarget.path)}
                &rdquo;? This cannot be undone.
              </>
            ) : (
              <>Are you sure you want to unstage &ldquo;{getFileName(restoreTarget.path)}&rdquo;?</>
            )
          }
          confirmLabel={isRestore ? 'Discard' : 'Unstage'}
          confirmClassName={
            isRestore ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent-hover'
          }
          onConfirm={handleRestoreConfirm}
          onCancel={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}
