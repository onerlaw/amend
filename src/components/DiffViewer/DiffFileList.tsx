import { useState, useMemo } from 'react';
import { GitStatus } from '@/lib/tauri';

interface DiffFileListProps {
  status: GitStatus | null;
  onScrollToFile: (path: string) => void;
  isLoading: boolean;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: Map<string, FileTreeNode>;
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

interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  onScrollToFile: (path: string) => void;
  defaultExpanded?: boolean;
}

function FileTreeItem({
  node,
  depth,
  onScrollToFile,
  defaultExpanded = true,
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
            className="flex w-full items-center gap-1 px-2 py-0.5 text-sm hover:bg-surface-3/50"
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
                defaultExpanded={defaultExpanded}
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
      className="flex w-full items-center gap-1 py-0.5 text-sm hover:bg-surface-3/50"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="text-tertiary font-mono text-xs w-4">U</span>
      <span className="truncate text-primary">{node.name}</span>
    </button>
  );
}

export function DiffFileList({ status, onScrollToFile, isLoading }: DiffFileListProps) {
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

  const getStatusIcon = (statusType: string) => {
    switch (statusType) {
      case 'added':
        return <span className="text-diff-add-text font-mono text-xs">A</span>;
      case 'modified':
        return <span className="text-amber-500 dark:text-yellow-400 font-mono text-xs">M</span>;
      case 'deleted':
        return <span className="text-diff-remove-text font-mono text-xs">D</span>;
      case 'renamed':
        return <span className="text-blue-600 dark:text-blue-400 font-mono text-xs">R</span>;
      default:
        return <span className="text-tertiary font-mono text-xs">?</span>;
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Staged changes */}
      {status.staged.length > 0 && (
        <div className="mb-2">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-diff-add-text">
            Staged ({status.staged.length})
          </div>
          {status.staged.map((file) => (
            <button
              key={`staged-${file.path}`}
              onClick={() => onScrollToFile(file.path)}
              className="flex w-full items-center gap-2 px-3 py-1 text-sm hover:bg-surface-3/50"
            >
              {getStatusIcon(file.status)}
              <span className="truncate text-primary">{file.path}</span>
            </button>
          ))}
        </div>
      )}

      {/* Unstaged changes */}
      {status.unstaged.length > 0 && (
        <div className="mb-2">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-500 dark:text-yellow-400">
            Changed ({status.unstaged.length})
          </div>
          {status.unstaged.map((file) => (
            <button
              key={`unstaged-${file.path}`}
              onClick={() => onScrollToFile(file.path)}
              className="flex w-full items-center gap-2 px-3 py-1 text-sm hover:bg-surface-3/50"
            >
              {getStatusIcon(file.status)}
              <span className="truncate text-primary">{file.path}</span>
            </button>
          ))}
        </div>
      )}

      {/* Untracked files - tree view */}
      {untrackedTree && status.untracked.length > 0 && (
        <div className="mb-2">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-tertiary">
            Untracked ({status.untracked.length})
          </div>
          <FileTreeItem node={untrackedTree} depth={0} onScrollToFile={onScrollToFile} />
        </div>
      )}
    </div>
  );
}
