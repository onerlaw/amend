import { useState, useRef, useEffect, useCallback } from 'react';
import { getSearchAddon } from '@/hooks/useTerminal';
import { SearchIcon, CloseIcon } from '@/components/Icons';

interface TerminalSearchBarProps {
  terminalId: string;
  onClose: () => void;
}

export function TerminalSearchBar({ terminalId, onClose }: TerminalSearchBarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const findNext = useCallback(() => {
    if (!query) return;
    const addon = getSearchAddon(terminalId);
    addon?.findNext(query);
  }, [terminalId, query]);

  const findPrevious = useCallback(() => {
    if (!query) return;
    const addon = getSearchAddon(terminalId);
    addon?.findPrevious(query);
  }, [terminalId, query]);

  // Search as user types
  useEffect(() => {
    if (!query) {
      getSearchAddon(terminalId)?.clearDecorations();
      return;
    }
    getSearchAddon(terminalId)?.findNext(query);
  }, [query, terminalId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          findPrevious();
        } else {
          findNext();
        }
      }
    },
    [onClose, findNext, findPrevious]
  );

  return (
    <div className="absolute top-1 right-3 z-10 flex items-center gap-1 rounded bg-surface-2 border border-surface-3 px-2 py-1 shadow-lg">
      <SearchIcon className="h-3.5 w-3.5 text-secondary shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className="bg-transparent text-xs text-primary outline-none placeholder:text-secondary/50 w-40"
      />
      <button
        onClick={findPrevious}
        className="rounded p-0.5 text-secondary hover:bg-surface-3 hover:text-primary"
        title="Previous match (Shift+Enter)"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4l-5 5h10L8 4z" />
        </svg>
      </button>
      <button
        onClick={findNext}
        className="rounded p-0.5 text-secondary hover:bg-surface-3 hover:text-primary"
        title="Next match (Enter)"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 12l5-5H3l5 5z" />
        </svg>
      </button>
      <button
        onClick={onClose}
        className="rounded p-0.5 text-secondary hover:bg-surface-3 hover:text-primary"
        title="Close (Escape)"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
