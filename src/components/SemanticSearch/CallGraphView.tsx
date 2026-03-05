import { useState, useEffect, useRef, useCallback } from 'react';
import mermaid from 'mermaid';
import { getCallGraph, findCallers, CallGraphNode, CallRelation } from '@/lib/tauri';
import { SpinnerIcon } from '@/components/Icons';
import { useFileStore } from '@/stores/fileStore';

interface CallGraphViewProps {
  symbol: string;
  onNavigate: (filePath: string) => void;
}

// Initialize mermaid once
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  flowchart: {
    curve: 'basis',
    padding: 12,
    nodeSpacing: 30,
    rankSpacing: 40,
  },
  themeVariables: {
    primaryColor: '#3b82f6',
    primaryBorderColor: '#60a5fa',
    primaryTextColor: '#e2e8f0',
    lineColor: '#64748b',
    secondaryColor: '#1e293b',
    tertiaryColor: '#0f172a',
  },
});

type Direction = 'calls' | 'calledBy';

export function CallGraphView({ symbol, onNavigate }: CallGraphViewProps) {
  const [depth, setDepth] = useState(3);
  const [direction, setDirection] = useState<Direction>('calls');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<CallGraphNode | null>(null);
  const [callerData, setCallerData] = useState<CallRelation[]>([]);
  // Track all file paths from graph nodes for click handling
  const nodeFileMap = useRef<Map<string, string>>(new Map());

  const { contextPath: searchRoot } = useFileStore();

  const getRelativePath = useCallback(
    (fullPath: string) => {
      if (!searchRoot) return fullPath;
      return fullPath.replace(searchRoot + '/', '');
    },
    [searchRoot]
  );

  // Fetch data when symbol, depth, or direction changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        if (direction === 'calls') {
          const graph = await getCallGraph(symbol, depth);
          if (!cancelled) {
            setGraphData(graph);
            setCallerData([]);
          }
        } else {
          const callers = await findCallers(symbol);
          if (!cancelled) {
            setCallerData(callers);
            setGraphData(null);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [symbol, depth, direction]);

  // Render mermaid diagram
  useEffect(() => {
    if (loading || !containerRef.current) return;

    const renderDiagram = async () => {
      if (!containerRef.current) return;
      nodeFileMap.current.clear();

      let mermaidCode: string;

      if (direction === 'calls' && graphData) {
        mermaidCode = callGraphToMermaid(graphData, nodeFileMap.current, getRelativePath);
      } else if (direction === 'calledBy' && callerData.length > 0) {
        mermaidCode = callersToMermaid(symbol, callerData, nodeFileMap.current, getRelativePath);
      } else {
        containerRef.current.innerHTML =
          '<div class="text-center text-sm text-tertiary py-8">No call graph data available</div>';
        return;
      }

      try {
        // mermaid.render needs a unique ID each time
        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, mermaidCode);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;

          // Add click handlers to nodes
          const nodes = containerRef.current.querySelectorAll('.node');
          nodes.forEach((node) => {
            const textEl = node.querySelector('span.nodeLabel, tspan, text');
            if (textEl) {
              const nodeLabel = textEl.textContent?.trim() || '';
              // Extract the function name from the label (before any file info)
              const funcName = nodeLabel.split('\n')[0].trim();
              const filePath = nodeFileMap.current.get(funcName);
              if (filePath) {
                (node as HTMLElement).style.cursor = 'pointer';
                node.addEventListener('click', () => {
                  onNavigate(filePath);
                });
              }
            }
          });
        }
      } catch (err) {
        console.error('Mermaid render error:', err);
        if (containerRef.current) {
          containerRef.current.innerHTML =
            '<div class="text-center text-sm text-red-400 py-8">Failed to render call graph</div>';
        }
      }
    };

    renderDiagram();
  }, [loading, graphData, callerData, direction, symbol, onNavigate, getRelativePath]);

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-tertiary">Direction:</label>
          <button
            onClick={() => setDirection('calls')}
            className={`rounded px-2 py-0.5 text-[10px] ${
              direction === 'calls'
                ? 'bg-accent text-white'
                : 'bg-surface-3 text-secondary hover:text-primary'
            }`}
          >
            Calls
          </button>
          <button
            onClick={() => setDirection('calledBy')}
            className={`rounded px-2 py-0.5 text-[10px] ${
              direction === 'calledBy'
                ? 'bg-accent text-white'
                : 'bg-surface-3 text-secondary hover:text-primary'
            }`}
          >
            Called by
          </button>
        </div>
        {direction === 'calls' && (
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-tertiary">Depth:</label>
            <input
              type="range"
              min={1}
              max={5}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="h-1 w-20 accent-accent"
            />
            <span className="text-[10px] text-tertiary w-3">{depth}</span>
          </div>
        )}
        {loading && <SpinnerIcon className="h-3 w-3 animate-spin text-tertiary" />}
      </div>

      {/* Error */}
      {error && <div className="text-xs text-red-400 px-1">{error}</div>}

      {/* Mermaid container */}
      <div
        ref={containerRef}
        className="max-h-[35vh] overflow-auto rounded bg-surface-1 p-2"
      />
    </div>
  );
}

/** Convert a CallGraphNode tree into a mermaid flowchart */
function callGraphToMermaid(
  root: CallGraphNode,
  nodeFileMap: Map<string, string>,
  getRelativePath: (p: string) => string
): string {
  const lines: string[] = ['flowchart TD'];
  const edges = new Set<string>();
  let nodeId = 0;
  const nameToId = new Map<string, string>();

  function getNodeId(name: string): string {
    if (!nameToId.has(name)) {
      nameToId.set(name, `n${nodeId++}`);
    }
    return nameToId.get(name)!;
  }

  function walk(node: CallGraphNode, parentId?: string) {
    const id = getNodeId(node.name);
    const relPath = getRelativePath(node.filePath);
    const label = `${node.name}`;

    // Only declare node if not yet declared
    if (!nodeFileMap.has(node.name)) {
      lines.push(`  ${id}["${escapeLabel(label)}"]`);
      nodeFileMap.set(node.name, node.filePath);
    }

    // Add tooltip with file path
    lines.push(`  click ${id} "#" "${escapeLabel(relPath)}:${node.line}"`);

    if (parentId) {
      const edgeKey = `${parentId}-->${id}`;
      if (!edges.has(edgeKey)) {
        edges.add(edgeKey);
        lines.push(`  ${edgeKey}`);
      }
    }

    for (const child of node.calls) {
      walk(child, id);
    }
  }

  walk(root);

  // Style the root node
  const rootId = getNodeId(root.name);
  lines.push(`  style ${rootId} fill:#3b82f6,stroke:#60a5fa,color:#fff`);

  return lines.join('\n');
}

/** Convert caller relations into a mermaid flowchart (callers -> symbol) */
function callersToMermaid(
  symbol: string,
  callers: CallRelation[],
  nodeFileMap: Map<string, string>,
  getRelativePath: (p: string) => string
): string {
  const lines: string[] = ['flowchart TD'];
  const targetId = 'target';
  lines.push(`  ${targetId}["${escapeLabel(symbol)}"]`);
  lines.push(`  style ${targetId} fill:#3b82f6,stroke:#60a5fa,color:#fff`);

  const seen = new Set<string>();
  callers.forEach((rel, idx) => {
    const key = `${rel.caller}-${rel.callerFile}`;
    if (seen.has(key)) return;
    seen.add(key);

    const callerId = `c${idx}`;
    const relPath = getRelativePath(rel.callerFile);
    lines.push(`  ${callerId}["${escapeLabel(rel.caller)}"]`);
    lines.push(`  click ${callerId} "#" "${escapeLabel(relPath)}:${rel.callerLine}"`);
    lines.push(`  ${callerId} --> ${targetId}`);
    nodeFileMap.set(rel.caller, rel.callerFile);
  });

  nodeFileMap.set(symbol, '');
  return lines.join('\n');
}

/** Escape special characters for mermaid labels */
function escapeLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/[<>{}|]/g, '');
}
