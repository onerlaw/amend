import { useEffect, useCallback, useState, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '@/stores/uiStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useProjectStore } from '@/stores/projectStore';
import { useCloseTerminal } from '@/hooks/useTerminal';
import { useDiffStats } from '@/hooks/useGit';
import { useTheme } from '@/hooks/useTheme';
import { TerminalTabs, TerminalTabsHandle } from '@/components/Terminal/TerminalTabs';
import { DiffContentPanel } from '@/components/DiffViewer/DiffContentPanel';
import { DiffFileListPanel } from '@/components/DiffViewer/DiffFileListPanel';
import { BrowseEditorTabs } from '@/components/FileBrowser/BrowseEditorTabs';
import { BrowseFileListPanel } from '@/components/FileBrowser/BrowseFileListPanel';
import { GlobalSearch } from '@/components/GlobalSearch/GlobalSearch';
import { indexProject } from '@/lib/tauri';

function ThemeToggle() {
  const { themeMode, cycleTheme } = useTheme();

  return (
    <button
      onClick={cycleTheme}
      className="rounded-md p-1.5 text-secondary hover:bg-surface-3"
      title={`Theme: ${themeMode}`}
    >
      {themeMode === 'light' && (
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708z" />
        </svg>
      )}
      {themeMode === 'dark' && (
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z" />
        </svg>
      )}
      {themeMode === 'system' && (
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 4s0-2 2-2h12s2 0 2 2v6s0 2-2 2h-4c0 .667.083 1.167.25 1.5H11a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1h.75c.167-.333.25-.833.25-1.5H2s-2 0-2-2V4zm1.398-.855a.758.758 0 0 0-.254.302A1.46 1.46 0 0 0 1 4.01V10c0 .325.078.502.145.602.07.105.17.188.302.254a1.464 1.464 0 0 0 .538.143L2.01 11H14c.325 0 .502-.078.602-.145a.758.758 0 0 0 .254-.302 1.464 1.464 0 0 0 .143-.538L15 9.99V4c0-.325-.078-.502-.145-.602a.757.757 0 0 0-.302-.254A1.46 1.46 0 0 0 13.99 3H2c-.325 0-.502.078-.602.145z" />
        </svg>
      )}
    </button>
  );
}

export function MainLayout() {
  const { panelMode, setPanelMode } = useUIStore();
  const { currentDirectory, setCurrentDirectory, browseOpenFiles, browseActiveFilePath, closeBrowseFile, activeWorktreePath, setActiveWorktreePath } = useFileStore();
  const { projects, addProject, setActiveProject } = useProjectStore();
  const { tabs, activeTabId, setActiveTab } = useTerminalStore();
  const closeTerminal = useCloseTerminal();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const terminalTabsRef = useRef<TerminalTabsHandle>(null);
  const migrationDone = useRef(false);
  const diffStats = useDiffStats(activeWorktreePath ?? currentDirectory);

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
      console.log('[MainLayout] Starting project indexing for:', currentDirectory);
      // Run indexing in background - don't block UI
      indexProject(currentDirectory)
        .then(() => {
          console.log('[MainLayout] Project indexing completed');
        })
        .catch((err) => {
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
    [tabs, activeTabId, setActiveTab, closeTerminal, panelMode, browseActiveFilePath, closeBrowseFile]
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
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm0 13c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z" />
              <path d="M7 6h2v5H7V6zm0-2h2v1H7V4z" />
            </svg>
          </button>
          <ThemeToggle />
          <button
            onClick={() => terminalTabsRef.current?.openNewTerminal()}
            className="rounded-md p-1.5 text-secondary hover:bg-surface-3"
            title="New Terminal"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1v6H2v1h6v6h1V8h6V7H9V1z" />
            </svg>
          </button>

          {/* Global Search */}
          <GlobalSearch />

          {/* Panel Mode Toggle */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPanelMode(panelMode === 'diff' ? null : 'diff')}
              className={`rounded-md px-2 py-1 text-xs ${
                panelMode === 'diff'
                  ? 'bg-accent text-white'
                  : 'text-secondary hover:bg-surface-3'
              }`}
            >
              Diff
              {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) && (
                <span className="ml-1.5">
                  {diffStats.additions > 0 && (
                    <span className={panelMode === 'diff' ? 'text-white/80' : 'text-diff-add-text'}>+{diffStats.additions}</span>
                  )}
                  {diffStats.additions > 0 && diffStats.deletions > 0 && ' '}
                  {diffStats.deletions > 0 && (
                    <span className={panelMode === 'diff' ? 'text-white/80' : 'text-diff-remove-text'}>-{diffStats.deletions}</span>
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
        ) : /* Browse mode without file selected - 2 panel layout */
        panelMode === 'browse' && browseOpenFiles.length === 0 ? (
          <PanelGroup direction="horizontal" autoSaveId="browse-no-file-layout">
            {/* Terminal - Left */}
            <Panel defaultSize={60} minSize={20}>
              <TerminalTabs ref={terminalTabsRef} />
            </Panel>

            <PanelResizeHandle />

            {/* File List - Right */}
            <Panel defaultSize={40} minSize={15}>
              <BrowseFileListPanel />
            </Panel>
          </PanelGroup>
        ) : (
          /* Diff mode or Browse mode with file selected - 3 panel layout */
          <PanelGroup direction="horizontal" autoSaveId="main-layout">
            {/* Terminal - Left */}
            <Panel defaultSize={40} minSize={20}>
              <TerminalTabs ref={terminalTabsRef} />
            </Panel>

            <PanelResizeHandle />

            {/* Content Area - Middle */}
            <Panel defaultSize={40} minSize={20}>
              {panelMode === 'diff' ? <DiffContentPanel /> : <BrowseEditorTabs />}
            </Panel>

            <PanelResizeHandle />

            {/* File List - Right */}
            <Panel defaultSize={20} minSize={10} maxSize={40}>
              {panelMode === 'diff' ? <DiffFileListPanel /> : <BrowseFileListPanel />}
            </Panel>
          </PanelGroup>
        )}
      </div>

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-80 rounded-xl bg-surface-2 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">Keyboard Shortcuts</h2>
              <button
                onClick={() => setShowShortcuts(false)}
                className="rounded-md p-1 text-secondary hover:bg-surface-3"
              >
                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z" />
                </svg>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
