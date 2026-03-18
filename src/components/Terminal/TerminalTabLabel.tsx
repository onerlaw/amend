import { useCallback, useRef, useState } from 'react';
import { useTerminalStore, TerminalTab } from '@/stores/terminalStore';
import { SpinnerIcon } from '@/components/Icons';
import { getFileName } from '@/lib/fileUtils';

function TabBranchBadge({ tab }: { tab: TerminalTab }) {
  const label = tab.branchName ?? tab.worktreeName ?? '~';
  return (
    <span className="inline-flex items-center text-[9px] text-tertiary/70 bg-surface-2 rounded px-1 font-mono select-none shrink-0">
      {label}
    </span>
  );
}

export function TerminalTabLabel({ tab }: { tab: TerminalTab }) {
  const dirName = getFileName(tab.cwd);
  const displayName = tab.customName ?? tab.title ?? dirName;
  const isBusy = useTerminalStore((s) => s.busyMap[tab.id]);
  const setTabCustomName = useTerminalStore((s) => s.setTabCustomName);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const cancelledRef = useRef(false);

  const commitRename = useCallback(() => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const trimmed = renameValue.trim();
    setTabCustomName(tab.id, trimmed || undefined);
    setRenaming(false);
  }, [renameValue, tab.id, setTabCustomName]);

  const cancelRename = useCallback(() => {
    cancelledRef.current = true;
    setRenaming(false);
  }, []);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(tab.customName ?? '');
    setRenaming(true);
  };

  const inputCallbackRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus();
      node.select();
    }
  }, []);

  if (renaming) {
    return (
      <span className="flex items-center gap-1 max-w-[200px]">
        <input
          ref={inputCallbackRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') cancelRename();
          }}
          onBlur={commitRename}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="bg-surface-3 text-primary text-xs rounded px-1 py-0 outline-none border border-accent w-full min-w-[40px]"
          placeholder={tab.title ?? dirName}
        />
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 max-w-[200px]" onDoubleClick={handleDoubleClick}>
      {isBusy && <SpinnerIcon className="h-3 w-3 animate-spin shrink-0" />}
      <span className="truncate">{displayName}</span>
      <TabBranchBadge tab={tab} />
    </span>
  );
}
