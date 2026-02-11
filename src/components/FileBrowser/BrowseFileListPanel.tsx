import { useState, useMemo, useCallback, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useFileBrowserState } from '@/hooks/useFileBrowserState';
import { readDirectories, FileEntry } from '@/lib/tauri';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useUIStore } from '@/stores/uiStore';
import { getFileIconColor, sortDirectoriesFirst } from '@/lib/fileUtils';
import { ChevronIcon, FolderIcon, FileIcon, RefreshIcon } from '@/components/Icons';

const dirContentsCache = new Map<string, FileEntry[]>();

interface FlatRow {
  entry: FileEntry;
  depth: number;
}

function flattenTree(entries: FileEntry[], expandedDirs: Set<string>, depth: number): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const entry of sortDirectoriesFirst(entries)) {
    rows.push({ entry, depth });
    if (entry.isDirectory && expandedDirs.has(entry.path)) {
      const children = dirContentsCache.get(entry.path) || [];
      rows.push(...flattenTree(children, expandedDirs, depth + 1));
    }
  }
  return rows;
}

interface BrowseFileListProps {
  entries: FileEntry[];
  activeFilePath: string | null;
  openFilePaths: Set<string>;
  onSelectFile: (path: string) => void;
  isLoading: boolean;
}

function BrowseFileList({
  entries,
  activeFilePath,
  openFilePaths,
  onSelectFile,
  isLoading,
}: BrowseFileListProps) {
  const { openMenu, isOpen: contextMenuOpen, targetEntry } = useContextMenuStore();
  const contextTargetPath = targetEntry?.path ?? null;
  const expandedDirs = useUIStore((s) => s.browseExpandedDirs);
  const toggleBrowseExpandedDir = useUIStore((s) => s.toggleBrowseExpandedDir);
  const [cacheVersion, setCacheVersion] = useState(0);

  // Re-fetch expanded directory contents when file tree refreshes
  useEffect(() => {
    const handleRefresh = async () => {
      dirContentsCache.clear();
      const expandedPaths = Array.from(expandedDirs);
      if (expandedPaths.length === 0) return;
      try {
        const results = await readDirectories(expandedPaths);
        for (let i = 0; i < expandedPaths.length; i++) {
          if (results[i]) {
            dirContentsCache.set(expandedPaths[i], results[i]);
          }
        }
      } catch {
        // Fallback silently on error
      }
      setCacheVersion((v) => v + 1);
    };

    window.addEventListener('file-tree-refresh', handleRefresh);
    return () => window.removeEventListener('file-tree-refresh', handleRefresh);
  }, [expandedDirs]);

  const toggleDir = useCallback(
    async (path: string) => {
      if (!expandedDirs.has(path)) {
        try {
          const results = await readDirectories([path]);
          dirContentsCache.set(path, results[0]);
          setCacheVersion((v) => v + 1);
        } catch (err) {
          console.error('Failed to read directory:', err);
        }
      }
      toggleBrowseExpandedDir(path);
    },
    [expandedDirs, toggleBrowseExpandedDir]
  );

  const flatRows = useMemo(
    () => flattenTree(entries, expandedDirs, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, expandedDirs, cacheVersion]
  );

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-tertiary">Loading...</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-tertiary text-sm">No files</div>
    );
  }

  return (
    <Virtuoso
      className="h-full"
      data={flatRows}
      overscan={200}
      itemContent={(_index, { entry, depth }) => {
        const isExpanded = expandedDirs.has(entry.path);
        const isOpen = openFilePaths.has(entry.path);
        const isActive = activeFilePath === entry.path;
        const isContextTarget = contextMenuOpen && contextTargetPath === entry.path;

        const iconEl = entry.isDirectory ? (
          <FolderIcon className="h-4 w-4 text-yellow-500" />
        ) : (
          <FileIcon className={`h-4 w-4 ${getFileIconColor(entry.name)}`} />
        );

        return (
          <button
            onClick={() => (entry.isDirectory ? toggleDir(entry.path) : onSelectFile(entry.path))}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openMenu(entry, e.clientX, e.clientY);
            }}
            className={`flex w-full select-none items-center gap-1 py-0.5 pr-2 text-left text-sm hover:bg-surface-3/50 ${
              isActive || isContextTarget ? 'bg-surface-3' : isOpen ? 'bg-surface-3/30' : ''
            } ${entry.isGitignored ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {entry.isDirectory && (
              <ChevronIcon
                className={`h-3 w-3 text-tertiary transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            )}
            {!entry.isDirectory && <span className="w-3" />}
            {iconEl}
            <span className="truncate text-primary">{entry.name}</span>
          </button>
        );
      }}
    />
  );
}

export function BrowseFileListPanel() {
  const {
    contextPath,
    entries,
    isLoading,
    browseActiveFilePath,
    browseOpenFiles,
    handleSelectFile,
    handleRefresh,
  } = useFileBrowserState();
  const setFocusedPanel = useUIStore((s) => s.setFocusedPanel);

  const openFilePaths = useMemo(
    () => new Set(browseOpenFiles.map((f) => f.path)),
    [browseOpenFiles]
  );

  return (
    <div
      className="h-full bg-surface-2 flex flex-col"
      onMouseDown={() => setFocusedPanel('file-list')}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">Files</span>
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-md p-1 text-secondary hover:bg-surface-3"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
      </div>
      {!contextPath ? (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <FolderIcon className="h-12 w-12 text-tertiary mb-4" />
          <h3 className="text-sm font-medium text-primary mb-1">No Repository Open</h3>
          <p className="text-xs text-tertiary">
            Use <kbd className="px-1 py-0.5 rounded bg-surface-3 text-tertiary">⌘O</kbd> to open a
            project
          </p>
        </div>
      ) : (
        <BrowseFileList
          entries={entries}
          activeFilePath={browseActiveFilePath}
          openFilePaths={openFilePaths}
          onSelectFile={handleSelectFile}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}
