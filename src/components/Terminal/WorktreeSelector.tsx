import { useState, useRef, useEffect } from 'react';
import { homeDir } from '@tauri-apps/api/path';
import { GitWorktree } from '@/lib/tauri';

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
  const [isNewBranch, setIsNewBranch] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string>('');

  const branchInputRef = useRef<HTMLInputElement>(null);

  // Get the project name from repoPath
  const projectName = repoPath.split('/').filter(Boolean).pop() || 'project';

  // Auto-generate worktree path based on branch name
  const worktreePath = branchName.trim()
    ? `${homePath}/.amend/${projectName}/${branchName.trim()}`
    : '';

  // Fetch home directory on mount
  useEffect(() => {
    homeDir().then(setHomePath).catch(console.error);
  }, []);

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

  const handleCreate = () => {
    if (!branchName.trim()) {
      setError('Branch name is required');
      return;
    }
    if (!worktreePath) {
      setError('Unable to generate path');
      return;
    }
    setError(null);
    onCreate(worktreePath, branchName.trim(), isNewBranch);
  };

  const getWorktreeName = (worktree: GitWorktree) => {
    const pathParts = worktree.path.split('/');
    return pathParts[pathParts.length - 1] || worktree.path;
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
                      {worktree.isMain ? (
                        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 0a8 8 0 1 0 8 8A8 8 0 0 0 8 0zm3.65 4.36L7.5 10.75 4.35 7.6l1.3-1.35L7.5 8.1l2.85-2.85z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25z" />
                        </svg>
                      )}
                    </span>
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <span className="truncate font-medium">{getWorktreeName(worktree)}</span>
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
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                        <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
                      </svg>
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
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 1v6H2v1h6v6h1V8h6V7H9V1z" />
                  </svg>
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
              <div>
                <label className="mb-1 block text-xs text-secondary">Branch Name</label>
                <input
                  ref={branchInputRef}
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="feature-branch"
                  className="w-full rounded-md bg-surface-1 px-2 py-1.5 text-sm text-primary placeholder-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="newBranch"
                  checked={isNewBranch}
                  onChange={(e) => setIsNewBranch(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="newBranch" className="text-xs text-primary">
                  Create new branch
                </label>
              </div>
              {worktreePath && (
                <div className="rounded-md bg-surface-1 px-2 py-1.5 text-xs text-secondary">
                  <span className="opacity-50">Path: </span>
                  <span className="font-mono">{worktreePath}</span>
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
                onClick={handleCreate}
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
