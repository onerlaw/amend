import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Virtuoso } from 'react-virtuoso';
import { useFileBrowserState } from '@/hooks/useFileBrowserState';
import { useFileBrowserDrag } from '@/hooks/useFileBrowserDrag';
import { readDirectories, renameEntry, FileEntry } from '@/lib/tauri';
import { dirname, join } from '@/lib/pathUtils';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { getFileIconColor, sortDirectoriesFirst, formatShortcut } from '@/lib/fileUtils';
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
  contextPath: string | null;
  activeFilePath: string | null;
  openFilePaths: Set<string>;
  onSelectFile: (path: string) => void;
  isLoading: boolean;
}

function BrowseFileList({
  entries,
  contextPath,
  activeFilePath,
  openFilePaths,
  onSelectFile,
  isLoading,
}: BrowseFileListProps) {
  const { openMenu, isOpen: contextMenuOpen, targetEntry } = useContextMenuStore();
  const contextTargetPath = targetEntry?.path ?? null;
  const expandedDirs = useUIStore((s) => s.browseExpandedDirs);
  const toggleBrowseExpandedDir = useUIStore((s) => s.toggleBrowseExpandedDir);
  const clearBrowseExpandedDirs = useUIStore((s) => s.clearBrowseExpandedDirs);
  const fileTreeVersion = useFileStore((s) => s.fileTreeVersion);
  const [cacheVersion, setCacheVersion] = useState(0);

  // Clear stale cache and expanded dirs when context changes
  useEffect(() => {
    dirContentsCache.clear();
    clearBrowseExpandedDirs();
    setCacheVersion((v) => v + 1);
  }, [contextPath, clearBrowseExpandedDirs]);

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const lastClickedPathRef = useRef<string | null>(null);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback((entry: FileEntry) => {
    setRenamingPath(entry.path);
    setRenamingName(entry.name);
    requestAnimationFrame(() => {
      if (renameInputRef.current) {
        renameInputRef.current.focus();
        const dotIndex = entry.isDirectory ? -1 : entry.name.lastIndexOf('.');
        if (dotIndex > 0) {
          renameInputRef.current.setSelectionRange(0, dotIndex);
        } else {
          renameInputRef.current.select();
        }
      }
    });
  }, []);

  const submitRename = useCallback(async () => {
    if (!renamingPath || !renamingName) {
      setRenamingPath(null);
      return;
    }
    const currentName = renamingPath.split('/').pop() ?? '';
    if (renamingName !== currentName) {
      const newPath = join(dirname(renamingPath), renamingName);
      try {
        await renameEntry(renamingPath, newPath);
        useFileStore.getState().invalidateFileTree();
      } catch (err) {
        console.error('Failed to rename:', err);
      }
    }
    setRenamingPath(null);
  }, [renamingPath, renamingName]);

  const cancelRename = useCallback(() => setRenamingPath(null), []);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRename();
      }
    },
    [submitRename, cancelRename]
  );

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

  const { getDragProps, wasDragRef, ghost } = useFileBrowserDrag({
    flatRows,
    expandedDirs,
    onExpand: toggleDir,
    selectedPaths,
    onClearSelection: () => setSelectedPaths(new Set()),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-tertiary">Loading...</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-tertiary text-sm">No files</div>
    );
  }

  return (
    <>
      <Virtuoso
        className="h-full"
        data={flatRows}
        overscan={200}
        itemContent={(_index, { entry, depth }) => {
          const isExpanded = expandedDirs.has(entry.path);
          const isOpen = openFilePaths.has(entry.path);
          const isActive = activeFilePath === entry.path;
          const isContextTarget = contextMenuOpen && contextTargetPath === entry.path;
          const { onMouseDown, isDragging: rowIsDragging, isDropTarget } = getDragProps(entry);

          if (renamingPath === entry.path) {
            return (
              <div
                className={`flex w-full select-none items-center gap-1 py-0.5 text-sm bg-surface-3 pr-2 ${entry.isGitignored ? 'opacity-50' : ''}`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                {entry.isDirectory ? (
                  <DirectoryIndicator isExpanded={expandedDirs.has(entry.path)} />
                ) : (
                  <>
                    <span className="w-3" />
                    <FileIcon className={`h-4 w-4 ${getFileIconColor(entry.name)}`} />
                  </>
                )}
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renamingName}
                  onChange={(e) => setRenamingName(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={submitRename}
                  className="flex-1 min-w-0 bg-surface-1 border border-accent rounded px-1 text-sm text-primary outline-none"
                />
              </div>
            );
          }

          return (
            <TreeRow
              depth={depth}
              isSelected={isActive || isContextTarget || selectedPaths.has(entry.path)}
              isSubtle={isOpen && !isActive && !isContextTarget}
              isDragging={rowIsDragging}
              isDropTarget={isDropTarget}
              dragPath={entry.path}
              className={`pr-2 text-left ${entry.isGitignored ? 'opacity-50' : ''}`}
              onMouseDown={onMouseDown}
              onClick={(e) => {
                if (wasDragRef.current) return;

                if (e.detail === 2) {
                  startRename(entry);
                  return;
                }

                if (e.shiftKey && lastClickedPathRef.current) {
                  const lastIdx = flatRows.findIndex(
                    (r) => r.entry.path === lastClickedPathRef.current
                  );
                  const currIdx = flatRows.findIndex((r) => r.entry.path === entry.path);
                  if (lastIdx !== -1) {
                    const [start, end] =
                      lastIdx <= currIdx ? [lastIdx, currIdx] : [currIdx, lastIdx];
                    const next = new Set(selectedPaths);
                    for (let i = start; i <= end; i++) next.add(flatRows[i].entry.path);
                    setSelectedPaths(next);
                  }
                  return;
                }

                if (e.metaKey || e.ctrlKey) {
                  const next = new Set(selectedPaths);
                  if (next.has(entry.path)) {
                    next.delete(entry.path);
                  } else {
                    next.add(entry.path);
                  }
                  setSelectedPaths(next);
                  lastClickedPathRef.current = entry.path;
                  return;
                }

                // Regular click
                if (entry.isDirectory) {
                  toggleDir(entry.path);
                  return;
                }
                setSelectedPaths(new Set([entry.path]));
                lastClickedPathRef.current = entry.path;
                onSelectFile(entry.path);
              }}
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
      {ghost &&
        createPortal(
          <div
            className="fixed z-50 pointer-events-none select-none"
            style={{ left: ghost.x + 12, top: ghost.y + 4 }}
          >
            <div className="flex items-center rounded-md bg-surface-2 border border-surface-3 px-2 py-1 text-xs text-primary shadow-lg opacity-90">
              <span className="truncate max-w-[200px]">
                {ghost.count > 1 ? `${ghost.count} items` : ghost.name}
              </span>
            </div>
          </div>,
          document.body
        )}
    </>
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
            Use{' '}
            <kbd className="px-1 py-0.5 rounded bg-surface-3 text-tertiary">
              {formatShortcut('Mod+O')}
            </kbd>{' '}
            to open a project
          </p>
        </div>
      ) : (
        <BrowseFileList
          entries={entries}
          contextPath={contextPath}
          activeFilePath={browseActiveFilePath}
          openFilePaths={openFilePaths}
          onSelectFile={handleSelectFile}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}
