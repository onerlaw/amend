import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { useMultiFileDiff } from '@/hooks/useMultiFileDiff';
import { openFileInBrowseMode, getFileName } from '@/lib/fileUtils';
import { GitPollingResult } from '@/hooks/useGit';

export interface FileWithCategory {
  path: string;
  category: 'staged' | 'unstaged' | 'untracked' | 'conflicted';
}

export function useDiffViewerState(gitPolling: GitPollingResult, enabled: boolean = true) {
  const { currentDirectory, contextPath } = useFileStore();
  const {
    collapsedDiffFiles,
    toggleDiffFileCollapse,
    scrollTargetFile,
    setScrollTargetFile,
    setPanelMode,
  } = useUIStore();
  const { status, isLoading: statusLoading, refresh } = gitPolling;
  const { diffs, loadDiff, clearDiffs } = useMultiFileDiff(contextPath);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Build ordered list of all changed files with their categories
  const allFiles = useMemo((): FileWithCategory[] => {
    if (!status) return [];
    return [
      ...status.conflicted.map((path) => ({ path, category: 'conflicted' as const })),
      ...status.staged.map((f) => ({ path: f.path, category: 'staged' as const })),
      ...status.unstaged.map((f) => ({ path: f.path, category: 'unstaged' as const })),
      ...status.untracked.map((path) => ({ path, category: 'untracked' as const })),
    ];
  }, [status]);

  // Reset when context path changes (must run before loadDiff to avoid race)
  useEffect(() => {
    if (!enabled) return;
    clearDiffs();
  }, [contextPath, clearDiffs, enabled]);

  // Load all diffs when files change (runs into clean state after clearDiffs)
  useEffect(() => {
    if (!enabled) return;
    if (allFiles.length > 0) {
      allFiles.forEach((file) => {
        loadDiff(file.path);
      });
    }
  }, [allFiles, loadDiff, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (contextPath) {
      refresh();
    }
  }, [contextPath, refresh, enabled]);

  // Handle scroll-to-file using data attributes
  useEffect(() => {
    if (scrollTargetFile && scrollContainerRef.current) {
      const el = scrollContainerRef.current.querySelector(
        `[data-file-path="${CSS.escape(scrollTargetFile)}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      setScrollTargetFile(null);
    }
  }, [scrollTargetFile, setScrollTargetFile]);

  const handleRefresh = useCallback(() => {
    refresh();
    clearDiffs();
  }, [refresh, clearDiffs]);

  const handleEditFile = useCallback(
    async (filePath: string) => {
      if (!contextPath) return;
      const fullPath = `${contextPath}/${filePath}`;
      const displayName = getFileName(filePath);

      try {
        await openFileInBrowseMode(fullPath, displayName);
      } catch (err) {
        console.error('Failed to open file:', err);
      }
      setPanelMode('browse');
    },
    [contextPath, setPanelMode]
  );

  const handleScrollToFile = useCallback(
    (path: string) => {
      // If collapsed, expand it first
      if (collapsedDiffFiles.has(path)) {
        toggleDiffFileCollapse(path);
      }
      setScrollTargetFile(path);
    },
    [collapsedDiffFiles, toggleDiffFileCollapse, setScrollTargetFile]
  );

  return {
    currentDirectory,
    contextPath,
    status,
    statusLoading,
    allFiles,
    diffs,
    collapsedDiffFiles,
    scrollContainerRef,
    toggleDiffFileCollapse,
    handleRefresh,
    handleEditFile,
    handleScrollToFile,
  };
}
