import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { searchFiles, SearchResult } from '@/lib/tauri';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { getFileIconColor, openFileInBrowseMode } from '@/lib/fileUtils';

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchContent, setSearchContent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { currentDirectory } = useFileStore();
  const { setPanelMode } = useUIStore();

  const openSearch = useCallback((withContent: boolean) => {
    setSearchContent(withContent);
    setIsOpen(true);
    setQuery('');
    setResults([]);
    setSelectedIndex(0);
  }, []);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setSelectedIndex(0);
  }, []);

  const handleSelectResult = useCallback(
    async (result: SearchResult) => {
      try {
        await openFileInBrowseMode(result.path, result.name);
      } catch (err) {
        console.error('Failed to open file:', err);
      }
      setPanelMode('browse');
      closeSearch();
    },
    [setPanelMode, closeSearch]
  );

  // Keyboard shortcuts for opening search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+P: Open filename search
      if ((e.metaKey || e.ctrlKey) && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        openSearch(false);
      }
      // Cmd+Shift+F: Open content search
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        openSearch(true);
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

  // Debounced search
  useEffect(() => {
    if (!isOpen || !query.trim() || !currentDirectory) {
      setResults([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await searchFiles(currentDirectory, query.trim(), searchContent);
        setResults(searchResults);
        setSelectedIndex(0);
      } catch (err) {
        console.error('Search failed:', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [query, isOpen, currentDirectory, searchContent]);

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
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      handleSelectResult(results[selectedIndex]);
    }
  };

  const getFileColor = (name: string) => getFileIconColor(name);

  const getRelativePath = (fullPath: string) => {
    if (!currentDirectory) return fullPath;
    return fullPath.replace(currentDirectory + '/', '');
  };

  return (
    <>
      {/* Search Button */}
      <button
        onClick={() => openSearch(false)}
        className="flex items-center gap-2 rounded-lg bg-surface-1 px-4 py-1.5 text-sm text-secondary hover:bg-surface-3 w-72"
        title="Search Files (Cmd+P)"
      >
        <svg className="h-4 w-4 text-tertiary" viewBox="0 0 16 16" fill="currentColor">
          <path d="M15.25 13.371l-3.5-3.5c-.063-.063-.131-.11-.2-.152a5.5 5.5 0 1 0-.879.879c.042.069.09.137.152.2l3.5 3.5a.75.75 0 0 0 1.061-1.061l-.134.134zM6.5 10.5a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
        </svg>
        <span className="flex-1 text-left text-tertiary">Search...</span>
        <kbd className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-tertiary">
          {navigator.platform.includes('Mac') ? '⌘P' : 'Ctrl+P'}
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
            className="w-[500px] max-w-[90vw] rounded-xl bg-surface-2 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input */}
            <div className="flex items-center gap-2 px-3 py-3">
              <svg className="h-4 w-4 text-tertiary" viewBox="0 0 16 16" fill="currentColor">
                <path d="M15.25 13.371l-3.5-3.5c-.063-.063-.131-.11-.2-.152a5.5 5.5 0 1 0-.879.879c.042.069.09.137.152.2l3.5 3.5a.75.75 0 0 0 1.061-1.061l-.134.134zM6.5 10.5a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={searchContent ? 'Search in file contents...' : 'Search file names...'}
                className="flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-tertiary"
              />
              {isSearching && (
                <svg className="h-4 w-4 animate-spin text-tertiary" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              <button
                onClick={() => setSearchContent(!searchContent)}
                className={`rounded-md px-2 py-0.5 text-xs ${
                  searchContent
                    ? 'bg-accent text-white'
                    : 'text-tertiary hover:bg-surface-3 hover:text-primary'
                }`}
                title="Toggle content search (Cmd+Shift+F)"
              >
                Content
              </button>
            </div>

            {/* Results */}
            <div ref={resultsRef} className="max-h-[50vh] overflow-y-auto">
              {!currentDirectory && (
                <div className="px-3 py-8 text-center text-sm text-tertiary">
                  Open a repository first to search files
                </div>
              )}
              {currentDirectory && query && results.length === 0 && !isSearching && (
                <div className="px-3 py-8 text-center text-sm text-tertiary">No results found</div>
              )}
              {results.map((result, index) => (
                <button
                  key={`${result.path}-${result.lineNumber ?? 0}`}
                  onClick={() => handleSelectResult(result)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-3/50 ${
                    index === selectedIndex ? 'bg-surface-3' : ''
                  }`}
                >
                  <svg
                    className={`h-4 w-4 flex-shrink-0 ${getFileColor(result.name)}`}
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M13.85 4.44l-3.28-3.3-.35-.14H3.5l-.5.5v13l.5.5h10l.5-.5V4.8l-.15-.36zM10 1.94L12.06 4H10V1.94zM13 14H4V2h5v2.5l.5.5H13v9z" />
                  </svg>
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

            {/* Footer */}
            <div className="flex items-center justify-between px-3 py-2 text-[10px] text-tertiary">
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
              <div>{results.length > 0 && `${results.length} results`}</div>
            </div>
          </div>
        </div>,
          document.body
        )}
    </>
  );
}
