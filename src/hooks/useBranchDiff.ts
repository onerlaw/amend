import { useState, useCallback, useRef, useEffect } from 'react';
import { getBranchDiffFiles, getBranchFileDiff, GitFileStatus, DiffStats } from '@/lib/tauri';
import { useDiffQueue } from '@/hooks/useDiffQueue';

export function useBranchDiff(repoPath: string | null, baseRef: string | null) {
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [mergeBase, setMergeBase] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mergeBaseRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);

  const fetchDiff = useCallback(
    (filePath: string) => {
      const mb = mergeBaseRef.current;
      if (!repoPath || !mb) return Promise.reject(new Error('No repo path or merge base'));
      return getBranchFileDiff(repoPath, mb, filePath);
    },
    [repoPath]
  );

  const { diffs, enqueueBatch, clear: clearQueue } = useDiffQueue(fetchDiff);

  const clearDiffs = useCallback(() => {
    clearQueue();
    setFiles([]);
    setDiffStats(null);
    setMergeBase(null);
    setError(null);
    mergeBaseRef.current = null;
  }, [clearQueue]);

  const load = useCallback(async () => {
    if (!repoPath || !baseRef) return;

    // Bump generation to invalidate any in-flight requests from previous load
    loadGenerationRef.current++;
    const generation = loadGenerationRef.current;

    // Clear previous queue state
    clearQueue();

    setIsLoading(true);
    setError(null);

    try {
      const summary = await getBranchDiffFiles(repoPath, baseRef);

      // Discard result if generation changed while awaiting
      if (loadGenerationRef.current !== generation) return;

      setFiles(summary.files);
      setDiffStats(summary.diffStats);
      setMergeBase(summary.mergeBase);
      mergeBaseRef.current = summary.mergeBase;

      // Queue all file diffs
      enqueueBatch(summary.files.map((f) => f.path));
    } catch (err) {
      // Discard error if generation changed while awaiting
      if (loadGenerationRef.current !== generation) return;

      setError(err instanceof Error ? err.message : 'Failed to load branch diff');
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [repoPath, baseRef, clearQueue, enqueueBatch]);

  // Load when repoPath or baseRef changes
  useEffect(() => {
    if (repoPath && baseRef) {
      load();
    } else {
      clearDiffs();
    }
  }, [repoPath, baseRef, load, clearDiffs]);

  return { files, diffStats, diffs, mergeBase, isLoading, error, refresh: load, clearDiffs };
}
