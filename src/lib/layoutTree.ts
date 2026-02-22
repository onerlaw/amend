export type LayoutNode =
  | { type: 'leaf'; id: string; terminalId: string }
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      first: LayoutNode;
      second: LayoutNode;
      ratio: number;
    };

let _nextId = 0;
export function genNodeId(): string {
  return `pane-${++_nextId}`;
}

export function makeLeaf(terminalId: string): LayoutNode {
  return { type: 'leaf', id: genNodeId(), terminalId };
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

/** Remove a leaf by terminal ID. Collapses parent split and promotes sibling. */
export function removeLeaf(root: LayoutNode, terminalId: string): LayoutNode | null {
  if (root.type === 'leaf') {
    return root.terminalId === terminalId ? null : root;
  }

  // Check if either child is the target leaf
  if (root.first.type === 'leaf' && root.first.terminalId === terminalId) {
    return root.second;
  }
  if (root.second.type === 'leaf' && root.second.terminalId === terminalId) {
    return root.first;
  }

  // Recurse into children
  const newFirst = removeLeaf(root.first, terminalId);
  if (newFirst !== root.first) {
    return newFirst === null ? root.second : { ...root, first: newFirst };
  }

  const newSecond = removeLeaf(root.second, terminalId);
  if (newSecond !== root.second) {
    return newSecond === null ? root.first : { ...root, second: newSecond };
  }

  return root;
}

export function collectTerminalIds(root: LayoutNode): string[] {
  if (root.type === 'leaf') return [root.terminalId];
  return [...collectTerminalIds(root.first), ...collectTerminalIds(root.second)];
}

export function findLeafByTerminalId(root: LayoutNode, terminalId: string): LayoutNode | null {
  if (root.type === 'leaf') {
    return root.terminalId === terminalId ? root : null;
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
  | { type: 'leaf'; terminalIndex: number }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      first: SerializedLayoutNode;
      second: SerializedLayoutNode;
      ratio: number;
    };

export function serializeLayout(node: LayoutNode, terminalIds: string[]): SerializedLayoutNode {
  if (node.type === 'leaf') {
    return { type: 'leaf', terminalIndex: terminalIds.indexOf(node.terminalId) };
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
    const tid = terminalIds[node.terminalIndex];
    if (!tid) return null;
    return makeLeaf(tid);
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
