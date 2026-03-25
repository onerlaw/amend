import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ModalOverlay } from '@/components/ModalOverlay';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  listWorktrees,
  openOrCreateWorktree,
  removeWorktree,
  listBranches,
  getDefaultBranch,
  GitWorktree,
  GitBranch,
} from '@/lib/tauri';
import { BranchIcon, CloseIcon, PlusIcon, TrashIcon, SpinnerIcon } from '@/components/Icons';
import { getFileName } from '@/lib/fileUtils';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';

interface WorktreeManagerProps {
  repoPath: string;
  onClose: () => void;
  createTerminal: (cwd: string) => Promise<string>;
  autoShowAddForm?: boolean;
}

export function WorktreeManager({
  repoPath,
  onClose,
  createTerminal,
  autoShowAddForm,
}: WorktreeManagerProps) {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(autoShowAddForm ?? false);
  const [removing, setRemoving] = useState<GitWorktree | null>(null);

  const refresh = useCallback(async () => {
    try {
      const wts = await listWorktrees(repoPath);
      setWorktrees(wts);
    } catch (err) {
      console.error('Failed to list worktrees:', err);
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openTerminalWithPaneAssignment = async (path: string) => {
    try {
      const newId = await createTerminal(path);
      const { focusedPaneId, assignTerminalToPane } = useTerminalLayoutStore.getState();
      if (focusedPaneId) {
        assignTerminalToPane(focusedPaneId, newId);
      }
    } catch (err) {
      console.error('Failed to create terminal:', err);
    }
  };

  const handleRowClick = async (wt: GitWorktree) => {
    await openTerminalWithPaneAssignment(wt.path);
    onClose();
  };

  const handleWorktreeOpenedOrCreated = useCallback(
    async (wt: GitWorktree) => {
      setShowAddForm(false);
      await openTerminalWithPaneAssignment(wt.path);
      onClose();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openTerminalWithPaneAssignment only captures stable callbacks
    [createTerminal, onClose]
  );

  const handleRemove = async () => {
    if (!removing) return;
    try {
      await removeWorktree(repoPath, removing.path);
      await refresh();
    } catch (err) {
      console.error('Failed to remove worktree:', err);
    }
    setRemoving(null);
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="w-96 rounded-xl bg-surface-2 p-4 shadow-xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary">Worktrees</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowAddForm(true)}
              className="rounded-md p-1 text-secondary hover:bg-surface-3"
              title="Add worktree"
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </button>
            <button onClick={onClose} className="rounded-md p-1 text-secondary hover:bg-surface-3">
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Worktree list */}
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <SpinnerIcon className="h-5 w-5 animate-spin text-secondary" />
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {worktrees.map((wt) => (
              <WorktreeRow
                key={wt.path}
                worktree={wt}
                onClick={() => handleRowClick(wt)}
                onRemove={() => setRemoving(wt)}
              />
            ))}
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <AddWorktreeForm
            repoPath={repoPath}
            onOpenedOrCreated={handleWorktreeOpenedOrCreated}
            onCancel={() => setShowAddForm(false)}
          />
        )}
      </div>

      {/* Confirm remove dialog */}
      {removing && (
        <ConfirmDialog
          title="Remove Worktree"
          message={
            <>
              Remove worktree at <span className="font-mono text-xs">{removing.path}</span>?
            </>
          }
          confirmLabel="Remove"
          confirmClassName="bg-red-600 hover:bg-red-700"
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </ModalOverlay>
  );
}

interface WorktreeRowProps {
  worktree: GitWorktree;
  onClick: () => void;
  onRemove: () => void;
}

function WorktreeRow({ worktree, onClick, onRemove }: WorktreeRowProps) {
  return (
    <div
      className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-3"
      onClick={onClick}
    >
      <BranchIcon className="h-3.5 w-3.5 shrink-0 text-secondary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs text-primary">{getFileName(worktree.path)}</span>
          {worktree.isMain && (
            <span className="rounded bg-accent/20 px-1 py-0.5 text-[10px] leading-none text-accent">
              main
            </span>
          )}
        </div>
        {worktree.branch && (
          <div className="truncate text-[11px] text-tertiary">{worktree.branch}</div>
        )}
      </div>
      {!worktree.isMain && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="rounded p-0.5 text-secondary opacity-0 hover:bg-surface-1 hover:text-red-400 group-hover:opacity-100"
          title="Remove worktree"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

interface AddWorktreeFormProps {
  repoPath: string;
  onOpenedOrCreated: (wt: GitWorktree) => void;
  onCancel: () => void;
}

function AddWorktreeForm({ repoPath, onOpenedOrCreated, onCancel }: AddWorktreeFormProps) {
  const [branchName, setBranchName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listBranches(repoPath)
      .then(setBranches)
      .catch(() => setBranches([]));
    getDefaultBranch(repoPath)
      .then(setDefaultBranch)
      .catch(() => {});
  }, [repoPath]);

  useEffect(() => {
    if (!showDropdown && !showFromDropdown) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setShowFromDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown, showFromDropdown]);

  const filtered = useMemo(() => {
    const lower = branchName.toLowerCase();
    return branches
      .filter((b) => !b.isCurrent && b.name.toLowerCase().includes(lower))
      .sort((a, b) => {
        if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }, [branches, branchName]);

  const filteredFrom = useMemo(() => {
    const lower = startPoint.toLowerCase();
    return branches
      .filter((b) => b.name.toLowerCase().includes(lower))
      .sort((a, b) => {
        if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }, [branches, startPoint]);

  const handleSelect = (branch: GitBranch) => {
    // For remote branches strip the remote prefix (e.g. "origin/foo" → "foo")
    const name = branch.isRemote ? branch.name.replace(/^[^/]+\//, '') : branch.name;
    setBranchName(name);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const handleFromSelect = (branch: GitBranch) => {
    setStartPoint(branch.name);
    setShowFromDropdown(false);
  };

  const handleSubmit = async () => {
    const trimmed = branchName.trim();
    if (!trimmed) return;
    setShowDropdown(false);
    setShowFromDropdown(false);
    setLoading(true);
    setError(null);
    try {
      const wt = await openOrCreateWorktree(repoPath, trimmed, startPoint.trim() || undefined);
      onOpenedOrCreated(wt);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') {
      if (showDropdown || showFromDropdown) {
        setShowDropdown(false);
        setShowFromDropdown(false);
      } else {
        onCancel();
      }
    }
  };

  return (
    <div className="mt-3 border-t border-surface-3 pt-3" ref={containerRef}>
      <div className="relative mb-2">
        <input
          ref={inputRef}
          type="text"
          value={branchName}
          onChange={(e) => {
            setBranchName(e.target.value);
            setShowDropdown(true);
            setShowFromDropdown(false);
          }}
          onFocus={() => {
            setShowDropdown(true);
            setShowFromDropdown(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Branch name"
          className="w-full rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-xs text-primary placeholder:text-tertiary focus:border-accent focus:outline-none"
          autoFocus
        />
        {showDropdown && filtered.length > 0 && (
          <div className="absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-md border border-surface-3 bg-surface-1 shadow-lg">
            <div className="max-h-40 overflow-y-auto">
              {filtered.map((branch) => (
                <button
                  key={branch.name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(branch);
                  }}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-primary hover:bg-surface-3"
                >
                  {branch.isRemote && <span className="flex-shrink-0 text-tertiary">remote</span>}
                  <span className="truncate">{branch.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="relative mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-tertiary">from</span>
          <input
            type="text"
            value={startPoint}
            onChange={(e) => {
              setStartPoint(e.target.value);
              setShowFromDropdown(true);
              setShowDropdown(false);
            }}
            onFocus={() => {
              setShowFromDropdown(true);
              setShowDropdown(false);
            }}
            onKeyDown={handleKeyDown}
            placeholder={defaultBranch}
            className="min-w-0 flex-1 rounded-md border border-surface-3 bg-surface-1 px-2 py-0.5 text-[11px] text-secondary placeholder:text-tertiary focus:border-accent focus:outline-none"
          />
        </div>
        {showFromDropdown && filteredFrom.length > 0 && (
          <div className="absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-md border border-surface-3 bg-surface-1 shadow-lg">
            <div className="max-h-40 overflow-y-auto">
              {filteredFrom.map((branch) => (
                <button
                  key={branch.name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleFromSelect(branch);
                  }}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-primary hover:bg-surface-3"
                >
                  {branch.isRemote && <span className="flex-shrink-0 text-tertiary">remote</span>}
                  <span className="truncate">{branch.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {error && <div className="mb-2 text-[11px] text-red-400">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-xs text-secondary hover:bg-surface-3"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading || !branchName.trim()}
          className="rounded-md bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? <SpinnerIcon className="h-3 w-3 animate-spin" /> : 'Open'}
        </button>
      </div>
    </div>
  );
}
