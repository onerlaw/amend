import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { useTerminalStore, TerminalTab } from '@/stores/terminalStore';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { useCreateTerminal, useCloseTerminal } from '@/hooks/useTerminalLifecycle';
import { useTabGitRoots } from '@/hooks/useTabGitRoots';
import { TerminalPane } from './TerminalPane';
import { TerminalSplitLayout } from './TerminalSplitLayout';
import { CloseIcon, FolderIcon } from '@/components/Icons';
import { getFileName, formatShortcut } from '@/lib/fileUtils';
import { useDraggableTabs } from '@/hooks/useDraggableTabs';
import { isTerminalBusy } from '@/lib/tauri';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { collectTerminalIds, findLeafByTerminalId, deserializeLayout } from '@/lib/layoutTree';

function TerminalTabLabel({ tab }: { tab: TerminalTab }) {
  const dirName = getFileName(tab.cwd);
  if (tab.worktreeName) {
    const subtitle = tab.title || dirName;
    return (
      <span className="flex flex-col leading-tight max-w-[160px]">
        <span className="truncate">{tab.worktreeName}</span>
        {subtitle !== tab.worktreeName && (
          <span className="truncate text-[10px] opacity-60">{subtitle}</span>
        )}
      </span>
    );
  }
  return <span className="truncate max-w-[200px]">{tab.title || dirName}</span>;
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
    const root = tab.gitRoot ?? null;
    // Group by mainRepoRoot so all worktrees of the same repo are together
    const mainRoot = tab.mainRepoRoot ?? root;
    const key = mainRoot ?? '~';

    let group = groupMap.get(key);
    if (!group) {
      group = {
        projectName: tab.repoName ?? (root ? getFileName(root) : '~'),
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
  const layout = useTerminalLayoutStore((s) => s.layout);
  const focusedPaneId = useTerminalLayoutStore((s) => s.focusedPaneId);
  const initLayout = useTerminalLayoutStore((s) => s.initLayout);
  const setLayout = useTerminalLayoutStore((s) => s.setLayout);
  const setFocusedPane = useTerminalLayoutStore((s) => s.setFocusedPane);
  const assignTerminalToPane = useTerminalLayoutStore((s) => s.assignTerminalToPane);
  const createTerminal = useCreateTerminal();
  const closeTerminal = useCloseTerminal();
  const [closingTabId, setClosingTabId] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const { getTabDragProps, containerRef, dropIndicatorIndex, dragFromIndex } = useDraggableTabs({
    itemCount: tabs.length,
    onReorder: reorderTabs,
  });

  useTabGitRoots();
  const groups = useMemo(() => groupTabsByProject(tabs), [tabs]);

  // Compute visible terminal IDs from layout
  const visibleTerminalIds = useMemo(() => {
    if (!layout) return new Set<string>();
    return new Set(collectTerminalIds(layout));
  }, [layout]);

  // Auto-create terminal(s) on startup, restoring saved session if available
  useEffect(() => {
    if (tabs.length === 0 && !initializedRef.current) {
      initializedRef.current = true;
      const { terminalCwds, activeTerminalIndex, terminalLayout } = useSessionStore.getState();
      if (terminalCwds.length > 0) {
        (async () => {
          const ids: string[] = [];
          for (const cwd of terminalCwds) {
            try {
              const id = await createTerminal(cwd);
              ids.push(id);
            } catch (err) {
              console.error('Failed to restore terminal:', cwd, err);
            }
          }
          const targetIndex = Math.min(activeTerminalIndex, ids.length - 1);
          if (ids[targetIndex]) {
            setActiveTab(ids[targetIndex]);
          }
          // Restore layout from session
          if (terminalLayout && ids.length > 0) {
            const restored = deserializeLayout(terminalLayout, ids);
            if (restored) {
              setLayout(restored);
              // Set focus to the active terminal's pane
              const activeId = ids[targetIndex] ?? ids[0];
              const leaf = findLeafByTerminalId(restored, activeId);
              if (leaf) {
                setFocusedPane(leaf.id);
              }
              return;
            }
          }
          // Fallback: single leaf for first terminal
          if (ids.length > 0) {
            initLayout(ids[targetIndex] ?? ids[0]);
          }
        })();
      } else {
        homeDir()
          .then((home) => createTerminal(home))
          .catch((err) => {
            console.error('Failed to create terminal:', err);
            initializedRef.current = false;
          });
      }
    }
    // Reset so a new terminal is auto-created if all tabs are closed later
    if (tabs.length > 0) {
      initializedRef.current = false;
    }
  }, [tabs.length, createTerminal, setActiveTab, initLayout, setLayout, setFocusedPane]);

  // Initialize layout when first terminal is added and layout is null
  useEffect(() => {
    if (tabs.length > 0 && !layout) {
      initLayout(tabs[0].id);
    }
  }, [tabs.length, layout, initLayout, tabs]);

  // Save terminal state to session whenever tabs, active tab, or layout changes
  useEffect(() => {
    if (tabs.length === 0) return;
    const cwds = tabs.map((t) => t.cwd);
    const activeIndex = tabs.findIndex((t) => t.id === activeTabId);
    const terminalIds = tabs.map((t) => t.id);
    useSessionStore.getState().saveTerminals(
      cwds,
      activeIndex >= 0 ? activeIndex : 0,
      layout,
      terminalIds
    );
  }, [tabs, activeTabId, layout]);

  const handleNewTerminal = useCallback(async () => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      const newId = await createTerminal(activeTab.cwd, activeTabId ?? undefined);
      // Assign the new terminal to the focused pane so it becomes visible immediately
      if (focusedPaneId) {
        assignTerminalToPane(focusedPaneId, newId);
      }
    } else {
      try {
        const home = await homeDir();
        createTerminal(home);
      } catch (err) {
        console.error('Failed to create terminal:', err);
      }
    }
  }, [tabs, activeTabId, createTerminal, focusedPaneId, assignTerminalToPane]);

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

  const handleCloseTerminal = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const busy = await isTerminalBusy(id);
    if (busy) {
      setClosingTabId(id);
    } else {
      closeTerminal(id);
    }
  };

  const handleTabClick = useCallback(
    (tabId: string) => {
      if (!layout) return;

      // If terminal is visible in layout, focus its pane
      const leaf = findLeafByTerminalId(layout, tabId);
      if (leaf) {
        setFocusedPane(leaf.id);
      } else if (focusedPaneId) {
        // Terminal is backgrounded — assign to focused pane
        assignTerminalToPane(focusedPaneId, tabId);
      } else {
        setActiveTab(tabId);
      }
    },
    [layout, focusedPaneId, setFocusedPane, assignTerminalToPane, setActiveTab]
  );

  return (
    <div
      className="flex h-full flex-col bg-terminal-bg"
      onClick={() => setFocusedPanel('terminal')}
    >
      {/* Tab bar */}
      <div className="flex items-center bg-surface-2 px-1 pt-1 gap-0.5">
        <div ref={containerRef} className="flex flex-1 overflow-x-auto gap-0.5 items-end">
          {groups.map((group, groupIdx) => (
            <div
              key={group.projectName + (group.gitRoot ?? '~')}
              className="flex items-end shrink-0"
            >
              {groupIdx > 0 && <div className="w-px h-5 bg-surface-3 shrink-0 mb-0.5" />}
              <div className="flex flex-col">
                <ProjectLabel name={group.projectName} />
                <div className="flex gap-0.5">
                  {group.tabs.map((tab, tabIdx) => {
                    const globalIndex = group.globalIndices[tabIdx];
                    const isActive = activeTabId === tab.id;
                    const isVisible = visibleTerminalIds.has(tab.id);
                    return (
                      <div key={tab.id} className="relative flex">
                        {dropIndicatorIndex === globalIndex && (
                          <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
                        )}
                        <button
                          {...getTabDragProps(globalIndex)}
                          onClick={() => handleTabClick(tab.id)}
                          className={`group flex items-center gap-1.5 px-2 py-1 text-xs ${
                            isActive
                              ? 'bg-terminal-bg text-primary'
                              : isVisible
                                ? 'bg-surface-1 text-primary'
                                : 'text-secondary hover:bg-surface-1'
                          } ${dragFromIndex === globalIndex ? 'opacity-50' : ''}`}
                          title={tab.cwd}
                        >
                          {isVisible && !isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-accent/60 shrink-0" />
                          )}
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
        {closingTabId && (
          <ConfirmDialog
            title="Close Terminal?"
            message="A process is running in this terminal. Close it anyway?"
            confirmLabel="Close"
            confirmClassName="bg-red-600 hover:bg-red-700"
            onConfirm={() => {
              closeTerminal(closingTabId);
              setClosingTabId(null);
            }}
            onCancel={() => setClosingTabId(null)}
          />
        )}
        {/* Render split layout for visible terminals */}
        {layout && <TerminalSplitLayout node={layout} />}
        {/* Keep backgrounded terminals hidden-mounted to preserve xterm state */}
        {tabs
          .filter((tab) => !visibleTerminalIds.has(tab.id))
          .map((tab) => (
            <div key={tab.id} className="hidden">
              <TerminalPane id={tab.id} isActive={false} />
            </div>
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
