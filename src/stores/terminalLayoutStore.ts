import { create } from 'zustand';
import {
  LayoutNode,
  makeLeaf,
  findNode,
  removeLeaf,
  replaceNode,
  collectLeaves,
  collectTerminalIds,
  findLeafByTerminalId,
  genNodeId,
} from '@/lib/layoutTree';
import { useTerminalStore } from '@/stores/terminalStore';

interface TerminalLayoutState {
  layout: LayoutNode | null;
  focusedPaneId: string | null;
  searchingPaneId: string | null;

  initLayout: (terminalId: string) => void;
  setLayout: (layout: LayoutNode | null) => void;
  splitPane: (
    leafId: string,
    direction: 'horizontal' | 'vertical',
    side: 'first' | 'second',
    newTerminalId: string
  ) => string | null;
  removeFromLayout: (terminalId: string) => void;
  assignTerminalToPane: (leafId: string, terminalId: string) => void;
  setFocusedPane: (leafId: string) => void;
  ensureTerminalInLayout: (terminalId: string) => void;
  setActiveTerminalInPane: (leafId: string, terminalId: string) => void;
  moveTerminalToPane: (terminalId: string, targetLeafId: string) => void;
  moveTerminalToSplit: (
    terminalId: string,
    targetLeafId: string,
    direction: 'horizontal' | 'vertical',
    side: 'first' | 'second'
  ) => void;
  splitAtRoot: (
    direction: 'horizontal' | 'vertical',
    side: 'first' | 'second',
    terminalId: string
  ) => void;
  setSearchingPaneId: (id: string | null) => void;
}

export const useTerminalLayoutStore = create<TerminalLayoutState>((set, get) => ({
  layout: null,
  focusedPaneId: null,
  searchingPaneId: null,

  initLayout: (terminalId: string) => {
    const leaf = makeLeaf(terminalId);
    set({ layout: leaf, focusedPaneId: leaf.id });
  },

  setLayout: (layout: LayoutNode | null) => {
    set({ layout });
    if (!layout) {
      set({ focusedPaneId: null });
    }
  },

  splitPane: (leafId, direction, side, newTerminalId) => {
    const { layout } = get();
    if (!layout) return null;

    const target = findNode(layout, leafId);
    if (!target || target.type !== 'leaf') return null;

    const newLeaf = makeLeaf(newTerminalId);
    const splitNode: LayoutNode = {
      type: 'split',
      id: genNodeId(),
      direction,
      first: side === 'first' ? newLeaf : target,
      second: side === 'second' ? newLeaf : target,
      ratio: 50,
    };

    const newLayout = replaceNode(layout, leafId, splitNode);
    set({ layout: newLayout, focusedPaneId: newLeaf.id });

    // Sync active tab
    useTerminalStore.getState().setActiveTab(newTerminalId);

    return newLeaf.id;
  },

  removeFromLayout: (terminalId: string) => {
    const { layout, focusedPaneId } = get();
    if (!layout) return;

    const leaf = findLeafByTerminalId(layout, terminalId);
    const newLayout = removeLeaf(layout, terminalId);

    if (!newLayout) {
      set({ layout: null, focusedPaneId: null });
      return;
    }

    let newFocusedPaneId = focusedPaneId;

    // If the leaf was completely removed (collapsed), move focus
    if (leaf && focusedPaneId === leaf.id) {
      // Check if the leaf still exists in the new layout (terminal removed but leaf has others)
      const stillExists = findNode(newLayout, leaf.id);
      if (stillExists && stillExists.type === 'leaf') {
        // Leaf still exists, sync active tab to its activeTerminalId
        useTerminalStore.getState().setActiveTab(stillExists.activeTerminalId);
      } else {
        // Leaf was collapsed, move focus to first available leaf
        const leaves = collectLeaves(newLayout);
        if (leaves.length > 0) {
          newFocusedPaneId = leaves[0].id;
          if (leaves[0].type === 'leaf') {
            useTerminalStore.getState().setActiveTab(leaves[0].activeTerminalId);
          }
        } else {
          newFocusedPaneId = null;
        }
      }
    }

    set({ layout: newLayout, focusedPaneId: newFocusedPaneId });
  },

  assignTerminalToPane: (leafId: string, terminalId: string) => {
    let { layout } = get();
    if (!layout) return;

    // If terminal is already in another leaf, remove it first
    const existingLeaf = findLeafByTerminalId(layout, terminalId);
    if (existingLeaf) {
      if (existingLeaf.id === leafId) {
        // Already in this pane, just set as active
        if (existingLeaf.type === 'leaf' && existingLeaf.activeTerminalId !== terminalId) {
          const updated: LayoutNode = { ...existingLeaf, activeTerminalId: terminalId };
          layout = replaceNode(layout, leafId, updated);
          set({ layout, focusedPaneId: leafId });
          useTerminalStore.getState().setActiveTab(terminalId);
        } else {
          set({ focusedPaneId: leafId });
          useTerminalStore.getState().setActiveTab(terminalId);
        }
        return;
      }
      // Remove from source leaf
      const afterRemove = removeLeaf(layout, terminalId);
      if (!afterRemove) {
        // Layout collapsed entirely — reinit with this terminal
        const leaf = makeLeaf(terminalId);
        set({ layout: leaf, focusedPaneId: leaf.id });
        useTerminalStore.getState().setActiveTab(terminalId);
        return;
      }
      layout = afterRemove;
    }

    const target = findNode(layout, leafId);
    if (!target || target.type !== 'leaf') return;

    const newLeaf: LayoutNode = {
      type: 'leaf',
      id: leafId,
      terminalIds: [...target.terminalIds, terminalId],
      activeTerminalId: terminalId,
    };
    const newLayout = replaceNode(layout, leafId, newLeaf);
    set({ layout: newLayout, focusedPaneId: leafId });
    useTerminalStore.getState().setActiveTab(terminalId);
  },

  setFocusedPane: (leafId: string) => {
    const { layout } = get();
    if (!layout) return;

    const target = findNode(layout, leafId);
    if (!target || target.type !== 'leaf') return;

    set({ focusedPaneId: leafId });
    useTerminalStore.getState().setActiveTab(target.activeTerminalId);
  },

  setActiveTerminalInPane: (leafId: string, terminalId: string) => {
    const { layout } = get();
    if (!layout) return;

    const target = findNode(layout, leafId);
    if (!target || target.type !== 'leaf') return;
    if (!target.terminalIds.includes(terminalId)) return;

    const updated: LayoutNode = { ...target, activeTerminalId: terminalId };
    const newLayout = replaceNode(layout, leafId, updated);
    set({ layout: newLayout, focusedPaneId: leafId });
    useTerminalStore.getState().setActiveTab(terminalId);
  },

  moveTerminalToPane: (terminalId: string, targetLeafId: string) => {
    const { assignTerminalToPane } = get();
    assignTerminalToPane(targetLeafId, terminalId);
  },

  moveTerminalToSplit: (terminalId, targetLeafId, direction, side) => {
    let { layout } = get();
    if (!layout) return;

    const sourceLeaf = findLeafByTerminalId(layout, terminalId);

    // Guard: self-split of a single-terminal pane is a no-op
    if (
      sourceLeaf &&
      sourceLeaf.id === targetLeafId &&
      sourceLeaf.type === 'leaf' &&
      sourceLeaf.terminalIds.length === 1
    ) {
      return;
    }

    // Remove terminal from its current position (if any)
    if (sourceLeaf) {
      const afterRemove = removeLeaf(layout, terminalId);
      if (!afterRemove) {
        // Layout collapsed entirely — just create a single leaf
        const leaf = makeLeaf(terminalId);
        set({ layout: leaf, focusedPaneId: leaf.id });
        useTerminalStore.getState().setActiveTab(terminalId);
        return;
      }
      layout = afterRemove;
    }

    // Try to find target leaf in the (possibly restructured) layout
    const target = findNode(layout, targetLeafId);
    if (target && target.type === 'leaf') {
      // Target still exists — split it normally
      const newLeaf = makeLeaf(terminalId);
      const splitNode: LayoutNode = {
        type: 'split',
        id: genNodeId(),
        direction,
        first: side === 'first' ? newLeaf : target,
        second: side === 'second' ? newLeaf : target,
        ratio: 50,
      };
      const newLayout = replaceNode(layout, targetLeafId, splitNode);
      set({ layout: newLayout, focusedPaneId: newLeaf.id });
      useTerminalStore.getState().setActiveTab(terminalId);
    } else {
      // Target was lost (collapsed when source was removed) — wrap at root
      const newLeaf = makeLeaf(terminalId);
      const newLayout: LayoutNode = {
        type: 'split',
        id: genNodeId(),
        direction,
        first: side === 'first' ? newLeaf : layout,
        second: side === 'second' ? newLeaf : layout,
        ratio: 50,
      };
      set({ layout: newLayout, focusedPaneId: newLeaf.id });
      useTerminalStore.getState().setActiveTab(terminalId);
    }
  },

  splitAtRoot: (direction, side, terminalId) => {
    let { layout } = get();
    if (!layout) return;

    // Remove terminal from current position if in layout
    const sourceLeaf = findLeafByTerminalId(layout, terminalId);
    if (sourceLeaf) {
      const afterRemove = removeLeaf(layout, terminalId);
      if (!afterRemove) {
        // Layout collapsed — just create a single leaf
        const leaf = makeLeaf(terminalId);
        set({ layout: leaf, focusedPaneId: leaf.id });
        useTerminalStore.getState().setActiveTab(terminalId);
        return;
      }
      layout = afterRemove;
    }

    // Wrap the entire remaining layout in a new root-level split
    const newLeaf = makeLeaf(terminalId);
    const newLayout: LayoutNode = {
      type: 'split',
      id: genNodeId(),
      direction,
      first: side === 'first' ? newLeaf : layout,
      second: side === 'second' ? newLeaf : layout,
      ratio: 50,
    };
    set({ layout: newLayout, focusedPaneId: newLeaf.id });
    useTerminalStore.getState().setActiveTab(terminalId);
  },

  setSearchingPaneId: (id: string | null) => set({ searchingPaneId: id }),

  ensureTerminalInLayout: (terminalId: string) => {
    const { layout } = get();
    if (!layout) {
      get().initLayout(terminalId);
      return;
    }
    // Terminal already in layout, nothing to do
    const existing = findLeafByTerminalId(layout, terminalId);
    if (existing) return;

    // Not in layout — assign to focused pane
    const { focusedPaneId } = get();
    if (focusedPaneId) {
      get().assignTerminalToPane(focusedPaneId, terminalId);
    }
  },
}));

// Helper: get visible terminal IDs from the layout
export function getVisibleTerminalIds(): string[] {
  const layout = useTerminalLayoutStore.getState().layout;
  if (!layout) return [];
  return collectTerminalIds(layout);
}
