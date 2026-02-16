import { useEffect, useRef, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { useTerminalStore, TerminalTab } from '@/stores/terminalStore';
import { useUIStore } from '@/stores/uiStore';
import { useCreateTerminal, useCloseTerminal } from '@/hooks/useTerminalLifecycle';
import { useTabGitRoots } from '@/hooks/useTabGitRoots';
import { TerminalPane } from './TerminalPane';
import { CloseIcon, FolderIcon } from '@/components/Icons';
import { getFileName, formatShortcut } from '@/lib/fileUtils';
import { useDraggableTabs } from '@/hooks/useDraggableTabs';

function TerminalTabLabel({ tab }: { tab: TerminalTab }) {
  const dirName = getFileName(tab.cwd);
  const mainText = tab.title || dirName;

  return <span className="truncate max-w-[200px]">{mainText}</span>;
}

interface TabGroup {
  projectName: string;
  gitRoot: string | null;
  tabs: TerminalTab[];
  globalIndices: number[];
}

function groupTabsByProject(tabs: TerminalTab[]): TabGroup[] {
  const groups: TabGroup[] = [];
  const groupMap = new Map<string, TabGroup>();

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    // Treat undefined (not yet resolved) same as null (no repo)
    const root = tab.gitRoot ?? null;
    const key = root ?? '~';

    let group = groupMap.get(key);
    if (!group) {
      group = {
        projectName: root ? getFileName(root) : '~',
        gitRoot: root,
        tabs: [],
        globalIndices: [],
      };
      groupMap.set(key, group);
      groups.push(group);
    }
    group.tabs.push(tab);
    group.globalIndices.push(i);
  }

  return groups;
}

function ProjectLabel({ name }: { name: string }) {
  return (
    <div className="px-2 pb-0.5 text-[10px] text-tertiary font-medium select-none leading-none truncate">
      {name}
    </div>
  );
}

export interface TerminalTabsHandle {
  openNewTerminal: () => void;
  openFolder: () => void;
}

export const TerminalTabs = forwardRef<TerminalTabsHandle>(function TerminalTabs(_, ref) {
  const { tabs, activeTabId, setActiveTab, reorderTabs } = useTerminalStore();
  const { setFocusedPanel } = useUIStore();
  const createTerminal = useCreateTerminal();
  const closeTerminal = useCloseTerminal();
  const initializedRef = useRef(false);
  const { getTabDragProps, containerRef, dropIndicatorIndex, dragFromIndex } = useDraggableTabs({
    itemCount: tabs.length,
    onReorder: reorderTabs,
  });

  useTabGitRoots();
  const groups = useMemo(() => groupTabsByProject(tabs), [tabs]);

  // Auto-create a terminal in home dir when none exist
  useEffect(() => {
    if (tabs.length === 0 && !initializedRef.current) {
      initializedRef.current = true;
      homeDir()
        .then((home) => createTerminal(home))
        .catch((err) => {
          console.error('Failed to create terminal:', err);
          initializedRef.current = false;
        });
    }
    // Reset so a new terminal is auto-created if all tabs are closed later
    if (tabs.length > 0) {
      initializedRef.current = false;
    }
  }, [tabs.length, createTerminal]);

  const handleNewTerminal = useCallback(async () => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      createTerminal(activeTab.cwd, activeTabId ?? undefined);
    } else {
      try {
        const home = await homeDir();
        createTerminal(home);
      } catch (err) {
        console.error('Failed to create terminal:', err);
      }
    }
  }, [tabs, activeTabId, createTerminal]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Open Folder',
    });

    if (selected && typeof selected === 'string') {
      createTerminal(selected);
    }
  }, [createTerminal]);

  // Expose methods to parent via ref
  useImperativeHandle(
    ref,
    () => ({
      openNewTerminal: handleNewTerminal,
      openFolder: handleOpenFolder,
    }),
    [handleNewTerminal, handleOpenFolder]
  );

  const handleCloseTerminal = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    closeTerminal(id);
  };

  return (
    <div
      className="flex h-full flex-col bg-terminal-bg"
      onClick={() => setFocusedPanel('terminal')}
    >
      {/* Tab bar */}
      <div className="flex items-center bg-surface-2 px-1 pt-1 gap-0.5">
        <div ref={containerRef} className="flex flex-1 overflow-x-auto gap-0.5 items-end">
          {groups.map((group, groupIdx) => (
            <div key={group.gitRoot ?? '~'} className="flex items-end shrink-0">
              {groupIdx > 0 && <div className="w-px h-5 bg-surface-3 shrink-0 mb-0.5" />}
              <div className="flex flex-col">
                {groups.length > 1 && <ProjectLabel name={group.projectName} />}
                <div className="flex gap-0.5">
                  {group.tabs.map((tab, tabIdx) => {
                    const globalIndex = group.globalIndices[tabIdx];
                    return (
                      <div key={tab.id} className="relative flex">
                        {dropIndicatorIndex === globalIndex && (
                          <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
                        )}
                        <button
                          {...getTabDragProps(globalIndex)}
                          onClick={() => setActiveTab(tab.id)}
                          className={`group flex items-center gap-1.5 px-2 py-1 text-xs ${
                            activeTabId === tab.id
                              ? 'bg-terminal-bg text-primary'
                              : 'text-secondary hover:bg-surface-1'
                          } ${dragFromIndex === globalIndex ? 'opacity-50' : ''}`}
                          title={tab.cwd}
                        >
                          <TerminalTabLabel tab={tab} />
                          <span
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => handleCloseTerminal(e, tab.id)}
                            className="ml-1 rounded-full p-0.5 opacity-0 hover:bg-surface-3 group-hover:opacity-100"
                          >
                            <CloseIcon />
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          {dropIndicatorIndex === tabs.length && (
            <div className="relative flex">
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
            </div>
          )}
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden relative">
        {tabs.map((tab) => (
          <TerminalPane key={tab.id} id={tab.id} isActive={activeTabId === tab.id} />
        ))}
        {tabs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <FolderIcon className="h-12 w-12 text-tertiary" />
            <div>
              <h3 className="text-lg font-medium text-primary mb-1">Welcome to Amend</h3>
              <p className="text-sm text-tertiary">Open a folder or start a new terminal</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleOpenFolder}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
              >
                Open Folder
              </button>
              <button
                onClick={handleNewTerminal}
                className="rounded-md bg-surface-2 px-4 py-2 text-sm font-medium text-primary hover:bg-surface-3"
              >
                New Terminal
              </button>
            </div>
            <kbd className="text-xs text-tertiary">
              {formatShortcut('Mod+O')} Open Folder &middot; {formatShortcut('Mod+T')} New Terminal
            </kbd>
          </div>
        )}
      </div>
    </div>
  );
});
