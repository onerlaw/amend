import { useState, useMemo } from 'react';
import { useFileBrowserState } from '@/hooks/useFileBrowserState';
import { readDirectory, FileEntry } from '@/lib/tauri';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { getFileIconColor, sortDirectoriesFirst, toggleSetItem } from '@/lib/fileUtils';
import { ChevronIcon, FolderIcon, FileIcon, RefreshIcon } from '@/components/Icons';

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
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Map<string, FileEntry[]>>(new Map());

  const toggleDir = async (path: string) => {
    if (!expandedDirs.has(path) && !dirContents.has(path)) {
      try {
        const contents = await readDirectory(path);
        setDirContents(new Map(dirContents).set(path, contents));
      } catch (err) {
        console.error('Failed to read directory:', err);
      }
    }
    setExpandedDirs(toggleSetItem(expandedDirs, path));
  };

  const renderEntry = (entry: FileEntry, depth: number) => {
    const isExpanded = expandedDirs.has(entry.path);
    const children = dirContents.get(entry.path) || [];

    const getFileIcon = () => {
      if (entry.isDirectory) {
        return <FolderIcon className="h-4 w-4 text-yellow-500" />;
      }

      const color = getFileIconColor(entry.name);
      return <FileIcon className={`h-4 w-4 ${color}`} />;
    };

    const isOpen = openFilePaths.has(entry.path);
    const isActive = activeFilePath === entry.path;
    const isContextTarget = contextMenuOpen && contextTargetPath === entry.path;

    return (
      <div key={entry.path}>
        <button
          onClick={() => (entry.isDirectory ? toggleDir(entry.path) : onSelectFile(entry.path))}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openMenu(entry, e.clientX, e.clientY);
          }}
          className={`flex w-full select-none items-center gap-1 py-0.5 pr-2 text-left text-sm hover:bg-surface-3/50 ${
            isActive || isContextTarget ? 'bg-surface-3' : isOpen ? 'bg-surface-3/30' : ''
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {entry.isDirectory && (
            <ChevronIcon
              className={`h-3 w-3 text-tertiary transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
          )}
          {!entry.isDirectory && <span className="w-3" />}
          {getFileIcon()}
          <span className="truncate text-primary">{entry.name}</span>
        </button>

        {entry.isDirectory && isExpanded && (
          <div>{sortDirectoriesFirst(children).map((child) => renderEntry(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-tertiary">Loading...</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-tertiary text-sm">No files</div>
    );
  }

  const sortedEntries = sortDirectoriesFirst(entries);

  return (
    <div className="h-full overflow-y-auto py-1">
      {sortedEntries.map((entry) => renderEntry(entry, 0))}
    </div>
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

  const openFilePaths = useMemo(
    () => new Set(browseOpenFiles.map((f) => f.path)),
    [browseOpenFiles]
  );

  return (
    <div className="h-full bg-surface-2 flex flex-col">
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
            Use <kbd className="px-1 py-0.5 rounded bg-surface-3 text-tertiary">⌘O</kbd> to open a project
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
