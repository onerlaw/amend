import { useState } from 'react';
import { useFileBrowserState } from '@/hooks/useFileBrowserState';
import { readDirectory, FileEntry } from '@/lib/tauri';
import { useContextMenuStore } from '@/stores/contextMenuStore';

interface BrowseFileListProps {
  entries: FileEntry[];
  activeFilePath: string | null;
  openFilePaths: Set<string>;
  onSelectFile: (path: string) => void;
  isLoading: boolean;
}

function BrowseFileList({ entries, activeFilePath, openFilePaths, onSelectFile, isLoading }: BrowseFileListProps) {
  const { openMenu } = useContextMenuStore();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Map<string, FileEntry[]>>(new Map());

  const toggleDir = async (path: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
      if (!dirContents.has(path)) {
        try {
          const contents = await readDirectory(path);
          setDirContents(new Map(dirContents).set(path, contents));
        } catch (err) {
          console.error('Failed to read directory:', err);
        }
      }
    }
    setExpandedDirs(newExpanded);
  };

  const renderEntry = (entry: FileEntry, depth: number) => {
    const isExpanded = expandedDirs.has(entry.path);
    const children = dirContents.get(entry.path) || [];

    const getFileIcon = () => {
      if (entry.isDirectory) {
        return (
          <svg className="h-4 w-4 text-yellow-500" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14.5 3H7.707l-.853-.854L6.5 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zM14 13H2V3h4.293l.853.854.354.146H14v9z" />
          </svg>
        );
      }

      const ext = entry.name.split('.').pop()?.toLowerCase();
      let color = 'text-tertiary';
      if (['ts', 'tsx'].includes(ext || '')) color = 'text-blue-400';
      else if (['js', 'jsx'].includes(ext || '')) color = 'text-yellow-400';
      else if (['rs'].includes(ext || '')) color = 'text-orange-400';
      else if (['py'].includes(ext || '')) color = 'text-green-400';
      else if (['json'].includes(ext || '')) color = 'text-yellow-300';
      else if (['md'].includes(ext || '')) color = 'text-blue-300';
      else if (['css', 'scss'].includes(ext || '')) color = 'text-pink-400';
      else if (['html'].includes(ext || '')) color = 'text-orange-300';

      return (
        <svg className={`h-4 w-4 ${color}`} viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.85 4.44l-3.28-3.3-.35-.14H3.5l-.5.5v13l.5.5h10l.5-.5V4.8l-.15-.36zM10 1.94L12.06 4H10V1.94zM13 14H4V2h5v2.5l.5.5H13v9z" />
        </svg>
      );
    };

    const isOpen = openFilePaths.has(entry.path);
    const isActive = activeFilePath === entry.path;

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
            isActive ? 'bg-surface-3' : isOpen ? 'bg-surface-3/30' : ''
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {entry.isDirectory && (
            <svg
              className={`h-3 w-3 text-tertiary transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M6 4l4 4-4 4V4z" />
            </svg>
          )}
          {!entry.isDirectory && <span className="w-3" />}
          {getFileIcon()}
          <span className="truncate text-primary">{entry.name}</span>
        </button>

        {entry.isDirectory && isExpanded && (
          <div>
            {children
              .sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
              })
              .map((child) => renderEntry(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-tertiary">Loading...</div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-tertiary text-sm">No files</div>
    );
  }

  const sortedEntries = [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="h-full overflow-y-auto py-1">
      {sortedEntries.map((entry) => renderEntry(entry, 0))}
    </div>
  );
}

export function BrowseFileListPanel() {
  const { entries, isLoading, browseActiveFilePath, browseOpenFiles, handleSelectFile, handleRefresh } =
    useFileBrowserState();

  const openFilePaths = new Set(browseOpenFiles.map((f) => f.path));

  return (
    <div className="h-full bg-surface-2 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            Files
          </span>
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-md p-1 text-secondary hover:bg-surface-3"
          title="Refresh"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.451 5.609l-.579-.939-1.068.812-.076.094c-.335.415-.927 1.341-1.124 2.876l-.021.165.033.163.071.345c.013.065.027.134.041.204H8.46l3.027 3.097L14.58 8.92l-2.857.07.035-.146.019-.074.012-.039v-.039c.212-1.082.211-2.136-.338-3.083zM6.514 6.027L3.487 2.933.393 6.028l2.86-.07-.037.147-.018.072-.013.04v.04c-.211 1.082-.21 2.136.339 3.083l.578.939 1.068-.812.076-.094c.335-.415.927-1.341 1.124-2.876l.021-.165-.033-.163-.071-.345a7.085 7.085 0 00-.041-.204h2.269L6.514 6.027z" />
          </svg>
        </button>
      </div>
      <BrowseFileList
        entries={entries}
        activeFilePath={browseActiveFilePath}
        openFilePaths={openFilePaths}
        onSelectFile={handleSelectFile}
        isLoading={isLoading}
      />
    </div>
  );
}
