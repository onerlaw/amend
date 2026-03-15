export type LayoutNode =
  | { type: 'leaf'; id: string; terminalIds: string[]; activeTerminalId: string }
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      first: LayoutNode;
      second: LayoutNode;
      ratio: number;
    };

let _nextId = Date.now();
export function genNodeId(): string {
  return `pane-${++_nextId}`;
}

export function makeLeaf(terminalId: string): LayoutNode {
  return { type: 'leaf', id: genNodeId(), terminalIds: [terminalId], activeTerminalId: terminalId };
}

export function findNode(root: LayoutNode, nodeId: string): LayoutNode | null {
  if (root.id === nodeId) return root;
  if (root.type === 'split') {
    return findNode(root.first, nodeId) ?? findNode(root.second, nodeId);
  }
  return null;
}

export function replaceNode(root: LayoutNode, nodeId: string, replacement: LayoutNode): LayoutNode {
  if (root.id === nodeId) return replacement;
  if (root.type === 'split') {
    return {
      ...root,
      first: replaceNode(root.first, nodeId, replacement),
      second: replaceNode(root.second, nodeId, replacement),
    };
  }
  return root;
}

/** Remove a terminal from its leaf's terminalIds. If the leaf becomes empty, collapse it. */
export function removeLeaf(root: LayoutNode, terminalId: string): LayoutNode | null {
  if (root.type === 'leaf') {
    if (!root.terminalIds.includes(terminalId)) return root;
    const remaining = root.terminalIds.filter((id) => id !== terminalId);
    if (remaining.length === 0) return null;
    return {
      ...root,
      terminalIds: remaining,
      activeTerminalId:
        root.activeTerminalId === terminalId
          ? remaining[Math.min(root.terminalIds.indexOf(terminalId), remaining.length - 1)]
          : root.activeTerminalId,
    };
  }

  // Try first child
  const newFirst = removeLeaf(root.first, terminalId);
  if (newFirst !== root.first) {
    return newFirst === null ? root.second : { ...root, first: newFirst };
  }

  // Try second child
  const newSecond = removeLeaf(root.second, terminalId);
  if (newSecond !== root.second) {
    return newSecond === null ? root.first : { ...root, second: newSecond };
  }

  return root;
}

/** Returns ALL terminal IDs across all leaves (all terminalIds arrays flattened). */
export function collectTerminalIds(root: LayoutNode): string[] {
  if (root.type === 'leaf') return [...root.terminalIds];
  return [...collectTerminalIds(root.first), ...collectTerminalIds(root.second)];
}

/** Find the leaf that contains a given terminal ID (searches through terminalIds arrays). */
export function findLeafByTerminalId(root: LayoutNode, terminalId: string): LayoutNode | null {
  if (root.type === 'leaf') {
    return root.terminalIds.includes(terminalId) ? root : null;
  }
  return (
    findLeafByTerminalId(root.first, terminalId) ?? findLeafByTerminalId(root.second, terminalId)
  );
}

/** Get all leaf nodes in order (left-to-right / top-to-bottom). */
export function collectLeaves(root: LayoutNode): LayoutNode[] {
  if (root.type === 'leaf') return [root];
  return [...collectLeaves(root.first), ...collectLeaves(root.second)];
}

/** Find the parent split of a node by its ID. */
export function findParent(
  root: LayoutNode,
  nodeId: string
): (LayoutNode & { type: 'split' }) | null {
  if (root.type === 'split') {
    if (root.first.id === nodeId || root.second.id === nodeId) {
      return root;
    }
    return findParent(root.first, nodeId) ?? findParent(root.second, nodeId);
  }
  return null;
}

export type SerializedLayoutNode =
  | { type: 'leaf'; terminalIndices: number[]; activeTerminalIndex: number }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      first: SerializedLayoutNode;
      second: SerializedLayoutNode;
      ratio: number;
    };

export function serializeLayout(node: LayoutNode, terminalIds: string[]): SerializedLayoutNode {
  if (node.type === 'leaf') {
    return {
      type: 'leaf',
      terminalIndices: node.terminalIds.map((id) => terminalIds.indexOf(id)),
      activeTerminalIndex: terminalIds.indexOf(node.activeTerminalId),
    };
  }
  return {
    type: 'split',
    direction: node.direction,
    first: serializeLayout(node.first, terminalIds),
    second: serializeLayout(node.second, terminalIds),
    ratio: node.ratio,
  };
}

export function deserializeLayout(
  node: SerializedLayoutNode,
  terminalIds: string[]
): LayoutNode | null {
  if (node.type === 'leaf') {
    // Support both old format (terminalIndex) and new format (terminalIndices)
    let ids: string[];
    let activeId: string;
    if ('terminalIndices' in node) {
      ids = node.terminalIndices.map((i) => terminalIds[i]).filter(Boolean);
      activeId = terminalIds[node.activeTerminalIndex];
    } else {
      // Legacy: single terminalIndex
      const tid = terminalIds[(node as { terminalIndex: number }).terminalIndex];
      if (!tid) return null;
      ids = [tid];
      activeId = tid;
    }
    if (ids.length === 0) return null;
    if (!activeId || !ids.includes(activeId)) activeId = ids[0];
    const leaf = makeLeaf(ids[0]);
    if (leaf.type === 'leaf') {
      leaf.terminalIds = ids;
      leaf.activeTerminalId = activeId;
    }
    return leaf;
  }
  const first = deserializeLayout(node.first, terminalIds);
  const second = deserializeLayout(node.second, terminalIds);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  return {
    type: 'split',
    id: genNodeId(),
    direction: node.direction,
    first,
    second,
    ratio: node.ratio,
  };
}
