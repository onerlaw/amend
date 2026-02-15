import { useState, useCallback, useEffect, useRef } from 'react';
import { gitPollData, GitStatus, DiffStats } from '@/lib/tauri';

const POLL_INTERVAL = 5000;

/** Combined polling hook for git status and diff stats. Single interval, single source of truth. */
export function useGitPolling(repoPath: string | null) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastStatusRef = useRef<string>('');
  const lastStatsRef = useRef<string>('');
  const pollingRef = useRef(false);

  const refresh = useCallback(
    async (silent = false) => {
      if (!repoPath) return;

      // Overlap guard: skip if previous poll is still running
      if (silent && pollingRef.current) return;
      pollingRef.current = true;

      if (!silent) {
        setIsLoading(true);
        // Force state updates even if data is unchanged — after clearWorkingDiffs()
        // clears the diff map, we need setStatus to fire so workingFiles recalculates
        // and the diff-loading effect re-triggers.
        lastStatusRef.current = '';
        lastStatsRef.current = '';
      }
      setError(null);

      try {
        const data = await gitPollData(repoPath);

        // Only update status if actually changed (avoid unnecessary re-renders)
        const statusKey =
          data.status.staged.map((f) => `${f.path}:${f.status}`).join('|') +
          '||' +
          data.status.unstaged.map((f) => `${f.path}:${f.status}`).join('|') +
          '||' +
          data.status.untracked.join('|') +
          '||' +
          data.status.conflicted.join('|');
        if (statusKey !== lastStatusRef.current) {
          lastStatusRef.current = statusKey;
          setStatus(data.status);
        }

        const statsKey = JSON.stringify(data.diffStats);
        if (statsKey !== lastStatsRef.current) {
          lastStatsRef.current = statsKey;
          setDiffStats(data.diffStats);
        }
      } catch (err) {
        // Repository::discover error means not a git repo
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('could not find repository')) {
          setStatus(null);
          setDiffStats(null);
          setError('Not a git repository');
        } else {
          setError(msg || 'Failed to get git status');
        }
      } finally {
        pollingRef.current = false;
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

    refresh(true);
    const intervalId = setInterval(() => refresh(true), POLL_INTERVAL);

    // Pause polling when tab is hidden, refresh immediately on re-focus
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [repoPath, refresh]);

  const manualRefresh = useCallback(() => refresh(false), [refresh]);

  return { status, diffStats, isLoading, error, refresh: manualRefresh };
}

export type GitPollingResult = ReturnType<typeof useGitPolling>;
