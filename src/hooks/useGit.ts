import { useState, useCallback, useEffect, useRef } from 'react';
import { gitPollData, gitQuickCheck, GitStatus, DiffStats } from '@/lib/tauri';

/** Adaptive polling intervals (ms) */
const MIN_INTERVAL = 2_000;
const MAX_INTERVAL = 30_000;
const BACKOFF_MULTIPLIER = 1.5;

/** Combined polling hook for git status and diff stats.
 *  Uses adaptive polling: short interval after changes, backs off when idle.
 *  A lightweight fingerprint check avoids expensive status+diff computation
 *  when nothing has changed.
 */
export function useGitPolling(repoPath: string | null) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastStatusRef = useRef<string>('');
  const lastStatsRef = useRef<string>('');
  const pollingRef = useRef(false);
  const fingerprintRef = useRef<string>('');
  const intervalRef = useRef(MIN_INTERVAL);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Do a full poll: fetch status + diff stats from the backend. */
  const fullPoll = useCallback(
    async (silent: boolean) => {
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

        // Update cached fingerprint
        fingerprintRef.current = data.fingerprint;

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

  /** Adaptive tick: do a cheap fingerprint check first, only do
   *  a full poll if something changed. Backs off when idle. */
  const tick = useCallback(async () => {
    if (!repoPath) return;
    if (pollingRef.current) return;

    try {
      // If we have a cached fingerprint, do a cheap check first
      if (fingerprintRef.current) {
        const changed = await gitQuickCheck(repoPath, fingerprintRef.current);
        if (!changed) {
          // Nothing changed — back off
          intervalRef.current = Math.min(intervalRef.current * BACKOFF_MULTIPLIER, MAX_INTERVAL);
          return;
        }
      }

      // Something changed (or first poll) — do full poll and reset interval
      await fullPoll(true);
      intervalRef.current = MIN_INTERVAL;
    } catch {
      // On error, back off
      intervalRef.current = Math.min(intervalRef.current * BACKOFF_MULTIPLIER, MAX_INTERVAL);
    }
  }, [repoPath, fullPoll]);

  /** Schedule the next tick. Uses setTimeout for adaptive intervals. */
  const scheduleNext = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(async () => {
      await tick();
      scheduleNext();
    }, intervalRef.current);
  }, [tick]);

  /** Reset the polling interval to minimum (e.g. after user activity). */
  const resetInterval = useCallback(() => {
    intervalRef.current = MIN_INTERVAL;
    // Reschedule with the shorter interval
    scheduleNext();
  }, [scheduleNext]);

  useEffect(() => {
    if (!repoPath) {
      setStatus(null);
      setDiffStats(null);
      lastStatusRef.current = '';
      lastStatsRef.current = '';
      fingerprintRef.current = '';
      intervalRef.current = MIN_INTERVAL;
      return;
    }

    // Initial full poll
    fullPoll(true);
    scheduleNext();

    // Pause polling when tab is hidden, refresh immediately on re-focus
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        intervalRef.current = MIN_INTERVAL;
        fullPoll(true);
        scheduleNext();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [repoPath, fullPoll, scheduleNext]);

  const manualRefresh = useCallback(() => {
    intervalRef.current = MIN_INTERVAL;
    scheduleNext();
    return fullPoll(false);
  }, [fullPoll, scheduleNext]);

  return { status, diffStats, isLoading, error, refresh: manualRefresh, resetInterval };
}

export type GitPollingResult = ReturnType<typeof useGitPolling>;
