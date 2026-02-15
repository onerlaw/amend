import { useState, useMemo, useCallback, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useFileBrowserState } from '@/hooks/useFileBrowserState';
import { readDirectories, FileEntry } from '@/lib/tauri';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { getFileIconColor, sortDirectoriesFirst } from '@/lib/fileUtils';
import { FolderIcon, FileIcon } from '@/components/Icons';
import { TreeRow, DirectoryIndicator, PanelHeader } from '@/components/FileTree/TreePrimitives';

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
  const fileTreeVersion = useFileStore((s) => s.fileTreeVersion);
  const [cacheVersion, setCacheVersion] = useState(0);

  // Re-fetch expanded directory contents when file tree version changes
  useEffect(() => {
    if (fileTreeVersion === 0) return;
    const refreshExpanded = async () => {
      const expandedPaths = Array.from(expandedDirs);
      if (expandedPaths.length === 0) {
        dirContentsCache.clear();
        setCacheVersion((v) => v + 1);
        return;
      }
      try {
        const results = await readDirectories(expandedPaths);
        const newCache = new Map<string, FileEntry[]>();
        for (let i = 0; i < expandedPaths.length; i++) {
          if (results[i]) {
            newCache.set(expandedPaths[i], results[i]);
          }
        }
        dirContentsCache.clear();
        for (const [k, v] of newCache) {
          dirContentsCache.set(k, v);
        }
      } catch {
        // Keep existing cache on error rather than clearing
      }
      setCacheVersion((v) => v + 1);
    };
    refreshExpanded();
  }, [fileTreeVersion, expandedDirs]);

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

        return (
          <TreeRow
            depth={depth}
            isSelected={isActive || isContextTarget}
            isSubtle={isOpen && !isActive && !isContextTarget}
            className={`pr-2 text-left ${entry.isGitignored ? 'opacity-50' : ''}`}
            onClick={() => (entry.isDirectory ? toggleDir(entry.path) : onSelectFile(entry.path))}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openMenu(entry, e.clientX, e.clientY);
            }}
          >
            {entry.isDirectory ? (
              <DirectoryIndicator isExpanded={isExpanded} />
            ) : (
              <>
                <span className="w-3" />
                <FileIcon className={`h-4 w-4 ${getFileIconColor(entry.name)}`} />
              </>
            )}
            <span className="truncate text-primary">{entry.name}</span>
          </TreeRow>
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
      <PanelHeader title="Files" onRefresh={handleRefresh} />
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
