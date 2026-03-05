import {
  Fragment,
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
import { RootDropZone } from './RootDropZone';
import { CloseIcon, FolderIcon } from '@/components/Icons';
import { getFileName, formatShortcut } from '@/lib/fileUtils';
import { useDraggableTabs } from '@/hooks/useDraggableTabs';
import { isTerminalBusy } from '@/lib/tauri';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { collectTerminalIds, findLeafByTerminalId, deserializeLayout } from '@/lib/layoutTree';

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
  return (
    <span className="flex items-center gap-1 max-w-[200px]">
      <span className="truncate">{tab.title || dirName}</span>
      <TabBranchBadge tab={tab} />
    </span>
  );
}

interface TabGroup {
  projectName: string;
  projectKey: string;
  tabs: TerminalTab[];
  globalIndices: number[];
}

export function groupTabsByProject(tabs: TerminalTab[]): TabGroup[] {
  const groups: TabGroup[] = [];
  const groupMap = new Map<string, TabGroup>();

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const root = tab.gitRoot ?? null;
    const mainRoot = tab.mainRepoRoot ?? root;
    const projectKey = mainRoot ?? '~';

    let group = groupMap.get(projectKey);
    if (!group) {
      group = {
        projectName: tab.repoName ?? (root ? getFileName(root) : '~'),
        projectKey,
        tabs: [],
        globalIndices: [],
      };
      groupMap.set(projectKey, group);
      groups.push(group);
    }

    group.tabs.push(tab);
    group.globalIndices.push(i);
  }

  return groups;
}

export function ProjectLabel({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] text-tertiary bg-surface-3 rounded font-medium select-none shrink-0">
      {name}
    </span>
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
  const setActiveTerminalInPane = useTerminalLayoutStore((s) => s.setActiveTerminalInPane);
  const createTerminal = useCreateTerminal();
  const closeTerminal = useCloseTerminal();
  const [closingTabId, setClosingTabId] = useState<string | null>(null);
  const initializedRef = useRef(false);

  useTabGitRoots();

  // Compute visible terminal IDs from layout (all terminals in any pane)
  const visibleTerminalIds = useMemo(() => {
    if (!layout) return new Set<string>();
    return new Set(collectTerminalIds(layout));
  }, [layout]);

  // Only show backgrounded terminals (not in any pane) in the global tab bar
  const backgroundedTabs = useMemo(
    () => tabs.filter((tab) => !visibleTerminalIds.has(tab.id)),
    [tabs, visibleTerminalIds]
  );
  const backgroundedGroups = useMemo(
    () => groupTabsByProject(backgroundedTabs),
    [backgroundedTabs]
  );

  const { getTabDragProps, containerRef, dropIndicatorIndex, dragFromIndex } = useDraggableTabs({
    itemCount: backgroundedTabs.length,
    onReorder: reorderTabs,
  });

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
    useSessionStore
      .getState()
      .saveTerminals(cwds, activeIndex >= 0 ? activeIndex : 0, layout, terminalIds);
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

      // If terminal is in a leaf, focus that pane and set it as active within it
      const leaf = findLeafByTerminalId(layout, tabId);
      if (leaf) {
        setActiveTerminalInPane(leaf.id, tabId);
      } else if (focusedPaneId) {
        // Terminal is backgrounded — add to focused pane's stack
        assignTerminalToPane(focusedPaneId, tabId);
      } else {
        setActiveTab(tabId);
      }
    },
    [layout, focusedPaneId, setActiveTerminalInPane, assignTerminalToPane, setActiveTab]
  );

  return (
    <div
      className="flex h-full flex-col bg-terminal-bg"
      onClick={() => setFocusedPanel('terminal')}
    >
      {/* Tab bar — only show for backgrounded terminals (not in any pane) */}
      {backgroundedTabs.length > 0 && (
        <div className="flex items-center bg-surface-2 px-1 pt-1 gap-0.5">
          <div ref={containerRef} className="flex flex-1 overflow-x-auto gap-0.5 items-center">
            {backgroundedGroups.map((group, groupIdx) => (
              <Fragment key={group.projectKey}>
                {groupIdx > 0 && <div className="w-0.5 h-6 bg-accent/30 rounded-full mx-1 shrink-0" />}
                <div className="flex items-center gap-0.5 shrink-0 bg-surface-1/50 rounded-md px-1 py-0.5">
                  <ProjectLabel name={group.projectName} />
                  {group.tabs.map((tab, tabIdx) => {
                    const globalIndex = group.globalIndices[tabIdx];
                    const isActive = activeTabId === tab.id;
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
                              : 'text-secondary hover:bg-surface-1 opacity-50 hover:opacity-75'
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
              </Fragment>
            ))}
            {dropIndicatorIndex === backgroundedTabs.length && (
              <div className="relative flex">
                <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
              </div>
            )}
          </div>
        </div>
      )}

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
        {layout && (
          <RootDropZone>
            <TerminalSplitLayout node={layout} />
          </RootDropZone>
        )}
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
