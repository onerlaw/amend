import { useState, useCallback, useRef, useEffect } from 'react';
import {
  getBranchDiffFiles,
  getBranchFileDiff,
  GitFileStatus,
  DiffStats,
  GitDiff,
} from '@/lib/tauri';
import { FileDiffData } from '@/hooks/useMultiFileDiff';

const CONCURRENCY_LIMIT = 15;

export function useBranchDiff(repoPath: string | null, baseRef: string | null) {
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [mergeBase, setMergeBase] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Map<string, FileDiffData>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Concurrency queue refs
  const loadingRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const activeCountRef = useRef(0);
  const mergeBaseRef = useRef<string | null>(null);

  const processQueue = useCallback(async () => {
    while (queueRef.current.length > 0 && activeCountRef.current < CONCURRENCY_LIMIT) {
      const filePath = queueRef.current.shift();
      const mb = mergeBaseRef.current;
      if (!filePath || !repoPath || !mb) continue;
      if (loadingRef.current.has(filePath) || loadedRef.current.has(filePath)) continue;

      activeCountRef.current++;
      loadingRef.current.add(filePath);

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
        const diff: GitDiff = await getBranchFileDiff(repoPath, mb, filePath);
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
        activeCountRef.current--;
        processQueue();
      }
    }
  }, [repoPath]);

  const clearDiffs = useCallback(() => {
    setDiffs(new Map());
    setFiles([]);
    setDiffStats(null);
    setMergeBase(null);
    setError(null);
    mergeBaseRef.current = null;
    loadingRef.current.clear();
    loadedRef.current.clear();
    queueRef.current = [];
    activeCountRef.current = 0;
  }, []);

  const load = useCallback(async () => {
    if (!repoPath || !baseRef) return;

    // Clear previous state
    setDiffs(new Map());
    loadingRef.current.clear();
    loadedRef.current.clear();
    queueRef.current = [];
    activeCountRef.current = 0;

    setIsLoading(true);
    setError(null);

    try {
      const summary = await getBranchDiffFiles(repoPath, baseRef);
      setFiles(summary.files);
      setDiffStats(summary.diffStats);
      setMergeBase(summary.mergeBase);
      mergeBaseRef.current = summary.mergeBase;

      // Queue all file diffs
      for (const file of summary.files) {
        queueRef.current.push(file.path);
      }
      processQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load branch diff');
    } finally {
      setIsLoading(false);
    }
  }, [repoPath, baseRef, processQueue]);

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
