import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { searchFiles, SearchResult } from '@/lib/tauri';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { getFileIconColor, openFileInBrowseMode } from '@/lib/fileUtils';
import { modifierKey, formatShortcut } from '@/lib/fileUtils';
import { SearchIcon, FileIcon, SpinnerIcon } from '@/components/Icons';
import { SemanticSearchPanel } from '@/components/SemanticSearch/SemanticSearchPanel';

type SearchMode = 'files' | 'semantic';

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filenameResults, setFilenameResults] = useState<SearchResult[]>([]);
  const [contentResults, setContentResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchMode, setSearchMode] = useState<SearchMode>('files');
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const results = [...filenameResults, ...contentResults];

  const { contextPath: searchRoot } = useFileStore();
  const { setPanelMode } = useUIStore();

  const resetSearch = useCallback((open: boolean) => {
    setIsOpen(open);
    setQuery('');
    setFilenameResults([]);
    setContentResults([]);
    setSelectedIndex(0);
  }, []);

  const openSearch = useCallback(() => resetSearch(true), [resetSearch]);
  const closeSearch = useCallback(() => resetSearch(false), [resetSearch]);

  const handleSelectResult = useCallback(
    async (result: SearchResult) => {
      try {
        await openFileInBrowseMode(result.path, result.name);
      } catch (err) {
        console.error('Failed to open file:', err);
      }
      setPanelMode('browse');
      inputRef.current?.blur();
      closeSearch();
    },
    [setPanelMode, closeSearch]
  );

  // Keyboard shortcuts for opening search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+P or Cmd+Shift+F: Open search
      if (
        ((e.metaKey || e.ctrlKey) && e.key === 'p' && !e.shiftKey) ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f')
      ) {
        e.preventDefault();
        openSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openSearch]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Two-phase search with stale-result handling.
  // Phase 1: Filename-only search fires quickly (50ms debounce).
  // Phase 2: Content search fires after a longer debounce (400ms).
  // The backend uses a generation counter so that when a new search_files call
  // is issued, any in-flight search aborts early with "Search cancelled". We
  // track local generation IDs so we never apply results from a stale request.
  const filenameGenRef = useRef(0);
  const contentGenRef = useRef(0);

  // Phase 1: fast filename search (only when in files mode)
  useEffect(() => {
    if (!isOpen || !query.trim() || !searchRoot || searchMode !== 'files') {
      setFilenameResults([]);
      return;
    }

    const gen = ++filenameGenRef.current;

    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchFiles(searchRoot, query.trim(), false);
        if (filenameGenRef.current === gen) {
          setFilenameResults(results);
          setSelectedIndex(0);
        }
      } catch (err) {
        const msg = String(err);
        if (!msg.includes('Search cancelled')) {
          console.error('Filename search failed:', err);
        }
        if (filenameGenRef.current === gen) {
          setFilenameResults([]);
        }
      }
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [query, isOpen, searchRoot, searchMode]);

  // Phase 2: slower content search (only when in files mode)
  useEffect(() => {
    if (!isOpen || !query.trim() || !searchRoot || searchMode !== 'files') {
      setContentResults([]);
      setIsSearching(false);
      return;
    }

    const gen = ++contentGenRef.current;
    setIsSearching(true);

    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchFiles(searchRoot, query.trim(), true);
        if (contentGenRef.current === gen) {
          // Content search returns both filename and content matches;
          // filter to content-only since filename results come from phase 1.
          setContentResults(results.filter((r) => r.matchType === 'content'));
          setSelectedIndex(0);
        }
      } catch (err) {
        const msg = String(err);
        if (!msg.includes('Search cancelled')) {
          console.error('Content search failed:', err);
        }
        if (contentGenRef.current === gen) {
          setContentResults([]);
        }
      } finally {
        if (contentGenRef.current === gen) {
          setIsSearching(false);
        }
      }
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [query, isOpen, searchRoot, searchMode]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current && results.length > 0) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, results.length]);

  // Handle keyboard navigation in dropdown
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    } else if (e.key === 'Tab') {
      // Tab to switch between search modes
      e.preventDefault();
      setSearchMode((mode) => (mode === 'files' ? 'semantic' : 'files'));
    } else if (searchMode === 'files') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        handleSelectResult(results[selectedIndex]);
      }
    }
  };

  const getRelativePath = (fullPath: string) => {
    if (!searchRoot) return fullPath;
    return fullPath.replace(searchRoot + '/', '');
  };

  return (
    <>
      {/* Search Button */}
      <button
        onClick={() => openSearch()}
        className="flex items-center gap-2 rounded-lg bg-surface-1 px-4 py-1.5 text-sm text-secondary hover:bg-surface-3 w-72"
        title={`Search (${formatShortcut('Mod+P')})`}
      >
        <SearchIcon className="h-4 w-4 text-tertiary" />
        <span className="flex-1 text-left text-tertiary">Search...</span>
        <kbd className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-tertiary">
          {modifierKey}+P
        </kbd>
      </button>

      {/* Search Modal - rendered via portal to escape stacking context */}
      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50"
            onClick={closeSearch}
          >
            <div
              className="w-[560px] max-w-[90vw] rounded-xl bg-surface-2 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Mode Tabs */}
              <div className="flex items-center border-b border-border">
                <button
                  onClick={() => setSearchMode('files')}
                  className={`px-4 py-2 text-xs font-medium transition-colors ${
                    searchMode === 'files'
                      ? 'text-accent border-b-2 border-accent'
                      : 'text-tertiary hover:text-secondary'
                  }`}
                >
                  Files
                </button>
                <button
                  onClick={() => setSearchMode('semantic')}
                  className={`px-4 py-2 text-xs font-medium transition-colors ${
                    searchMode === 'semantic'
                      ? 'text-accent border-b-2 border-accent'
                      : 'text-tertiary hover:text-secondary'
                  }`}
                >
                  Semantic
                </button>
                <span className="ml-auto mr-3 text-[10px] text-tertiary">
                  <kbd className="rounded-md bg-surface-1 px-1 py-0.5">Tab</kbd> switch
                </span>
              </div>

              {/* Input */}
              <div className="flex items-center gap-2 px-3 py-3">
                <SearchIcon className="h-4 w-4 text-tertiary" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={
                    searchMode === 'files' ? 'Search files...' : 'Search symbols...'
                  }
                  className="flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-tertiary"
                />
                {isSearching && searchMode === 'files' && (
                  <SpinnerIcon className="h-4 w-4 animate-spin text-tertiary" />
                )}
              </div>

              {/* File Search Results */}
              {searchMode === 'files' && (
                <>
                  <div ref={resultsRef} className="max-h-[50vh] overflow-y-auto">
                    {!searchRoot && (
                      <div className="px-3 py-8 text-center text-sm text-tertiary">
                        Open a repository first to search files
                      </div>
                    )}
                    {searchRoot && query && results.length === 0 && !isSearching && (
                      <div className="px-3 py-8 text-center text-sm text-tertiary">
                        No results found
                      </div>
                    )}
                    {results.map((result, index) => (
                      <button
                        key={`${result.path}-${result.lineNumber ?? 0}`}
                        onClick={() => handleSelectResult(result)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-3/50 ${
                          index === selectedIndex ? 'bg-surface-3' : ''
                        }`}
                      >
                        <FileIcon
                          className={`h-4 w-4 flex-shrink-0 ${getFileIconColor(result.name)}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-primary">{result.name}</span>
                            {result.matchType === 'content' && result.lineNumber && (
                              <span className="flex-shrink-0 text-xs text-tertiary">
                                :{result.lineNumber}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-tertiary">
                            {result.matchType === 'content' && result.lineContent ? (
                              <span className="font-mono">{result.lineContent}</span>
                            ) : (
                              getRelativePath(result.path)
                            )}
                          </div>
                        </div>
                        <span className="flex-shrink-0 rounded-md bg-surface-1 px-1.5 py-0.5 text-[10px] text-tertiary">
                          {result.matchType === 'filename' ? 'name' : 'content'}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Semantic Search Results */}
              {searchMode === 'semantic' && (
                <SemanticSearchPanel query={query} isOpen={isOpen} onClose={closeSearch} />
              )}

              {/* Footer */}
              <div className="flex items-center justify-between px-3 py-2 text-[10px] text-tertiary border-t border-border">
                <div className="flex items-center gap-3">
                  <span>
                    <kbd className="rounded-md bg-surface-1 px-1 py-0.5">↑↓</kbd> navigate
                  </span>
                  <span>
                    <kbd className="rounded-md bg-surface-1 px-1 py-0.5">↵</kbd> open
                  </span>
                  <span>
                    <kbd className="rounded-md bg-surface-1 px-1 py-0.5">esc</kbd> close
                  </span>
                </div>
                <div>
                  {searchMode === 'files' && results.length > 0 && `${results.length} results`}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
