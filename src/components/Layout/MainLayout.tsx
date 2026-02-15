import { useEffect, useCallback, useState, useRef, lazy, Suspense } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '@/stores/uiStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useProjectStore } from '@/stores/projectStore';
import { useCloseTerminal } from '@/hooks/useTerminal';
import { useGitPolling } from '@/hooks/useGit';
import { useTheme } from '@/hooks/useTheme';
import { TerminalTabs, TerminalTabsHandle } from '@/components/Terminal/TerminalTabs';
import { DiffViewerProvider } from '@/components/DiffViewer/DiffViewerContext';
import type { BrowseEditorTabsHandle } from '@/components/FileBrowser/BrowseEditorTabs';
import { GlobalSearch } from '@/components/GlobalSearch/GlobalSearch';
import { ModalOverlay } from '@/components/ModalOverlay';
import { indexProject, copyEntry, moveEntry, getClipboardFilePaths } from '@/lib/tauri';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import {
  PlusIcon,
  CloseIcon,
  InfoIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  SidebarIcon,
  NotesIcon,
} from '@/components/Icons';
import { useNotesStore } from '@/stores/notesStore';

const DiffContentPanel = lazy(() =>
  import('@/components/DiffViewer/DiffContentPanel').then((m) => ({
    default: m.DiffContentPanel,
  }))
);
const DiffFileListPanel = lazy(() =>
  import('@/components/DiffViewer/DiffFileListPanel').then((m) => ({
    default: m.DiffFileListPanel,
  }))
);
const BrowseEditorTabs = lazy(() =>
  import('@/components/FileBrowser/BrowseEditorTabs').then((m) => ({
    default: m.BrowseEditorTabs,
  }))
);
const BrowseFileListPanel = lazy(() =>
  import('@/components/FileBrowser/BrowseFileListPanel').then((m) => ({
    default: m.BrowseFileListPanel,
  }))
);
const NotesPanel = lazy(() =>
  import('@/components/NotesPanel').then((m) => ({ default: m.NotesPanel }))
);

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
  const {
    panelMode,
    setPanelMode,
    diffFileListVisible,
    browseFileListVisible,
    toggleBrowseFileList,
    toggleDiffFileList,
  } = useUIStore();
  const { isOpen: notesOpen, toggleNotes } = useNotesStore();
  const {
    currentDirectory,
    browseOpenFiles,
    browseActiveFilePath,
    closeBrowseFile,
    setActiveWorktreePath,
    syncTabContext,
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

  // Index project for symbol navigation when context path changes (deferred to avoid blocking startup)
  useEffect(() => {
    if (!contextPath) return;
    const timer = setTimeout(() => {
      indexProject(contextPath).catch((err) => {
        console.error('[MainLayout] Failed to index project for symbol navigation:', err);
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [contextPath]);

  // Sync active terminal's worktree and project to global state
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      if (activeTab.projectId) {
        const project = projects.find((p) => p.id === activeTab.projectId);
        if (project) {
          setActiveProject(activeTab.projectId);
          // Atomically save old browse state and restore for the new context
          syncTabContext(project.path, activeTab.worktreePath);
          return;
        }
      }
      // Fallback: tab without a project, just update worktree
      setActiveWorktreePath(activeTab.worktreePath);
    }
  }, [activeTabId, tabs, setActiveWorktreePath, projects, setActiveProject, syncTabContext]);

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

      // Cmd/Ctrl + V: Paste files into file browser
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        const { focusedPanel } = useUIStore.getState();
        if (panelMode === 'browse' && focusedPanel === 'file-list' && contextPath) {
          e.preventDefault();

          const { clipboard, clearClipboard } = useContextMenuStore.getState();

          // Priority 1: internal clipboard (cut/copy from context menu)
          if (clipboard.entry && clipboard.operation) {
            const destPath = `${contextPath}/${clipboard.entry.name}`;
            (async () => {
              try {
                if (clipboard.operation === 'cut') {
                  await moveEntry(clipboard.entry!.path, destPath);
                } else {
                  await copyEntry(clipboard.entry!.path, destPath);
                }
                clearClipboard();
                useFileStore.getState().invalidateFileTree();
              } catch (err) {
                console.error('Failed to paste file:', err);
              }
            })();
            return;
          }

          // Priority 2: OS clipboard file paths
          (async () => {
            try {
              const paths = await getClipboardFilePaths();
              if (paths.length === 0) return;

              for (const srcPath of paths) {
                const fileName = srcPath.split('/').pop() || 'file';
                let destPath = `${contextPath}/${fileName}`;

                // Collision handling: name (1).ext, name (2).ext, etc.
                let counter = 1;
                const dot = fileName.lastIndexOf('.');
                const baseName = dot > 0 ? fileName.slice(0, dot) : fileName;
                const ext = dot > 0 ? fileName.slice(dot) : '';

                while (true) {
                  try {
                    // Check if file exists by trying to get metadata via a readDirectory of parent
                    // Use a simpler approach: try the copy and handle error
                    await copyEntry(srcPath, destPath);
                    break;
                  } catch {
                    // Likely collision, try next name
                    destPath = `${contextPath}/${baseName} (${counter})${ext}`;
                    counter++;
                    if (counter > 100) break;
                  }
                }
              }
              useFileStore.getState().invalidateFileTree();
            } catch (err) {
              console.error('Failed to paste files from clipboard:', err);
            }
          })();
        }
      }

      // Cmd/Ctrl + Shift + N: Toggle notes panel
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        useNotesStore.getState().toggleNotes();
      }

      // Cmd/Ctrl + = or +: Increase font size
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        useUIStore.getState().increaseFontSize();
      }

      // Cmd/Ctrl + -: Decrease font size
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        useUIStore.getState().decreaseFontSize();
      }

      // Cmd/Ctrl + 0: Reset font size
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        useUIStore.getState().resetFontSize();
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
      <div className="flex h-14 items-center bg-surface-2 px-4">
        <div className="w-10" />
        <div className="flex flex-1 items-center justify-center gap-3">
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
            onClick={toggleNotes}
            className={`rounded-md p-1.5 ${
              notesOpen ? 'bg-accent text-white' : 'text-secondary hover:bg-surface-3'
            }`}
            title="Notes (Cmd+Shift+N)"
          >
            <NotesIcon />
          </button>
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
        <div className="flex w-10 items-center justify-end">
          {(panelMode === 'browse' || panelMode === 'diff') && (
            <button
              onClick={panelMode === 'browse' ? toggleBrowseFileList : toggleDiffFileList}
              className={`rounded-md p-1.5 ${
                (panelMode === 'browse' ? browseFileListVisible : diffFileListVisible)
                  ? 'text-accent hover:bg-surface-3'
                  : 'text-secondary hover:bg-surface-3'
              }`}
              title={
                (panelMode === 'browse' ? browseFileListVisible : diffFileListVisible)
                  ? 'Hide file list'
                  : 'Show file list'
              }
            >
              <SidebarIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <DiffViewerProvider gitPolling={gitPolling} enabled={panelMode === 'diff'}>
          <PanelGroup direction="horizontal" autoSaveId="main-layout">
            {/* Terminal: ALWAYS mounted, never unmounts */}
            <Panel id="terminal" order={1} minSize={20}>
              <TerminalTabs ref={terminalTabsRef} />
            </Panel>

            {/* Diff mode: content + file list */}
            {panelMode === 'diff' && <PanelResizeHandle />}
            {panelMode === 'diff' && (
              <Panel id="diff-content" order={2} defaultSize={40} minSize={20}>
                <Suspense fallback={null}>
                  <DiffContentPanel />
                </Suspense>
              </Panel>
            )}
            {panelMode === 'diff' && diffFileListVisible && <PanelResizeHandle />}
            {panelMode === 'diff' && diffFileListVisible && (
              <Panel id="diff-file-list" order={3} defaultSize={20} minSize={10} maxSize={40}>
                <Suspense fallback={null}>
                  <DiffFileListPanel />
                </Suspense>
              </Panel>
            )}

            {/* Browse mode: editor (if files open) + file list */}
            {panelMode === 'browse' && <PanelResizeHandle />}
            {panelMode === 'browse' && browseOpenFiles.length > 0 && (
              <Panel id="browse-editor" order={2} defaultSize={40} minSize={20}>
                <Suspense fallback={null}>
                  <BrowseEditorTabs ref={browseEditorTabsRef} />
                </Suspense>
              </Panel>
            )}
            {panelMode === 'browse' && browseOpenFiles.length > 0 && browseFileListVisible && (
              <PanelResizeHandle />
            )}
            {panelMode === 'browse' && browseFileListVisible && (
              <Panel id="browse-file-list" order={3} defaultSize={20} minSize={10} maxSize={40}>
                <Suspense fallback={null}>
                  <BrowseFileListPanel />
                </Suspense>
              </Panel>
            )}
          </PanelGroup>
        </DiffViewerProvider>
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
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Paste Files</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+V
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Toggle Notes</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+Shift+N
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Increase Font Size</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+=
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Decrease Font Size</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+-
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-primary">Reset Font Size</span>
                <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                  Cmd+0
                </kbd>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Floating Notes Panel */}
      <Suspense fallback={null}>
        <NotesPanel />
      </Suspense>
    </div>
  );
}
