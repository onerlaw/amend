import { useState, useRef, useEffect, useMemo } from 'react';
import { homeDir } from '@tauri-apps/api/path';
import { GitWorktree, GitBranch, listBranches } from '@/lib/tauri';
import { PlusIcon, MainBranchIcon, BranchIcon, TrashIcon } from '@/components/Icons';
import { getFileName } from '@/lib/fileUtils';

interface WorktreeSelectorProps {
  worktrees: GitWorktree[];
  onSelect: (worktree: GitWorktree) => void;
  onCreate: (path: string, branch: string, isNewBranch: boolean) => void;
  onDelete: (worktree: GitWorktree) => void;
  onCancel: () => void;
  repoPath: string;
}

type Mode = 'select' | 'create';

export function WorktreeSelector({ worktrees, onSelect, onCreate, onDelete, onCancel, repoPath }: WorktreeSelectorProps) {
  const [mode, setMode] = useState<Mode>('select');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Create form state
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string>('');
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [branchSelectedIndex, setBranchSelectedIndex] = useState(0);

  const branchInputRef = useRef<HTMLInputElement>(null);

  // Get the project name from repoPath
  const projectName = repoPath.split('/').filter(Boolean).pop() || 'project';

  // Auto-generate worktree path based on branch name
  const worktreePath = branchName.trim()
    ? `${homePath}/.amend/${projectName}/${branchName.trim()}`
    : '';

  // Fetch home directory and branches on mount
  useEffect(() => {
    homeDir().then(setHomePath).catch(console.error);
    listBranches(repoPath).then(setBranches).catch(console.error);
  }, [repoPath]);

  // Filter branches based on input - exclude branches already used by worktrees
  const filteredBranches = useMemo(() => {
    const query = branchName.trim().toLowerCase();
    if (!query) return [];
    const usedBranches = new Set(worktrees.map(w => w.branch));
    return branches
      .filter(b => !usedBranches.has(b.name) && b.name.toLowerCase().includes(query))
      .slice(0, 5); // Limit to 5 suggestions
  }, [branches, branchName, worktrees]);

  const isNewBranch = branchName.trim() !== '' && filteredBranches.length === 0;
  const exactMatch = filteredBranches.find(b => b.name.toLowerCase() === branchName.trim().toLowerCase());

  // Reset selection when filtered results change
  useEffect(() => {
    setBranchSelectedIndex(0);
  }, [filteredBranches.length]);

  // Total items = worktrees + "Create New" option
  const totalItems = worktrees.length + 1;
  const createNewIndex = worktrees.length;

  useEffect(() => {
    if (mode === 'select') {
      containerRef.current?.focus();
    } else {
      branchInputRef.current?.focus();
    }
  }, [mode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mode === 'create') {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMode('select');
        setError(null);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, totalItems - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex === createNewIndex) {
          setMode('create');
        } else if (worktrees[selectedIndex]) {
          onSelect(worktrees[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onCancel();
        break;
    }
  };

  const handleCreate = (selectedBranch?: string) => {
    const finalBranch = selectedBranch || branchName.trim();
    if (!finalBranch) {
      setError('Branch name is required');
      return;
    }

    // Determine the worktree path based on the branch
    const finalPath = `${homePath}/.amend/${projectName}/${finalBranch}`;
    if (!finalPath) {
      setError('Unable to generate path');
      return;
    }

    // Check if this is an existing branch
    const existingBranch = branches.find(b => b.name === finalBranch);
    setError(null);
    onCreate(finalPath, finalBranch, !existingBranch);
  };

  const handleBranchSelect = (branch: GitBranch) => {
    setBranchName(branch.name);
    handleCreate(branch.name);
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/60"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={onCancel}
    >
      <div
        className="w-80 rounded-xl bg-surface-2 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === 'select' ? (
          <>
            <div className="px-3 py-2">
              <span className="text-sm font-medium text-primary">Select Worktree</span>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {worktrees.map((worktree, index) => (
                <div
                  key={worktree.path}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`group flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    index === selectedIndex ? 'bg-accent text-white' : 'text-primary hover:bg-surface-1'
                  }`}
                >
                  <button
                    onClick={() => onSelect(worktree)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <span className="flex-shrink-0">
                      {worktree.isMain ? <MainBranchIcon /> : <BranchIcon />}
                    </span>
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <span className="truncate font-medium">{getFileName(worktree.path)}</span>
                      <span className="truncate text-xs opacity-60">{worktree.branch}</span>
                    </div>
                  </button>
                  {!worktree.isMain && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(worktree);
                      }}
                      className={`rounded-md p-1 opacity-0 group-hover:opacity-100 ${
                        index === selectedIndex
                          ? 'hover:bg-white/20'
                          : 'hover:bg-surface-3'
                      }`}
                      title="Delete worktree"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              ))}
              {/* Create New Worktree option */}
              <button
                onClick={() => setMode('create')}
                onMouseEnter={() => setSelectedIndex(createNewIndex)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                  selectedIndex === createNewIndex
                    ? 'bg-accent text-white'
                    : 'text-primary hover:bg-surface-1'
                }`}
              >
                <span className="flex-shrink-0">
                  <PlusIcon />
                </span>
                <span className="font-medium">Create New Worktree</span>
              </button>
            </div>
            <div className="px-3 py-2 text-xs text-tertiary">
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded-md bg-surface-1 px-1">↑↓</kbd> Navigate
                <kbd className="ml-2 rounded-md bg-surface-1 px-1">Enter</kbd> Select
                <kbd className="ml-2 rounded-md bg-surface-1 px-1">Esc</kbd> Cancel
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="px-3 py-2">
              <span className="text-sm font-medium text-primary">Create New Worktree</span>
            </div>
            <div className="space-y-3 p-3">
              <div className="relative">
                <label className="mb-1 block text-xs text-secondary">Branch Name</label>
                <input
                  ref={branchInputRef}
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="feature-branch"
                  className="w-full rounded-md bg-surface-1 px-2 py-1.5 text-sm text-primary placeholder-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' && filteredBranches.length > 0) {
                      e.preventDefault();
                      setBranchSelectedIndex(i => Math.min(i + 1, filteredBranches.length - 1));
                    } else if (e.key === 'ArrowUp' && filteredBranches.length > 0) {
                      e.preventDefault();
                      setBranchSelectedIndex(i => Math.max(i - 1, 0));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (filteredBranches.length > 0 && !exactMatch) {
                        handleBranchSelect(filteredBranches[branchSelectedIndex]);
                      } else {
                        handleCreate();
                      }
                    }
                  }}
                />
                {/* Branch suggestions dropdown */}
                {filteredBranches.length > 0 && branchName.trim() && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md bg-surface-1 shadow-lg">
                    {filteredBranches.map((branch, index) => (
                      <button
                        key={branch.name}
                        onClick={() => handleBranchSelect(branch)}
                        onMouseEnter={() => setBranchSelectedIndex(index)}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                          index === branchSelectedIndex ? 'bg-accent text-white' : 'text-primary hover:bg-surface-3'
                        }`}
                      >
                        <BranchIcon className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
                        <span className="truncate">{branch.name}</span>
                        {branch.isRemote && (
                          <span className="ml-auto text-xs opacity-50">remote</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Status indicator */}
              {branchName.trim() && (
                <div className={`rounded-md px-2 py-1.5 text-xs ${isNewBranch ? 'bg-green-500/10 text-green-400' : 'bg-surface-1 text-secondary'}`}>
                  {isNewBranch ? (
                    <span className="flex items-center gap-1.5">
                      <PlusIcon className="h-3.5 w-3.5" />
                      Will create new branch "{branchName.trim()}"
                    </span>
                  ) : (
                    <span>
                      <span className="opacity-50">Path: </span>
                      <span className="font-mono">{worktreePath}</span>
                    </span>
                  )}
                </div>
              )}
              {error && <div className="text-xs text-red-400">{error}</div>}
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <button
                onClick={() => {
                  setMode('select');
                  setError(null);
                }}
                className="rounded-md px-2 py-1 text-xs text-secondary hover:bg-surface-1"
              >
                Back
              </button>
              <button
                onClick={() => handleCreate()}
                className="rounded-md bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover"
              >
                Create & Open Terminal
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
