import { useState, useEffect, useCallback } from 'react';
import { ModalOverlay } from '@/components/ModalOverlay';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import {
  getAgentWorktreeDiff,
  type AgentWorkspace,
  type MergeStrategy,
  type GitFileStatus,
} from '@/lib/tauri';
import {
  CloseIcon,
  PlusIcon,
  TrashIcon,
  SpinnerIcon,
  BranchIcon,
  CheckCircleIcon,
} from '@/components/Icons';

interface ReviewPanelProps {
  repoPath: string;
  onClose: () => void;
  createTerminal: (cwd: string) => Promise<string>;
}

export function ReviewPanel({ repoPath, onClose, createTerminal }: ReviewPanelProps) {
  const { workspaces, loading, error, loadWorkspaces, createWorkspace, clearError } =
    useAgentWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [merging, setMerging] = useState<AgentWorkspace | null>(null);
  const [discarding, setDiscarding] = useState<AgentWorkspace | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadWorkspaces(repoPath);
  }, [repoPath, loadWorkspaces]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const ws = await createWorkspace(repoPath);
      await createTerminal(ws.path);
      onClose();
    } catch (err) {
      console.error('Failed to create agent workspace:', err);
    } finally {
      setCreating(false);
    }
  }, [repoPath, createWorkspace, createTerminal, onClose]);

  const handleOpenTerminal = useCallback(
    async (ws: AgentWorkspace) => {
      await createTerminal(ws.path);
      onClose();
    },
    [createTerminal, onClose]
  );

  const selected = workspaces.find((ws) => ws.id === selectedId) ?? null;

  return (
    <ModalOverlay onClose={onClose}>
      <div className="w-[480px] rounded-xl bg-surface-2 p-4 shadow-xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary">Agent Workspaces</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="rounded-md p-1 text-secondary hover:bg-surface-3 disabled:opacity-50"
              title="Create new agent workspace"
            >
              {creating ? (
                <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlusIcon className="h-3.5 w-3.5" />
              )}
            </button>
            <button onClick={onClose} className="rounded-md p-1 text-secondary hover:bg-surface-3">
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-2 flex items-center justify-between rounded-md bg-red-500/10 px-2 py-1">
            <span className="text-[11px] text-red-400">{error}</span>
            <button onClick={clearError} className="text-red-400 hover:text-red-300">
              <CloseIcon className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Content */}
        {loading && workspaces.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <SpinnerIcon className="h-5 w-5 animate-spin text-secondary" />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="py-6 text-center text-xs text-tertiary">
            No agent workspaces yet. Click + to create one.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {workspaces.map((ws) => (
              <WorkspaceRow
                key={ws.id}
                workspace={ws}
                isSelected={ws.id === selectedId}
                onSelect={() => setSelectedId(ws.id === selectedId ? null : ws.id)}
                onOpen={() => handleOpenTerminal(ws)}
                onMerge={() => setMerging(ws)}
                onDiscard={() => setDiscarding(ws)}
              />
            ))}
          </div>
        )}

        {/* Selected workspace diff */}
        {selected && <WorkspaceDiff repoPath={repoPath} workspace={selected} />}
      </div>

      {/* Merge dialog */}
      {merging && (
        <MergeDialog repoPath={repoPath} workspace={merging} onClose={() => setMerging(null)} />
      )}

      {/* Discard confirm dialog */}
      {discarding && (
        <DiscardDialog
          repoPath={repoPath}
          workspace={discarding}
          onClose={() => setDiscarding(null)}
        />
      )}
    </ModalOverlay>
  );
}

// --- Workspace Row ---

interface WorkspaceRowProps {
  workspace: AgentWorkspace;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMerge: () => void;
  onDiscard: () => void;
}

function WorkspaceRow({
  workspace,
  isSelected,
  onSelect,
  onOpen,
  onMerge,
  onDiscard,
}: WorkspaceRowProps) {
  return (
    <div
      className={`group rounded-md px-2 py-1.5 ${isSelected ? 'bg-surface-3' : 'hover:bg-surface-3'}`}
    >
      <div className="flex cursor-pointer items-center gap-2" onClick={onSelect}>
        <BranchIcon className="h-3.5 w-3.5 shrink-0 text-secondary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs text-primary">{workspace.id}</span>
            <StatusBadge status={workspace.status} />
          </div>
          <div className="truncate text-[11px] text-tertiary">{workspace.branch}</div>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="rounded p-0.5 text-secondary hover:bg-surface-1 hover:text-accent"
            title="Open terminal in workspace"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMerge();
            }}
            className="rounded p-0.5 text-secondary hover:bg-surface-1 hover:text-green-400"
            title="Merge workspace"
          >
            <CheckCircleIcon className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
            className="rounded p-0.5 text-secondary hover:bg-surface-1 hover:text-red-400"
            title="Discard workspace"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Status Badge ---

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-amber-500/20 text-amber-300',
    completed: 'bg-green-500/20 text-green-300',
    merging: 'bg-blue-500/20 text-blue-300',
  };

  return (
    <span
      className={`rounded px-1 py-0.5 text-[10px] leading-none ${colors[status] ?? 'bg-surface-3 text-tertiary'}`}
    >
      {status}
    </span>
  );
}

// --- Workspace Diff ---

function WorkspaceDiff({ repoPath, workspace }: { repoPath: string; workspace: AgentWorkspace }) {
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getAgentWorktreeDiff(repoPath, workspace.id)
      .then(setFiles)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [repoPath, workspace.id]);

  return (
    <div className="mt-3 border-t border-surface-3 pt-3">
      <div className="mb-1 text-[11px] font-medium text-secondary">
        Changed files ({files.length})
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-3">
          <SpinnerIcon className="h-4 w-4 animate-spin text-secondary" />
        </div>
      ) : error ? (
        <div className="py-2 text-[11px] text-red-400">{error}</div>
      ) : files.length === 0 ? (
        <div className="py-2 text-[11px] text-tertiary">No changes yet.</div>
      ) : (
        <div className="max-h-40 overflow-y-auto">
          {files.map((f) => (
            <div key={f.path} className="flex items-center gap-2 px-1 py-0.5">
              <FileStatusIndicator status={f.status} />
              <span className="truncate text-[11px] text-primary">{f.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileStatusIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    added: 'text-green-400',
    modified: 'text-amber-400',
    deleted: 'text-red-400',
    renamed: 'text-blue-400',
    copied: 'text-blue-400',
  };
  const labels: Record<string, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
  };
  return (
    <span className={`text-[10px] font-mono font-bold ${colors[status] ?? 'text-tertiary'}`}>
      {labels[status] ?? '?'}
    </span>
  );
}

// --- Merge Dialog ---

function MergeDialog({
  repoPath,
  workspace,
  onClose,
}: {
  repoPath: string;
  workspace: AgentWorkspace;
  onClose: () => void;
}) {
  const { mergeWorkspace } = useAgentWorkspaceStore();
  const [strategy, setStrategy] = useState<MergeStrategy>('squash');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMerge = async () => {
    setLoading(true);
    setError(null);
    try {
      await mergeWorkspace(repoPath, workspace.id, strategy);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="w-80 rounded-lg border border-surface-3 bg-surface-2 p-4 shadow-xl">
        <div className="mb-2 text-sm font-medium text-primary">Merge Workspace</div>
        <p className="mb-3 text-[11px] text-secondary">
          Merge <span className="font-mono text-primary">{workspace.branch}</span> into the current
          branch.
        </p>

        <div className="mb-3">
          <label className="mb-1 block text-[11px] text-secondary">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
            className="w-full rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-xs text-primary focus:border-accent focus:outline-none"
          >
            <option value="fastForward">Fast-forward</option>
            <option value="squash">Squash</option>
            <option value="cherryPick">Cherry-pick</option>
          </select>
        </div>

        {error && <div className="mb-2 text-[11px] text-red-400">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1 text-xs text-secondary hover:bg-surface-3"
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={loading}
            className="rounded-md bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? <SpinnerIcon className="h-3 w-3 animate-spin" /> : 'Merge'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// --- Discard Dialog ---

function DiscardDialog({
  repoPath,
  workspace,
  onClose,
}: {
  repoPath: string;
  workspace: AgentWorkspace;
  onClose: () => void;
}) {
  const { discardWorkspace } = useAgentWorkspaceStore();
  const [loading, setLoading] = useState(false);

  const handleDiscard = async () => {
    setLoading(true);
    try {
      await discardWorkspace(repoPath, workspace.id);
      onClose();
    } catch (err) {
      console.error('Failed to discard workspace:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfirmDialog
      title="Discard Workspace"
      message={
        <>
          Discard agent workspace <span className="font-mono text-xs">{workspace.id}</span>? This
          will remove the worktree and delete the branch. This cannot be undone.
        </>
      }
      confirmLabel={loading ? 'Discarding...' : 'Discard'}
      confirmClassName="bg-red-600 hover:bg-red-700"
      onConfirm={handleDiscard}
      onCancel={onClose}
    />
  );
}
