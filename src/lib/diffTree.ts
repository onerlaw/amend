import { GitStatus, GitFileStatus } from '@/lib/tauri';

export interface FileCategories {
  staged?: string;
  unstaged?: string;
  untracked?: boolean;
  conflicted?: boolean;
  branch?: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: Map<string, FileTreeNode>;
  categories?: FileCategories;
}

/**
 * Low-level helper: walks a slash-delimited file path and ensures every
 * intermediate directory node plus the final file node exist in the tree.
 * Returns the leaf node so callers can attach category metadata.
 */
function ensurePath(root: FileTreeNode, filePath: string): FileTreeNode {
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

function createRoot(): FileTreeNode {
  return { name: '', path: '', isDirectory: true, children: new Map() };
}

/**
 * Build a tree from working-tree git status (staged, unstaged, untracked,
 * conflicted categories).
 */
export function buildWorkingTree(status: GitStatus): FileTreeNode {
  const root = createRoot();

  for (const file of status.staged) {
    ensurePath(root, file.path).categories!.staged = file.status;
  }

  for (const file of status.unstaged) {
    ensurePath(root, file.path).categories!.unstaged = file.status;
  }

  for (const path of status.untracked) {
    ensurePath(root, path).categories!.untracked = true;
  }

  if (status.conflicted) {
    for (const path of status.conflicted) {
      ensurePath(root, path).categories!.conflicted = true;
    }
  }

  return root;
}

/**
 * Build a tree from branch diff file list (all files share the "branch"
 * category).
 */
export function buildBranchTree(files: GitFileStatus[]): FileTreeNode {
  const root = createRoot();

  for (const file of files) {
    ensurePath(root, file.path).categories!.branch = file.status;
  }

  return root;
}
