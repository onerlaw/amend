import { create } from 'zustand';
import {
  AgentWorkspace,
  MergeStrategy,
  listAgentWorktrees,
  createAgentWorktree,
  mergeAgentWorktree,
  discardAgentWorktree,
} from '@/lib/tauri';

interface AgentWorkspaceState {
  workspaces: AgentWorkspace[];
  activeWorkspaceId: string | null;
  loading: boolean;
  error: string | null;

  loadWorkspaces: (repoPath: string) => Promise<void>;
  createWorkspace: (repoPath: string) => Promise<AgentWorkspace>;
  mergeWorkspace: (repoPath: string, id: string, strategy: MergeStrategy) => Promise<void>;
  discardWorkspace: (repoPath: string, id: string) => Promise<void>;
  setActiveWorkspace: (id: string | null) => void;
  clearError: () => void;
}

export const useAgentWorkspaceStore = create<AgentWorkspaceState>((set) => ({
  workspaces: [],
  activeWorkspaceId: null,
  loading: false,
  error: null,

  loadWorkspaces: async (repoPath: string) => {
    set({ loading: true, error: null });
    try {
      const workspaces = await listAgentWorktrees(repoPath);
      set({ workspaces, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  createWorkspace: async (repoPath: string) => {
    set({ loading: true, error: null });
    try {
      const agentId = crypto.randomUUID().slice(0, 8);
      const workspace = await createAgentWorktree(repoPath, agentId);
      set((state) => ({
        workspaces: [...state.workspaces, workspace],
        activeWorkspaceId: workspace.id,
        loading: false,
      }));
      return workspace;
    } catch (err) {
      set({ error: String(err), loading: false });
      throw err;
    }
  },

  mergeWorkspace: async (repoPath: string, id: string, strategy: MergeStrategy) => {
    set({ loading: true, error: null });
    try {
      await mergeAgentWorktree(repoPath, id, strategy);
      // Refresh the list after merge
      const workspaces = await listAgentWorktrees(repoPath);
      set((state) => ({
        workspaces,
        activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
        loading: false,
      }));
    } catch (err) {
      set({ error: String(err), loading: false });
      throw err;
    }
  },

  discardWorkspace: async (repoPath: string, id: string) => {
    set({ loading: true, error: null });
    try {
      await discardAgentWorktree(repoPath, id);
      // Refresh the list after discard
      const workspaces = await listAgentWorktrees(repoPath);
      set((state) => ({
        workspaces,
        activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
        loading: false,
      }));
    } catch (err) {
      set({ error: String(err), loading: false });
      throw err;
    }
  },

  setActiveWorkspace: (id: string | null) => {
    set({ activeWorkspaceId: id });
  },

  clearError: () => {
    set({ error: null });
  },
}));
