import { useEffect, useCallback, useState, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '@/stores/uiStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useProjectStore } from '@/stores/projectStore';
import { useCloseTerminal } from '@/hooks/useTerminal';
import { useGitPolling } from '@/hooks/useGit';
import { useTheme } from '@/hooks/useTheme';
import { TerminalTabs, TerminalTabsHandle } from '@/components/Terminal/TerminalTabs';
import { DiffContentPanel } from '@/components/DiffViewer/DiffContentPanel';
import { DiffFileListPanel } from '@/components/DiffViewer/DiffFileListPanel';
import { DiffViewerProvider } from '@/components/DiffViewer/DiffViewerContext';
import { BrowseEditorTabs, BrowseEditorTabsHandle } from '@/components/FileBrowser/BrowseEditorTabs';
import { BrowseFileListPanel } from '@/components/FileBrowser/BrowseFileListPanel';
import { GlobalSearch } from '@/components/GlobalSearch/GlobalSearch';
import { ModalOverlay } from '@/components/ModalOverlay';
import { indexProject } from '@/lib/tauri';
import { PlusIcon, CloseIcon, InfoIcon, SunIcon, MoonIcon, MonitorIcon } from '@/components/Icons';

function ThemeToggle() {
  const { themeMode, cycleTheme } = useTheme();

  return (
    <button
      onClick={cycleTheme}
      className="rounded-md p-1.5 text-secondary hover:bg-surface-3"
      title={`Theme: ${themeMode}`}
    >
      {themeMode === 'light' && <SunIcon />}
      {themeMode === 'dark' && <MoonIcon />}
      {themeMode === 'system' && <MonitorIcon />}
    </button>
  );
}

export function MainLayout() {
  const { panelMode, setPanelMode } = useUIStore();
  const {
    currentDirectory,
    setCurrentDirectory,
    browseOpenFiles,
    browseActiveFilePath,
    closeBrowseFile,
    setActiveWorktreePath,
    contextPath,
  } = useFileStore();
  const { projects, addProject, setActiveProject } = useProjectStore();
  const { tabs, activeTabId, setActiveTab } = useTerminalStore();
  const closeTerminal = useCloseTerminal();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const terminalTabsRef = useRef<TerminalTabsHandle>(null);
  const browseEditorTabsRef = useRef<BrowseEditorTabsHandle>(null);
  const migrationDone = useRef(false);
  const gitPolling = useGitPolling(contextPath);
  const diffStats = gitPolling.diffStats;

  // Migration: if currentDirectory exists but no projects, auto-create one
  useEffect(() => {
    if (migrationDone.current) return;
    if (currentDirectory && projects.length === 0) {
      addProject(currentDirectory);
      migrationDone.current = true;
    }
  }, [currentDirectory, projects.length, addProject]);

  // Index project for symbol navigation when directory changes
  useEffect(() => {
    if (currentDirectory) {
      indexProject(currentDirectory).catch((err) => {
        console.error('[MainLayout] Failed to index project for symbol navigation:', err);
      });
    }
  }, [currentDirectory]);

  // Sync active terminal's worktree and project to global state
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      setActiveWorktreePath(activeTab.worktreePath);
      // Sync project context when terminal has a projectId
      if (activeTab.projectId) {
        const project = projects.find((p) => p.id === activeTab.projectId);
        if (project) {
          setActiveProject(activeTab.projectId);
          setCurrentDirectory(project.path);
        }
      }
    }
  }, [activeTabId, tabs, setActiveWorktreePath, projects, setActiveProject, setCurrentDirectory]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Cmd/Ctrl + O or Cmd/Ctrl + T: Open new terminal flow (project picker -> worktree selector)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'o' || e.key === 't')) {
        e.preventDefault();
        terminalTabsRef.current?.openNewTerminal();
      }

      // Cmd/Ctrl + `: Cycle terminals
      if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault();
        if (tabs.length > 1 && activeTabId) {
          const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
          const nextIndex = (currentIndex + 1) % tabs.length;
          setActiveTab(tabs[nextIndex].id);
        }
      }

      // Cmd/Ctrl + D: Duplicate current terminal
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        terminalTabsRef.current?.duplicateTerminal();
      }

      // Cmd/Ctrl + F (without Shift): Find in file (browse mode)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !e.shiftKey) {
        if (panelMode === 'browse' && browseActiveFilePath) {
          e.preventDefault();
          browseEditorTabsRef.current?.openSearch();
        }
      }

      // Cmd/Ctrl + W: Close current tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();

        const { focusedPanel } = useUIStore.getState();

        if (focusedPanel === 'terminal') {
          // Don't close if it's the last terminal
          if (tabs.length > 1 && activeTabId) {
            closeTerminal(activeTabId);
          }
        } else if (focusedPanel === 'editor') {
          if (panelMode === 'browse' && browseActiveFilePath) {
            closeBrowseFile(browseActiveFilePath);
          }
          // Note: Diff mode files are not closable via this shortcut (they're auto-loaded)
        }
      }
    },
    [
      tabs,
      activeTabId,
      setActiveTab,
      closeTerminal,
      panelMode,
      browseActiveFilePath,
      closeBrowseFile,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen flex-col bg-surface-0">
      {/* Title bar / toolbar */}
      <div className="flex h-14 items-center justify-center bg-surface-2 px-4">
        <div className="flex items-center gap-3">
          {/* Info/Help and Theme Toggle */}
          <button
            onClick={() => setShowShortcuts(true)}
            className="rounded-md p-1.5 text-secondary hover:bg-surface-3"
            title="Keyboard Shortcuts"
          >
            <InfoIcon />
          </button>
          <ThemeToggle />
          <button
            onClick={() => terminalTabsRef.current?.openNewTerminal()}
            className="rounded-md p-1.5 text-secondary hover:bg-surface-3"
            title="New Terminal"
          >
            <PlusIcon />
          </button>

          {/* Global Search */}
          <GlobalSearch />

          {/* Panel Mode Toggle */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPanelMode(panelMode === 'diff' ? null : 'diff')}
              className={`rounded-md px-2 py-1 text-xs ${
                panelMode === 'diff' ? 'bg-accent text-white' : 'text-secondary hover:bg-surface-3'
              }`}
            >
              Diff
              {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) && (
                <span className="ml-1.5">
                  {diffStats.additions > 0 && (
                    <span className={panelMode === 'diff' ? 'text-white/80' : 'text-diff-add-text'}>
                      +{diffStats.additions}
                    </span>
                  )}
                  {diffStats.additions > 0 && diffStats.deletions > 0 && ' '}
                  {diffStats.deletions > 0 && (
                    <span
                      className={panelMode === 'diff' ? 'text-white/80' : 'text-diff-remove-text'}
                    >
                      -{diffStats.deletions}
                    </span>
                  )}
                </span>
              )}
            </button>
            <button
              onClick={() => setPanelMode(panelMode === 'browse' ? null : 'browse')}
              className={`rounded-md px-2 py-1 text-xs ${
                panelMode === 'browse'
                  ? 'bg-accent text-white'
                  : 'text-secondary hover:bg-surface-3'
              }`}
            >
              Browse
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {/* No panel mode - terminal only */}
        {panelMode === null ? (
          <TerminalTabs ref={terminalTabsRef} />
        ) : panelMode === 'diff' ? (
          /* Diff mode - 3 panel layout with shared context */
          <DiffViewerProvider gitPolling={gitPolling}>
            <PanelGroup direction="horizontal" autoSaveId="main-layout">
              <Panel defaultSize={40} minSize={20}>
                <TerminalTabs ref={terminalTabsRef} />
              </Panel>

              <PanelResizeHandle />

              <Panel defaultSize={40} minSize={20}>
                <DiffContentPanel />
              </Panel>

              <PanelResizeHandle />

              <Panel defaultSize={20} minSize={10} maxSize={40}>
                <DiffFileListPanel />
              </Panel>
            </PanelGroup>
          </DiffViewerProvider>
        ) : browseOpenFiles.length === 0 ? (
          /* Browse mode without file selected - 2 panel layout */
          <PanelGroup direction="horizontal" autoSaveId="browse-no-file-layout">
            <Panel defaultSize={60} minSize={20}>
              <TerminalTabs ref={terminalTabsRef} />
            </Panel>

            <PanelResizeHandle />

            <Panel defaultSize={40} minSize={15}>
              <BrowseFileListPanel />
            </Panel>
          </PanelGroup>
        ) : (
          /* Browse mode with file selected - 3 panel layout */
          <PanelGroup direction="horizontal" autoSaveId="main-layout">
            <Panel defaultSize={40} minSize={20}>
              <TerminalTabs ref={terminalTabsRef} />
            </Panel>

            <PanelResizeHandle />

            <Panel defaultSize={40} minSize={20}>
              <BrowseEditorTabs ref={browseEditorTabsRef} />
            </Panel>

            <PanelResizeHandle />

            <Panel defaultSize={20} minSize={10} maxSize={40}>
              <BrowseFileListPanel />
            </Panel>
          </PanelGroup>
        )}
      </div>

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <ModalOverlay onClose={() => setShowShortcuts(false)}>
          <div className="w-80 rounded-xl bg-surface-2 p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">Keyboard Shortcuts</h2>
              <button
                onClick={() => setShowShortcuts(false)}
                className="rounded-md p-1 text-secondary hover:bg-surface-3"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">New Terminal</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+T / Cmd+O
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Duplicate Terminal</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+D
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Cycle Terminals</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+`
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Close Tab</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+W
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Search</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+P / Cmd+Shift+F
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Find in File</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+F
                </kbd>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
