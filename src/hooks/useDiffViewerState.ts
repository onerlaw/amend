import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { useMultiFileDiff } from '@/hooks/useMultiFileDiff';
import { useBranchDiff } from '@/hooks/useBranchDiff';
import { openFileInBrowseMode, getFileName } from '@/lib/fileUtils';
import { GitPollingResult } from '@/hooks/useGit';

export interface FileWithCategory {
  path: string;
  category: 'staged' | 'unstaged' | 'untracked' | 'conflicted' | 'branch';
}

export function useDiffViewerState(gitPolling: GitPollingResult, enabled: boolean = true) {
  const { currentDirectory, contextPath } = useFileStore();
  const {
    collapsedDiffFiles,
    toggleDiffFileCollapse,
    scrollTargetFile,
    setScrollTargetFile,
    setPanelMode,
    diffMode,
    diffBaseBranch,
  } = useUIStore();
  const { status, isLoading: statusLoading, refresh } = gitPolling;
  const { diffs: workingDiffs, loadDiff, clearDiffs: clearWorkingDiffs } = useMultiFileDiff(contextPath);

  // Branch diff hook — always called but only active when in branch mode with a base branch
  const branchDiff = useBranchDiff(
    diffMode === 'branch' ? contextPath : null,
    diffMode === 'branch' ? diffBaseBranch : null
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Build ordered list of all changed files with their categories
  const workingFiles = useMemo((): FileWithCategory[] => {
    if (!status) return [];
    return [
      ...status.conflicted.map((path) => ({ path, category: 'conflicted' as const })),
      ...status.staged.map((f) => ({ path: f.path, category: 'staged' as const })),
      ...status.unstaged.map((f) => ({ path: f.path, category: 'unstaged' as const })),
      ...status.untracked.map((path) => ({ path, category: 'untracked' as const })),
    ];
  }, [status]);

  const branchFiles = useMemo((): FileWithCategory[] => {
    return branchDiff.files.map((f) => ({ path: f.path, category: 'branch' as const }));
  }, [branchDiff.files]);

  const allFiles = diffMode === 'branch' ? branchFiles : workingFiles;
  const diffs = diffMode === 'branch' ? branchDiff.diffs : workingDiffs;

  // Reset when context path changes (must run before loadDiff to avoid race)
  useEffect(() => {
    if (!enabled) return;
    clearWorkingDiffs();
  }, [contextPath, clearWorkingDiffs, enabled]);

  // Load all working diffs when files change (runs into clean state after clearWorkingDiffs)
  useEffect(() => {
    if (!enabled || diffMode !== 'working') return;
    if (workingFiles.length > 0) {
      workingFiles.forEach((file) => {
        loadDiff(file.path);
      });
    }
  }, [workingFiles, loadDiff, enabled, diffMode]);

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
    if (diffMode === 'branch') {
      branchDiff.refresh();
    } else {
      refresh();
      clearWorkingDiffs();
    }
  }, [diffMode, refresh, clearWorkingDiffs, branchDiff.refresh]);

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
    diffMode,
    branchFiles: branchDiff.files,
    branchDiffStats: branchDiff.diffStats,
    branchIsLoading: branchDiff.isLoading,
    branchError: branchDiff.error,
  };
}
