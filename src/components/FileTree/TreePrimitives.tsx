import { type ReactNode } from 'react';
import { ChevronIcon, FolderIcon, RefreshIcon } from '@/components/Icons';

interface TreeRowProps {
  depth: number;
  isSelected?: boolean;
  isSubtle?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  className?: string;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  dragPath?: string;
  children: ReactNode;
}

export function TreeRow({
  depth,
  isSelected,
  isSubtle,
  isDragging,
  isDropTarget,
  className,
  onClick,
  onContextMenu,
  onMouseDown,
  dragPath,
  children,
}: TreeRowProps) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
      data-drag-path={dragPath}
      className={`flex w-full select-none items-center gap-1 py-0.5 text-sm hover:bg-surface-3/50 ${
        isSelected ? 'bg-surface-3' : isSubtle ? 'bg-surface-3/30' : ''
      } ${isDropTarget ? 'ring-1 ring-inset ring-accent bg-accent/10' : ''} ${isDragging ? 'opacity-50' : ''} ${className ?? ''}`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {children}
    </button>
  );
}

export function DirectoryIndicator({ isExpanded }: { isExpanded: boolean }) {
  return (
    <>
      <ChevronIcon
        className={`h-3 w-3 text-tertiary transition-transform ${isExpanded ? 'rotate-90' : ''}`}
      />
      <FolderIcon className="h-4 w-4 text-yellow-500" />
    </>
  );
}

interface PanelHeaderProps {
  title: string;
  badge?: number;
  badgeColor?: string;
  onRefresh: () => void;
}

export function PanelHeader({
  title,
  badge,
  badgeColor = 'bg-green-600',
  onRefresh,
}: PanelHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">{title}</span>
        {badge != null && badge > 0 && (
          <span className={`rounded-full ${badgeColor} px-2 py-0.5 text-xs font-medium text-white`}>
            {badge}
          </span>
        )}
      </div>
      <button
        onClick={onRefresh}
        className="rounded-md p-1 text-secondary hover:bg-surface-3"
        title="Refresh"
      >
        <RefreshIcon />
      </button>
    </div>
  );
}
