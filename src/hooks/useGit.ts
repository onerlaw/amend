import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getGitStatus,
  getFileDiff,
  isGitRepository,
  GitStatus,
  GitDiff,
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
      const statusKey = JSON.stringify(gitStatus);
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

export function useFileDiff() {
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentFileRef = useRef<{ repoPath: string; filePath: string } | null>(null);
  const lastDiffRef = useRef<string>('');

  const loadDiff = useCallback(async (repoPath: string, filePath: string, silent = false) => {
    currentFileRef.current = { repoPath, filePath };

    if (!silent) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const fileDiff = await getFileDiff(repoPath, filePath);

      // Only update if diff actually changed
      const diffKey = JSON.stringify(fileDiff);
      if (diffKey !== lastDiffRef.current) {
        lastDiffRef.current = diffKey;
        setDiff(fileDiff);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get file diff');
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  const clearDiff = useCallback(() => {
    currentFileRef.current = null;
    lastDiffRef.current = '';
    setDiff(null);
    setError(null);
  }, []);

  // Poll for diff changes when a file is selected
  useEffect(() => {
    if (!currentFileRef.current) return;

    const intervalId = setInterval(() => {
      if (currentFileRef.current) {
        loadDiff(currentFileRef.current.repoPath, currentFileRef.current.filePath, true);
      }
    }, POLL_INTERVAL);

    return () => clearInterval(intervalId);
  }, [loadDiff]);

  const manualLoadDiff = useCallback((r: string, f: string) => loadDiff(r, f, false), [loadDiff]);

  return { diff, isLoading, error, loadDiff: manualLoadDiff, clearDiff };
}
