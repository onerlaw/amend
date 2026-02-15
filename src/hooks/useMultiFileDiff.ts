import { useCallback, useMemo } from 'react';
import { getFileDiff } from '@/lib/tauri';
import { useDiffQueue } from '@/hooks/useDiffQueue';

// Re-export for consumers that import FileDiffData from here
export type { FileDiffData } from '@/hooks/useDiffQueue';

/**
 * Hook for loading working-tree file diffs with concurrency control.
 * Delegates to useDiffQueue with the working-tree fetch function.
 */
export function useMultiFileDiff(repoPath: string | null) {
  const fetchDiff = useCallback(
    (filePath: string) => {
      if (!repoPath) return Promise.reject(new Error('No repo path'));
      return getFileDiff(repoPath, filePath);
    },
    [repoPath]
  );

  const { diffs, enqueue, clear } = useDiffQueue(fetchDiff);

  const loadDiff = useMemo(() => {
    if (!repoPath) return () => {};
    return enqueue;
  }, [repoPath, enqueue]);

  return { diffs, loadDiff, clearDiffs: clear };
}
