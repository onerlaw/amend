import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getGitStatus,
  getDiffStats,
  isGitRepository,
  GitStatus,
  DiffStats,
} from '@/lib/tauri';

const POLL_INTERVAL = 2000; // Poll every 2 seconds

export function useGitStatus(repoPath: string | null) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastStatusRef = useRef<string>('');

  const refresh = useCallback(async (silent = false) => {
    if (!repoPath) return;

    if (!silent) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const isRepo = await isGitRepository(repoPath);
      if (!isRepo) {
        setStatus(null);
        setError('Not a git repository');
        return;
      }

      const gitStatus = await getGitStatus(repoPath);

      // Only update state if status actually changed (to avoid unnecessary re-renders)
      // Use a lightweight key instead of JSON.stringify for large status objects
      const statusKey =
        gitStatus.staged.map((f) => `${f.path}:${f.status}`).join('|') +
        '||' +
        gitStatus.unstaged.map((f) => `${f.path}:${f.status}`).join('|') +
        '||' +
        gitStatus.untracked.join('|');
      if (statusKey !== lastStatusRef.current) {
        lastStatusRef.current = statusKey;
        setStatus(gitStatus);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get git status');
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [repoPath]);

  // Poll for changes
  useEffect(() => {
    if (!repoPath) return;

    // Initial fetch
    refresh();

    // Set up polling
    const intervalId = setInterval(() => {
      refresh(true); // Silent refresh (no loading state)
    }, POLL_INTERVAL);

    return () => clearInterval(intervalId);
  }, [repoPath, refresh]);

  const manualRefresh = useCallback(() => refresh(false), [refresh]);

  return { status, isLoading, error, refresh: manualRefresh };
}

export function useDiffStats(repoPath: string | null) {
  const [stats, setStats] = useState<DiffStats | null>(null);
  const lastStatsRef = useRef<string>('');

  const refresh = useCallback(async () => {
    if (!repoPath) return;

    try {
      const result = await getDiffStats(repoPath);
      const key = JSON.stringify(result);
      if (key !== lastStatsRef.current) {
        lastStatsRef.current = key;
        setStats(result);
      }
    } catch {
      // Silently ignore — stats are best-effort
    }
  }, [repoPath]);

  useEffect(() => {
    if (!repoPath) {
      setStats(null);
      lastStatsRef.current = '';
      return;
    }

    refresh();

    const intervalId = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(intervalId);
  }, [repoPath, refresh]);

  return stats;
}
