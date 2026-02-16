import { useState, useCallback, useRef } from 'react';
import { GitDiff } from '@/lib/tauri';

export interface FileDiffData {
  oldContent: string;
  newContent: string;
  isBinary: boolean;
  isLoading: boolean;
  error: string | null;
}

const DEFAULT_CONCURRENCY = 15;

/**
 * Reusable bounded async queue for loading file diffs with concurrency control.
 * Accepts a fetcher function so callers can supply different Tauri commands
 * (working-tree diff vs branch diff). Uses a generation ID to discard stale
 * responses after context changes.
 */
export function useDiffQueue(
  fetchDiff: (filePath: string) => Promise<GitDiff>,
  concurrency: number = DEFAULT_CONCURRENCY
) {
  const [diffs, setDiffs] = useState<Map<string, FileDiffData>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const activeCountRef = useRef(0);
  const generationRef = useRef(0);

  const processQueue = useCallback(async () => {
    const generation = generationRef.current;

    while (queueRef.current.length > 0 && activeCountRef.current < concurrency) {
      // Bail if generation changed (context switch happened)
      if (generationRef.current !== generation) return;

      const filePath = queueRef.current.shift();
      if (!filePath) continue;
      if (loadingRef.current.has(filePath) || loadedRef.current.has(filePath)) continue;

      activeCountRef.current++;
      loadingRef.current.add(filePath);

      // Set loading state
      setDiffs((prev) => {
        const next = new Map(prev);
        next.set(filePath, {
          oldContent: '',
          newContent: '',
          isBinary: false,
          isLoading: true,
          error: null,
        });
        return next;
      });

      try {
        const diff: GitDiff = await fetchDiff(filePath);

        // Discard result if generation changed while awaiting
        if (generationRef.current !== generation) return;

        loadedRef.current.add(filePath);
        setDiffs((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            oldContent: diff.oldContent,
            newContent: diff.newContent,
            isBinary: diff.isBinary,
            isLoading: false,
            error: null,
          });
          return next;
        });
      } catch (err) {
        // Discard error if generation changed while awaiting
        if (generationRef.current !== generation) return;

        setDiffs((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            oldContent: '',
            newContent: '',
            isBinary: false,
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to load diff',
          });
          return next;
        });
      } finally {
        loadingRef.current.delete(filePath);
        // Always decrement — the slot is freed regardless of generation.
        // Math.max guards against underflow as an invariant safety net.
        activeCountRef.current = Math.max(0, activeCountRef.current - 1);
        // Only continue processing the queue if still on the same generation.
        if (generationRef.current === generation) {
          processQueue();
        }
      }
    }
  }, [fetchDiff, concurrency]);

  const enqueue = useCallback(
    (filePath: string) => {
      // Skip if already loading or loaded
      if (loadingRef.current.has(filePath) || loadedRef.current.has(filePath)) {
        return;
      }

      // Skip if already in queue
      if (queueRef.current.includes(filePath)) {
        return;
      }

      // Add to queue and process
      queueRef.current.push(filePath);
      processQueue();
    },
    [processQueue]
  );

  const enqueueBatch = useCallback(
    (filePaths: string[]) => {
      for (const filePath of filePaths) {
        if (
          !loadingRef.current.has(filePath) &&
          !loadedRef.current.has(filePath) &&
          !queueRef.current.includes(filePath)
        ) {
          queueRef.current.push(filePath);
        }
      }
      processQueue();
    },
    [processQueue]
  );

  const clear = useCallback(() => {
    // Bump generation to invalidate all in-flight requests.
    // Do NOT reset activeCountRef — in-flight requests will still decrement
    // it in their finally blocks, naturally draining the count to zero.
    generationRef.current++;
    setDiffs(new Map());
    loadingRef.current.clear();
    loadedRef.current.clear();
    queueRef.current = [];
  }, []);

  return { diffs, enqueue, enqueueBatch, clear, generationRef, activeCountRef };
}
