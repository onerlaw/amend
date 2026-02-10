import { useState, useCallback, useEffect, useRef } from 'react';
import { getGitStatus, getDiffStats, isGitRepository, GitStatus, DiffStats } from '@/lib/tauri';

const POLL_INTERVAL = 2000;

/** Combined polling hook for git status and diff stats. Single interval, single source of truth. */
export function useGitPolling(repoPath: string | null) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastStatusRef = useRef<string>('');
  const lastStatsRef = useRef<string>('');

  const refresh = useCallback(
    async (silent = false) => {
      if (!repoPath) return;

      if (!silent) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const isRepo = await isGitRepository(repoPath);
        if (!isRepo) {
          setStatus(null);
          setDiffStats(null);
          setError('Not a git repository');
          return;
        }

        const [gitStatus, stats] = await Promise.all([
          getGitStatus(repoPath),
          getDiffStats(repoPath).catch(() => null),
        ]);

        // Only update status if actually changed (avoid unnecessary re-renders)
        const statusKey =
          gitStatus.staged.map((f) => `${f.path}:${f.status}`).join('|') +
          '||' +
          gitStatus.unstaged.map((f) => `${f.path}:${f.status}`).join('|') +
          '||' +
          gitStatus.untracked.join('|') +
          '||' +
          gitStatus.conflicted.join('|');
        if (statusKey !== lastStatusRef.current) {
          lastStatusRef.current = statusKey;
          setStatus(gitStatus);
        }

        const statsKey = JSON.stringify(stats);
        if (statsKey !== lastStatsRef.current) {
          lastStatsRef.current = statsKey;
          setDiffStats(stats);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to get git status');
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [repoPath]
  );

  useEffect(() => {
    if (!repoPath) {
      setStatus(null);
      setDiffStats(null);
      lastStatusRef.current = '';
      lastStatsRef.current = '';
      return;
    }

    refresh();
    const intervalId = setInterval(() => refresh(true), POLL_INTERVAL);
    return () => clearInterval(intervalId);
  }, [repoPath, refresh]);

  const manualRefresh = useCallback(() => refresh(false), [refresh]);

  return { status, diffStats, isLoading, error, refresh: manualRefresh };
}

export type GitPollingResult = ReturnType<typeof useGitPolling>;
