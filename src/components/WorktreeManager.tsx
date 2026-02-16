import { useState, useEffect, useCallback } from 'react';
import { ModalOverlay } from '@/components/ModalOverlay';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  listWorktrees,
  addWorktree,
  removeWorktree,
  listBranches,
  GitWorktree,
  GitBranch,
} from '@/lib/tauri';
import { BranchIcon, CloseIcon, PlusIcon, TrashIcon, SpinnerIcon } from '@/components/Icons';
import { getFileName } from '@/lib/fileUtils';

interface WorktreeManagerProps {
  repoPath: string;
  onClose: () => void;
  createTerminal: (cwd: string) => Promise<string>;
}

export function WorktreeManager({ repoPath, onClose, createTerminal }: WorktreeManagerProps) {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
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

  const handleRowClick = async (wt: GitWorktree) => {
    await createTerminal(wt.path);
    onClose();
  };

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
            onAdded={() => {
              setShowAddForm(false);
              refresh();
            }}
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
  onAdded: () => void;
  onCancel: () => void;
}

function AddWorktreeForm({ repoPath, onAdded, onCancel }: AddWorktreeFormProps) {
  const [path, setPath] = useState('');
  const [branchMode, setBranchMode] = useState<'new' | 'existing'>('new');
  const [newBranchName, setNewBranchName] = useState('');
  const [existingBranch, setExistingBranch] = useState('');
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBranches(repoPath).then((bs) => {
      const local = bs.filter((b) => !b.isRemote);
      setBranches(local);
      if (local.length > 0) setExistingBranch(local[0].name);
    });
  }, [repoPath]);

  const handleCreate = async () => {
    if (!path.trim()) return;
    setCreating(true);
    setError(null);
    try {
      if (branchMode === 'new') {
        await addWorktree(repoPath, path.trim(), undefined, newBranchName.trim() || undefined);
      } else {
        await addWorktree(repoPath, path.trim(), existingBranch || undefined);
      }
      onAdded();
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-3 border-t border-surface-3 pt-3">
      {/* Path input */}
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="../my-feature"
        className="mb-2 w-full rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-xs text-primary placeholder:text-tertiary focus:border-accent focus:outline-none"
        autoFocus
      />

      {/* Branch mode toggle */}
      <div className="mb-2 flex gap-1">
        <button
          onClick={() => setBranchMode('new')}
          className={`rounded-full px-2.5 py-0.5 text-[11px] ${
            branchMode === 'new'
              ? 'bg-accent text-white'
              : 'bg-surface-3 text-secondary hover:text-primary'
          }`}
        >
          New Branch
        </button>
        <button
          onClick={() => setBranchMode('existing')}
          className={`rounded-full px-2.5 py-0.5 text-[11px] ${
            branchMode === 'existing'
              ? 'bg-accent text-white'
              : 'bg-surface-3 text-secondary hover:text-primary'
          }`}
        >
          Existing Branch
        </button>
      </div>

      {/* Branch input */}
      {branchMode === 'new' ? (
        <input
          type="text"
          value={newBranchName}
          onChange={(e) => setNewBranchName(e.target.value)}
          placeholder="Branch name (optional)"
          className="mb-2 w-full rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-xs text-primary placeholder:text-tertiary focus:border-accent focus:outline-none"
        />
      ) : (
        <select
          value={existingBranch}
          onChange={(e) => setExistingBranch(e.target.value)}
          className="mb-2 w-full rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-xs text-primary focus:border-accent focus:outline-none"
        >
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {/* Error */}
      {error && <div className="mb-2 text-[11px] text-red-400">{error}</div>}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-xs text-secondary hover:bg-surface-3"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !path.trim()}
          className="rounded-md bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {creating ? <SpinnerIcon className="h-3 w-3 animate-spin" /> : 'Create'}
        </button>
      </div>
    </div>
  );
}
