import { useState, useEffect, useCallback } from 'react';
import { GitWorktree, listWorktrees, addWorktree, removeWorktree } from '@/lib/tauri';

export function useWorktrees(repoPath: string | null) {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!repoPath) {
      setWorktrees([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await listWorktrees(repoPath);
      setWorktrees(result);
    } catch (err) {
      console.error('Failed to list worktrees:', err);
      setError(err instanceof Error ? err.message : String(err));
      setWorktrees([]);
    } finally {
      setIsLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (worktreePath: string, branch?: string, newBranch?: string) => {
      if (!repoPath) {
        throw new Error('No repository path');
      }

      const newWorktree = await addWorktree(repoPath, worktreePath, branch, newBranch);
      await refresh();
      return newWorktree;
    },
    [repoPath, refresh]
  );

  const remove = useCallback(
    async (worktreePath: string, force: boolean = false) => {
      if (!repoPath) {
        throw new Error('No repository path');
      }

      await removeWorktree(repoPath, worktreePath, force);
      await refresh();
    },
    [repoPath, refresh]
  );

  return {
    worktrees,
    isLoading,
    error,
    refresh,
    add,
    remove,
  };
}
