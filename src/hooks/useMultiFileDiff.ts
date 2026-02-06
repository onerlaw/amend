import { useState, useCallback, useRef } from 'react';
import { getFileDiff, GitDiff } from '@/lib/tauri';

export interface FileDiffData {
  oldContent: string;
  newContent: string;
  isBinary: boolean;
  isLoading: boolean;
  error: string | null;
}

const CONCURRENCY_LIMIT = 15;

/**
 * Hook for loading file diffs with concurrency control.
 */
export function useMultiFileDiff(repoPath: string | null) {
  const [diffs, setDiffs] = useState<Map<string, FileDiffData>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const activeCountRef = useRef(0);

  const processQueue = useCallback(async () => {
    while (queueRef.current.length > 0 && activeCountRef.current < CONCURRENCY_LIMIT) {
      const filePath = queueRef.current.shift();
      if (!filePath || !repoPath) continue;
      if (loadingRef.current.has(filePath) || loadedRef.current.has(filePath)) continue;

      activeCountRef.current++;
      loadingRef.current.add(filePath);

      // Set loading state
      setDiffs((prev) => {
        const newDiffs = new Map(prev);
        newDiffs.set(filePath, {
          oldContent: '',
          newContent: '',
          isBinary: false,
          isLoading: true,
          error: null,
        });
        return newDiffs;
      });

      try {
        const diff: GitDiff = await getFileDiff(repoPath, filePath);
        loadedRef.current.add(filePath);
        setDiffs((prev) => {
          const newDiffs = new Map(prev);
          newDiffs.set(filePath, {
            oldContent: diff.oldContent,
            newContent: diff.newContent,
            isBinary: diff.isBinary,
            isLoading: false,
            error: null,
          });
          return newDiffs;
        });
      } catch (err) {
        setDiffs((prev) => {
          const newDiffs = new Map(prev);
          newDiffs.set(filePath, {
            oldContent: '',
            newContent: '',
            isBinary: false,
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to load diff',
          });
          return newDiffs;
        });
      } finally {
        loadingRef.current.delete(filePath);
        activeCountRef.current--;
        // Continue processing queue
        processQueue();
      }
    }
  }, [repoPath]);

  const loadDiff = useCallback(
    (filePath: string) => {
      if (!repoPath) return;

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
    [repoPath, processQueue]
  );

  const clearDiffs = useCallback(() => {
    setDiffs(new Map());
    loadingRef.current.clear();
    loadedRef.current.clear();
    queueRef.current = [];
    activeCountRef.current = 0;
  }, []);

  return { diffs, loadDiff, clearDiffs };
}
