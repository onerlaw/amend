import { useState } from 'react';
import { FileEntry, readDirectory, readFile } from '@/lib/tauri';
import { useFileStore } from '@/stores/fileStore';
import { useContextMenuStore } from '@/stores/contextMenuStore';

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
  align?: 'left' | 'right';
}

export function FileTreeItem({ entry, depth, align = 'left' }: FileTreeItemProps) {
  const { expandedDirs, toggleDirectory, openFile } = useFileStore();
  const { openMenu } = useContextMenuStore();
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const isExpanded = expandedDirs.has(entry.path);

  const handleClick = async () => {
    if (entry.isDirectory) {
      if (!isExpanded && children.length === 0) {
        setIsLoading(true);
        try {
          const entries = await readDirectory(entry.path);
          setChildren(entries);
        } catch (error) {
          console.error('Failed to read directory:', error);
        }
        setIsLoading(false);
      }
      toggleDirectory(entry.path);
    } else {
      try {
        const content = await readFile(entry.path);
        openFile({
          path: entry.path,
          name: entry.name,
          content,
          isDirty: false,
          language: '',
        });
      } catch (error) {
        console.error('Failed to read file:', error);
      }
    }
  };

  const getFileIcon = () => {
    if (entry.isDirectory) {
      return isExpanded ? (
        <svg className="h-4 w-4 text-yellow-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.5 14h13l.5-.5V5l-.5-.5H7.707l-.853-.854L6.5 3.5h-5l-.5.5v9.5l.5.5zM2 13V5h12v8H2z" />
        </svg>
      ) : (
        <svg className="h-4 w-4 text-yellow-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14.5 3H7.707l-.853-.854L6.5 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zM14 13H2V3h4.293l.853.854.354.146H14v9z" />
        </svg>
      );
    }

    const ext = entry.name.split('.').pop()?.toLowerCase();
    let color = 'text-gray-400';

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

  const isRightAligned = align === 'right';

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu(entry, e.clientX, e.clientY);
        }}
        className={`flex w-full items-center gap-1 py-0.5 text-sm text-editor-text hover:bg-editor-border/50 ${
          isRightAligned ? 'flex-row-reverse text-right pl-2' : 'text-left pr-2'
        }`}
        style={isRightAligned ? { paddingRight: `${depth * 12 + 8}px` } : { paddingLeft: `${depth * 12 + 8}px` }}
      >
        {entry.isDirectory && (
          <svg
            className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''} ${isRightAligned ? 'rotate-180' : ''} ${isExpanded && isRightAligned ? '-rotate-90' : ''}`}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5 5v.7l-5 5z" />
          </svg>
        )}
        {!entry.isDirectory && <span className="w-3" />}
        {getFileIcon()}
        <span className="truncate">{entry.name}</span>
        {isLoading && <span className={isRightAligned ? 'mr-auto' : 'ml-auto'} ><span className="text-xs text-gray-500">...</span></span>}
      </button>

      {entry.isDirectory && isExpanded && (
        <div>
          {children.map((child) => (
            <FileTreeItem key={child.path} entry={child} depth={depth + 1} align={align} />
          ))}
        </div>
      )}
    </div>
  );
}
