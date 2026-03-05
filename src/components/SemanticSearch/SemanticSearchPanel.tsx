import { useState, useEffect, useCallback, useRef } from 'react';
import {
  semanticSearch,
  findCallers,
  findCallees,
  findImporters,
  SemanticSearchResult,
  CallRelation,
  ImportInfo,
} from '@/lib/tauri';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { openFileInBrowseMode } from '@/lib/fileUtils';
import { SpinnerIcon } from '@/components/Icons';
import { CallGraphView } from './CallGraphView';

interface SemanticSearchPanelProps {
  query: string;
  isOpen: boolean;
  onClose: () => void;
}

type DetailView =
  | { kind: 'callers'; symbol: string; data: CallRelation[] }
  | { kind: 'callees'; symbol: string; data: CallRelation[] }
  | { kind: 'importers'; symbol: string; data: ImportInfo[] }
  | { kind: 'callgraph'; symbol: string }
  | null;

export function SemanticSearchPanel({ query, isOpen, onClose }: SemanticSearchPanelProps) {
  const [results, setResults] = useState<SemanticSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailView, setDetailView] = useState<DetailView>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { contextPath: searchRoot } = useFileStore();
  const { setPanelMode } = useUIStore();

  const genRef = useRef(0);

  // Run semantic search with debounce
  useEffect(() => {
    if (!isOpen || !query.trim()) {
      setResults([]);
      setDetailView(null);
      return;
    }

    const gen = ++genRef.current;
    setIsSearching(true);

    const timeoutId = setTimeout(async () => {
      try {
        const res = await semanticSearch(query.trim(), 30);
        if (genRef.current === gen) {
          setResults(res);
          setSelectedIndex(0);
          setDetailView(null);
        }
      } catch (err) {
        console.error('Semantic search failed:', err);
        if (genRef.current === gen) {
          setResults([]);
        }
      } finally {
        if (genRef.current === gen) {
          setIsSearching(false);
        }
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [query, isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current && results.length > 0) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, results.length]);

  const handleNavigateToSymbol = useCallback(
    async (result: SemanticSearchResult) => {
      try {
        const fileName = result.symbol.filePath.split('/').pop() || result.symbol.filePath;
        await openFileInBrowseMode(result.symbol.filePath, fileName);
      } catch (err) {
        console.error('Failed to open file:', err);
      }
      setPanelMode('browse');
      onClose();
    },
    [setPanelMode, onClose]
  );

  const handleShowCallers = useCallback(async (symbolName: string) => {
    setDetailLoading(true);
    try {
      const callers = await findCallers(symbolName);
      setDetailView({ kind: 'callers', symbol: symbolName, data: callers });
    } catch (err) {
      console.error('Failed to find callers:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleShowCallees = useCallback(async (symbolName: string) => {
    setDetailLoading(true);
    try {
      const callees = await findCallees(symbolName);
      setDetailView({ kind: 'callees', symbol: symbolName, data: callees });
    } catch (err) {
      console.error('Failed to find callees:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleShowImporters = useCallback(async (symbolName: string) => {
    setDetailLoading(true);
    try {
      const importers = await findImporters(symbolName);
      setDetailView({ kind: 'importers', symbol: symbolName, data: importers });
    } catch (err) {
      console.error('Failed to find importers:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleShowCallGraph = useCallback((symbolName: string) => {
    setDetailView({ kind: 'callgraph', symbol: symbolName });
  }, []);

  const handleNavigateToFile = useCallback(
    async (filePath: string) => {
      try {
        const fileName = filePath.split('/').pop() || filePath;
        await openFileInBrowseMode(filePath, fileName);
      } catch (err) {
        console.error('Failed to open file:', err);
      }
      setPanelMode('browse');
      onClose();
    },
    [setPanelMode, onClose]
  );

  const getRelativePath = (fullPath: string) => {
    if (!searchRoot) return fullPath;
    return fullPath.replace(searchRoot + '/', '');
  };

  const getKindBadgeColor = (kind: string) => {
    switch (kind) {
      case 'function':
        return 'bg-purple-500/20 text-purple-400';
      case 'class':
        return 'bg-amber-500/20 text-amber-400';
      case 'interface':
        return 'bg-cyan-500/20 text-cyan-400';
      case 'type':
        return 'bg-blue-500/20 text-blue-400';
      case 'struct':
        return 'bg-orange-500/20 text-orange-400';
      case 'enum':
        return 'bg-green-500/20 text-green-400';
      case 'trait':
        return 'bg-pink-500/20 text-pink-400';
      case 'variable':
        return 'bg-slate-500/20 text-slate-400';
      default:
        return 'bg-surface-3 text-tertiary';
    }
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (detailView) return; // Don't navigate results when in detail view
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        handleNavigateToSymbol(results[selectedIndex]);
      }
    },
    [results, selectedIndex, handleNavigateToSymbol, detailView]
  );

  if (!isOpen) return null;

  // Render detail panel for callers/callees/importers
  if (detailView && detailView.kind !== 'callgraph') {
    const detailData = detailView;
    return (
      <div onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <button
            onClick={() => setDetailView(null)}
            className="text-xs text-accent hover:underline"
          >
            Back
          </button>
          <span className="text-xs text-secondary">
            {detailData.kind === 'callers'
              ? `Callers of ${detailData.symbol}`
              : detailData.kind === 'callees'
                ? `Callees of ${detailData.symbol}`
                : `Importers of ${detailData.symbol}`}
          </span>
          {detailLoading && <SpinnerIcon className="h-3 w-3 animate-spin text-tertiary" />}
        </div>
        <div className="max-h-[40vh] overflow-y-auto">
          {detailData.kind === 'callers' &&
            (detailData.data as CallRelation[]).map((rel, idx) => (
              <button
                key={`${rel.callerFile}-${rel.callerLine}-${idx}`}
                onClick={() => handleNavigateToFile(rel.callerFile)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-3/50"
              >
                <span className="text-sm text-primary font-mono">{rel.caller}</span>
                <span className="text-xs text-tertiary truncate">
                  {getRelativePath(rel.callerFile)}:{rel.callerLine}
                </span>
              </button>
            ))}
          {detailData.kind === 'callees' &&
            (detailData.data as CallRelation[]).map((rel, idx) => (
              <button
                key={`${rel.callee}-${idx}`}
                onClick={() => handleNavigateToFile(rel.callerFile)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-3/50"
              >
                <span className="text-sm text-primary font-mono">{rel.callee}</span>
                <span className="text-xs text-tertiary truncate">
                  called from {getRelativePath(rel.callerFile)}:{rel.callerLine}
                </span>
              </button>
            ))}
          {detailData.kind === 'importers' &&
            (detailData.data as ImportInfo[]).map((imp, idx) => (
              <button
                key={`${imp.filePath}-${imp.line}-${idx}`}
                onClick={() => handleNavigateToFile(imp.filePath)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-3/50"
              >
                <span className="text-xs text-tertiary truncate">
                  {getRelativePath(imp.filePath)}:{imp.line}
                </span>
                <span className="text-xs text-secondary">from "{imp.source}"</span>
              </button>
            ))}
          {((detailData.kind === 'callers' &&
            (detailData.data as CallRelation[]).length === 0) ||
            (detailData.kind === 'callees' &&
              (detailData.data as CallRelation[]).length === 0) ||
            (detailData.kind === 'importers' &&
              (detailData.data as ImportInfo[]).length === 0)) &&
            !detailLoading && (
              <div className="px-3 py-6 text-center text-sm text-tertiary">No results found</div>
            )}
        </div>
      </div>
    );
  }

  // Render call graph view
  if (detailView && detailView.kind === 'callgraph') {
    return (
      <div>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <button
            onClick={() => setDetailView(null)}
            className="text-xs text-accent hover:underline"
          >
            Back
          </button>
          <span className="text-xs text-secondary">Call graph: {detailView.symbol}</span>
        </div>
        <CallGraphView symbol={detailView.symbol} onNavigate={handleNavigateToFile} />
      </div>
    );
  }

  // Render search results
  return (
    <div onKeyDown={handleKeyDown}>
      <div ref={resultsRef} className="max-h-[40vh] overflow-y-auto">
        {!searchRoot && (
          <div className="px-3 py-6 text-center text-sm text-tertiary">
            Open a repository first to use semantic search
          </div>
        )}
        {searchRoot && query && results.length === 0 && !isSearching && (
          <div className="px-3 py-6 text-center text-sm text-tertiary">
            No symbols found
          </div>
        )}
        {results.map((result, index) => (
          <div
            key={`${result.symbol.filePath}-${result.symbol.line}-${result.symbol.name}`}
            className={`px-3 py-2 hover:bg-surface-3/50 ${
              index === selectedIndex ? 'bg-surface-3' : ''
            }`}
          >
            <button
              onClick={() => handleNavigateToSymbol(result)}
              className="flex w-full items-center gap-2 text-left"
            >
              <span
                className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${getKindBadgeColor(result.symbol.kind)}`}
              >
                {result.symbol.kind}
              </span>
              <span className="truncate text-sm text-primary font-mono">
                {result.symbol.name}
              </span>
              <span className="flex-shrink-0 text-xs text-tertiary truncate ml-auto">
                {getRelativePath(result.symbol.filePath)}:{result.symbol.line}
              </span>
            </button>
            {/* Relationship counts and action buttons */}
            <div className="flex items-center gap-2 mt-1 ml-0.5">
              {result.callerCount > 0 && (
                <button
                  onClick={() => handleShowCallers(result.symbol.name)}
                  className="text-[10px] text-tertiary hover:text-accent"
                  title="Show callers"
                >
                  {result.callerCount} caller{result.callerCount !== 1 ? 's' : ''}
                </button>
              )}
              {result.calleeCount > 0 && (
                <button
                  onClick={() => handleShowCallees(result.symbol.name)}
                  className="text-[10px] text-tertiary hover:text-accent"
                  title="Show callees"
                >
                  {result.calleeCount} callee{result.calleeCount !== 1 ? 's' : ''}
                </button>
              )}
              {result.importerCount > 0 && (
                <button
                  onClick={() => handleShowImporters(result.symbol.name)}
                  className="text-[10px] text-tertiary hover:text-accent"
                  title="Show importers"
                >
                  {result.importerCount} importer{result.importerCount !== 1 ? 's' : ''}
                </button>
              )}
              {(result.callerCount > 0 || result.calleeCount > 0) && (
                <button
                  onClick={() => handleShowCallGraph(result.symbol.name)}
                  className="text-[10px] text-tertiary hover:text-accent ml-auto"
                  title="Show call graph"
                >
                  call graph
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {isSearching && (
        <div className="flex items-center justify-center py-4">
          <SpinnerIcon className="h-4 w-4 animate-spin text-tertiary" />
        </div>
      )}
    </div>
  );
}
