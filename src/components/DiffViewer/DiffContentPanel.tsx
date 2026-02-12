import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useDiffViewer } from './DiffViewerContext';
import { useUIStore } from '@/stores/uiStore';
import { DiffFileSection } from './DiffFileSection';
import { DocumentIcon, CheckCircleIcon, SidebarIcon, ChevronIcon } from '@/components/Icons';
import { listBranches, GitBranch } from '@/lib/tauri';
import '@/styles/highlight-theme.css';

function BranchSelector({ repoPath }: { repoPath: string }) {
  const diffBaseBranch = useUIStore((s) => s.diffBaseBranch);
  const setDiffBaseBranch = useUIStore((s) => s.setDiffBaseBranch);
  const [isOpen, setIsOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [filter, setFilter] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const loadBranches = useCallback(async () => {
    try {
      const result = await listBranches(repoPath);
      setBranches(result);
    } catch {
      setBranches([]);
    }
  }, [repoPath]);

  useEffect(() => {
    if (isOpen) {
      loadBranches();
      setFilter('');
      setTimeout(() => filterRef.current?.focus(), 0);
    }
  }, [isOpen, loadBranches]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const filtered = useMemo(() => {
    const lower = filter.toLowerCase();
    return branches
      .filter((b) => !b.isCurrent && b.name.toLowerCase().includes(lower))
      .sort((a, b) => {
        // Local first, then remote
        if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }, [branches, filter]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-secondary hover:bg-surface-3 border border-surface-3 max-w-[160px]"
        title={diffBaseBranch ?? 'Select base branch'}
      >
        <span className="truncate">{diffBaseBranch ?? 'Select branch...'}</span>
        <ChevronIcon className={`h-3 w-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-md border border-surface-3 bg-surface-1 shadow-lg overflow-hidden">
          <div className="p-1.5">
            <input
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter branches..."
              className="w-full rounded-md bg-surface-0 border border-surface-3 px-2 py-1 text-xs text-primary placeholder:text-tertiary outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-tertiary">No branches found</div>
            )}
            {filtered.map((branch) => (
              <button
                key={branch.name}
                onClick={() => {
                  setDiffBaseBranch(branch.name);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3 flex items-center gap-1.5 ${
                  branch.name === diffBaseBranch ? 'text-accent' : 'text-primary'
                }`}
              >
                {branch.isRemote && (
                  <span className="text-tertiary flex-shrink-0">remote</span>
                )}
                <span className="truncate">{branch.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DiffContentPanel() {
  const {
    currentDirectory,
    contextPath,
    allFiles,
    diffs,
    collapsedDiffFiles,
    scrollContainerRef,
    toggleDiffFileCollapse,
    handleEditFile,
    handleRefresh,
    diffMode,
    branchIsLoading,
    branchError,
  } = useDiffViewer();
  const { diffFileListVisible, toggleDiffFileList, setFocusedPanel, setDiffMode, diffBaseBranch } =
    useUIStore();

  // No directory open state
  if (!currentDirectory) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-surface-0 px-6 text-center">
        <DocumentIcon className="h-16 w-16 text-tertiary mb-4" />
        <h3 className="text-lg font-medium text-primary mb-2">No Repository Open</h3>
        <p className="text-sm text-tertiary max-w-sm">
          Use "Open Repo" (Cmd+O) to open a Git repository and view changes.
        </p>
      </div>
    );
  }

  const changedFilesCount = allFiles.length;
  const isBranchMode = diffMode === 'branch';
  const showNoBranchSelected = isBranchMode && !diffBaseBranch;
  const showBranchLoading = isBranchMode && diffBaseBranch && branchIsLoading;
  const showBranchError = isBranchMode && diffBaseBranch && branchError;

  const statsText = isBranchMode
    ? changedFilesCount > 0
      ? `${changedFilesCount} file${changedFilesCount !== 1 ? 's' : ''} vs ${diffBaseBranch}`
      : diffBaseBranch
        ? 'No changes'
        : ''
    : changedFilesCount > 0
      ? `${changedFilesCount} file${changedFilesCount !== 1 ? 's' : ''} changed`
      : 'No changes';

  return (
    <div
      className="h-full overflow-hidden bg-surface-0 flex flex-col"
      onClick={() => setFocusedPanel('editor')}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5">
        {/* Mode toggle */}
        <div className="flex rounded-md border border-surface-3 overflow-hidden">
          <button
            onClick={() => setDiffMode('working')}
            className={`px-2 py-0.5 text-xs font-medium ${
              !isBranchMode
                ? 'bg-accent text-white'
                : 'text-secondary hover:bg-surface-3'
            }`}
          >
            Working
          </button>
          <button
            onClick={() => setDiffMode('branch')}
            className={`px-2 py-0.5 text-xs font-medium ${
              isBranchMode
                ? 'bg-accent text-white'
                : 'text-secondary hover:bg-surface-3'
            }`}
          >
            Branch
          </button>
        </div>

        {/* Branch selector */}
        {isBranchMode && contextPath && <BranchSelector repoPath={contextPath} />}

        <span className="text-xs text-tertiary flex-1">{statsText}</span>

        <button
          onClick={toggleDiffFileList}
          className={`rounded-md p-1 ${
            diffFileListVisible
              ? 'text-accent hover:bg-surface-3'
              : 'text-secondary hover:bg-surface-3'
          }`}
          title={diffFileListVisible ? 'Hide file list' : 'Show file list'}
        >
          <SidebarIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* No branch selected prompt */}
      {showNoBranchSelected && (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <h3 className="text-sm font-medium text-primary mb-1">Select a Base Branch</h3>
          <p className="text-xs text-tertiary">
            Choose a branch to compare against your current working state.
          </p>
        </div>
      )}

      {/* Branch loading */}
      {showBranchLoading && (
        <div className="flex h-full items-center justify-center text-tertiary text-sm">
          Loading branch diff...
        </div>
      )}

      {/* Branch error */}
      {showBranchError && (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <h3 className="text-sm font-medium text-red-500 mb-1">Error</h3>
          <p className="text-xs text-tertiary">{branchError}</p>
        </div>
      )}

      {/* Empty state */}
      {!showNoBranchSelected && !showBranchLoading && !showBranchError && changedFilesCount === 0 && (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <CheckCircleIcon className="h-12 w-12 text-green-500 mb-3" />
          <h3 className="text-sm font-medium text-primary mb-1">No Changes</h3>
          <p className="text-xs text-tertiary">
            {isBranchMode ? `No differences from ${diffBaseBranch}` : 'Working tree is clean'}
          </p>
        </div>
      )}

      {changedFilesCount > 0 && (
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          {allFiles.map((file) => {
            const diffData = diffs.get(file.path);
            return (
              <DiffFileSection
                key={`${file.category}-${file.path}`}
                filePath={file.path}
                category={file.category}
                oldContent={diffData?.oldContent ?? ''}
                newContent={diffData?.newContent ?? ''}
                isBinary={diffData?.isBinary ?? false}
                isCollapsed={collapsedDiffFiles.has(file.path)}
                isLoading={diffData?.isLoading ?? true}
                error={diffData?.error ?? null}
                onToggleCollapse={() => toggleDiffFileCollapse(file.path)}
                onEditFile={handleEditFile}
                repoPath={contextPath || ''}
                onRefresh={handleRefresh}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
