import { useEffect, useMemo, useCallback, useRef } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { useMultiFileDiff } from '@/hooks/useMultiFileDiff';
import { openFileInBrowseMode, getFileName } from '@/lib/fileUtils';
import { GitPollingResult } from '@/hooks/useGit';

export interface FileWithCategory {
  path: string;
  category: 'staged' | 'unstaged' | 'untracked';
}

export function useDiffViewerState(gitPolling: GitPollingResult) {
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

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Build ordered list of all changed files with their categories
  const allFiles = useMemo((): FileWithCategory[] => {
    if (!status) return [];
    return [
      ...status.staged.map((f) => ({ path: f.path, category: 'staged' as const })),
      ...status.unstaged.map((f) => ({ path: f.path, category: 'unstaged' as const })),
      ...status.untracked.map((path) => ({ path, category: 'untracked' as const })),
    ];
  }, [status]);

  // Load all diffs when files change (expanded by default)
  useEffect(() => {
    if (allFiles.length > 0) {
      allFiles.forEach((file) => {
        loadDiff(file.path);
      });
    }
  }, [allFiles, loadDiff]);

  // Reset when context path changes
  useEffect(() => {
    clearDiffs();
  }, [contextPath, clearDiffs]);

  useEffect(() => {
    if (contextPath) {
      refresh();
    }
  }, [contextPath, refresh]);

  // Handle scroll-to-file using Virtuoso
  useEffect(() => {
    if (scrollTargetFile && virtuosoRef.current) {
      const index = allFiles.findIndex((f) => f.path === scrollTargetFile);
      if (index !== -1) {
        virtuosoRef.current.scrollToIndex({
          index,
          behavior: 'smooth',
          align: 'start',
        });
      }
      setScrollTargetFile(null);
    }
  }, [scrollTargetFile, setScrollTargetFile, allFiles]);

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
    virtuosoRef,
    toggleDiffFileCollapse,
    handleRefresh,
    handleEditFile,
    handleScrollToFile,
  };
}
