import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '@/stores/uiStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useGitPolling } from '@/hooks/useGit';
import { useCommands } from '@/hooks/useCommands';
import type { TerminalTabsHandle } from '@/components/Terminal/TerminalTabs';
import { DiffViewerProvider } from '@/components/DiffViewer/DiffViewerContext';
import type { BrowseEditorTabsHandle } from '@/components/FileBrowser/BrowseEditorTabs';
import { GlobalSearch } from '@/components/GlobalSearch/GlobalSearch';
import {
  indexProject,
  getGitRoot,
  onFsChanged,
  startWatchingDirectory,
  recordEvent,
} from '@/lib/tauri';
import { startTerminalMetadataSync, stopTerminalMetadataSync } from '@/lib/terminalMetadataSync';
import { formatShortcut, openFileInBrowseMode } from '@/lib/fileUtils';
import { useSessionStore } from '@/stores/sessionStore';
import {
  PlusIcon,
  SettingsIcon,
  SidebarIcon,
  NotesIcon,
  BranchIcon,
  FolderIcon,
  EyeIcon,
} from '@/components/Icons';
import { useNotesStore } from '@/stores/notesStore';
import { WorktreeManager } from '@/components/WorktreeManager';
import { useCreateTerminal } from '@/hooks/useTerminalLifecycle';

const ReviewPanel = lazy(() =>
  import('@/components/AgentWorkspace/ReviewPanel').then((m) => ({
    default: m.ReviewPanel,
  }))
);
const TerminalTabs = lazy(() =>
  import('@/components/Terminal/TerminalTabs').then((m) => ({
    default: m.TerminalTabs,
  }))
);
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
const SettingsPanel = lazy(() =>
  import('@/components/Settings/SettingsPanel').then((m) => ({
    default: m.SettingsPanel,
  }))
);
const SessionTimeline = lazy(() =>
  import('@/components/Timeline/SessionTimeline').then((m) => ({
    default: m.SessionTimeline,
  }))
);
const SnapshotPanel = lazy(() =>
  import('@/components/Snapshots/SnapshotPanel').then((m) => ({
    default: m.SnapshotPanel,
  }))
);

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
  const { browseOpenFiles, browseActiveFilePath, savedBrowseState, syncTabContext, contextPath } =
    useFileStore();
  const { tabs, activeTabId } = useTerminalStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showWorktrees, setShowWorktrees] = useState(false);
  const [showAgentWorkspaces, setShowAgentWorkspaces] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const createTerminal = useCreateTerminal();
  const terminalTabsRef = useRef<TerminalTabsHandle>(null);
  const browseEditorTabsRef = useRef<BrowseEditorTabsHandle>(null);
  const restoredContextsRef = useRef<Set<string>>(new Set());
  const gitPolling = useGitPolling(contextPath);
  const diffStats = gitPolling.diffStats;
  const gitStatus = gitPolling.status;

  // Centralized keyboard shortcuts
  useCommands({ terminalTabsRef, browseEditorTabsRef });

  // One-time cleanup of legacy localStorage data
  useEffect(() => {
    localStorage.removeItem('amend-projects');
    localStorage.removeItem('amend-files');
  }, []);

  // Start terminal metadata sync (frontend → backend for MCP server)
  useEffect(() => {
    startTerminalMetadataSync();
    return () => stopTerminalMetadataSync();
  }, []);

  // Save browse state to session whenever it changes
  useEffect(() => {
    if (!contextPath) return;
    const merged: Record<string, { paths: string[]; activePath: string | null }> = {};
    for (const [ctx, state] of Object.entries(savedBrowseState)) {
      merged[ctx] = { paths: state.files.map((f) => f.path), activePath: state.activePath };
    }
    merged[contextPath] = {
      paths: browseOpenFiles.map((f) => f.path),
      activePath: browseActiveFilePath,
    };
    useSessionStore.getState().saveBrowseState(merged);
  }, [browseOpenFiles, browseActiveFilePath, contextPath, savedBrowseState]);

  // Restore browse files from session when switching to a new context (once per session per context)
  useEffect(() => {
    if (!contextPath) return;
    if (restoredContextsRef.current.has(contextPath)) return;
    restoredContextsRef.current.add(contextPath);

    const { browseFilePaths } = useSessionStore.getState();
    const savedContext = browseFilePaths[contextPath];
    if (!savedContext || savedContext.paths.length === 0) return;

    // Skip if in-memory state already has files (restored by syncTabContext)
    const { browseOpenFiles: currentFiles } = useFileStore.getState();
    if (currentFiles.length > 0) return;

    const { activePath } = savedContext;
    Promise.allSettled(savedContext.paths.map((path) => openFileInBrowseMode(path))).then(() => {
      if (activePath) {
        useFileStore.getState().setBrowseActiveFile(activePath);
      }
    });
  }, [contextPath]);

  // Derive active tab's cwd and gitRoot outside the effect so it only re-runs when they change
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeTabCwd = activeTab?.cwd;
  const activeTabGitRoot = activeTab?.gitRoot;

  // Sync file tree context with active terminal's cwd / git root.
  // Re-fires when gitRoot changes (e.g. after `git init` is detected by polling).
  useEffect(() => {
    if (import.meta.env.DEV)
      console.log('[CWD] MainLayout effect fired:', { activeTabCwd, activeTabGitRoot });
    if (!activeTabCwd) return;

    // If useTabGitRoots has already resolved the git root, use it directly
    // instead of making a redundant async getGitRoot call.
    if (activeTabGitRoot !== undefined) {
      syncTabContext(activeTabGitRoot);
      return;
    }

    // Fallback for the brief window before useTabGitRoots resolves
    let cancelled = false;
    getGitRoot(activeTabCwd).then((gitRoot) => {
      if (import.meta.env.DEV) console.log('[CWD] getGitRoot resolved:', { activeTabCwd, gitRoot });
      if (!cancelled) {
        syncTabContext(gitRoot);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTabCwd, activeTabGitRoot, syncTabContext]);

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

  // Re-index symbols and refresh git polling on file system changes
  useEffect(() => {
    if (!contextPath) return;
    let indexTimer: ReturnType<typeof setTimeout> | null = null;
    let gitTimer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | undefined;

    // Ensure the file watcher is active for this directory
    startWatchingDirectory(contextPath).catch((err) => {
      console.error('[MainLayout] Failed to start file watcher:', err);
    });

    onFsChanged((paths) => {
      // Record file change event
      if (contextPath) {
        recordEvent({
          type: 'fileChanged',
          timestamp: Date.now(),
          path: paths.length > 0 ? paths[0] : contextPath,
          changeType: paths.length > 1 ? `${paths.length} files` : 'modified',
        }, useTerminalStore.getState().activeTabId ?? undefined).catch(console.error);
      }

      // Debounced re-index (5s)
      if (indexTimer) clearTimeout(indexTimer);
      indexTimer = setTimeout(() => {
        indexTimer = null;
        indexProject(contextPath).catch((err) => {
          console.error('[MainLayout] Failed to re-index after fs change:', err);
        });
      }, 5000);

      // Debounced git poll (200ms) for fast diff updates
      if (gitTimer) clearTimeout(gitTimer);
      gitTimer = setTimeout(() => {
        gitTimer = null;
        gitPolling.forceCheck();
      }, 200);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      if (indexTimer) clearTimeout(indexTimer);
      if (gitTimer) clearTimeout(gitTimer);
    };
  }, [contextPath, gitPolling.forceCheck]);

  // Record git status changes
  const prevGitStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!contextPath || !gitPolling.status) return;
    const s = gitPolling.status;
    const key = `${s.staged.length}:${s.unstaged.length}:${s.untracked.length}`;
    if (prevGitStatusRef.current === null) {
      // First load — just store without recording
      prevGitStatusRef.current = key;
      return;
    }
    if (key !== prevGitStatusRef.current) {
      prevGitStatusRef.current = key;
      recordEvent({
        type: 'gitStatusChanged',
        timestamp: Date.now(),
        repoPath: contextPath,
        stagedCount: s.staged.length,
        unstagedCount: s.unstaged.length,
        untrackedCount: s.untracked.length,
      }, useTerminalStore.getState().activeTabId ?? undefined).catch(console.error);
    }
  }, [contextPath, gitPolling.status]);

  return (
    <div className="flex h-screen flex-col bg-surface-0">
      {/* Title bar / toolbar */}
      <div className="flex h-14 items-center bg-surface-2 px-4">
        <div className="w-10" />
        <div className="flex flex-1 items-center justify-center gap-3">
          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-md p-1.5 text-secondary hover:bg-surface-3"
            title="Settings"
          >
            <SettingsIcon />
          </button>
          <button
            onClick={toggleNotes}
            className={`rounded-md p-1.5 ${
              notesOpen ? 'bg-accent text-white' : 'text-secondary hover:bg-surface-3'
            }`}
            title={`Notes (${formatShortcut('Mod+Shift+N')})`}
          >
            <NotesIcon />
          </button>
          <button
            onClick={() => contextPath && setShowWorktrees(true)}
            disabled={!contextPath}
            className={`rounded-md p-1.5 ${
              showWorktrees
                ? 'bg-accent text-white'
                : contextPath
                  ? 'text-secondary hover:bg-surface-3'
                  : 'cursor-not-allowed text-tertiary opacity-50'
            }`}
            title="Worktrees"
          >
            <BranchIcon />
          </button>
          <button
            onClick={() => contextPath && setShowAgentWorkspaces(true)}
            disabled={!contextPath}
            className={`rounded-md p-1.5 ${
              showAgentWorkspaces
                ? 'bg-accent text-white'
                : contextPath
                  ? 'text-secondary hover:bg-surface-3'
                  : 'cursor-not-allowed text-tertiary opacity-50'
            }`}
            title="Agent Workspaces"
          >
            <EyeIcon />
          </button>
          <button
            onClick={() => terminalTabsRef.current?.openFolder()}
            className="rounded-md p-1.5 text-secondary hover:bg-surface-3"
            title={`Open Folder (${formatShortcut('Mod+O')})`}
          >
            <FolderIcon />
          </button>
          <button
            onClick={() => terminalTabsRef.current?.openNewTerminal()}
            className="rounded-md p-1.5 text-secondary hover:bg-surface-3"
            title={`New Terminal (${formatShortcut('Mod+T')})`}
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
              {gitStatus && gitStatus.untracked.length > 0 && (
                <span
                  className={`${diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) ? 'ml-1' : 'ml-1.5'} ${panelMode === 'diff' ? 'text-white/80' : 'text-tertiary'}`}
                >
                  ?{gitStatus.untracked.length}
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
            <button
              onClick={() => setPanelMode(panelMode === 'timeline' ? null : 'timeline')}
              className={`rounded-md px-2 py-1 text-xs ${
                panelMode === 'timeline'
                  ? 'bg-accent text-white'
                  : 'text-secondary hover:bg-surface-3'
              }`}
            >
              Timeline
            </button>
            <button
              onClick={() => setShowSnapshots(!showSnapshots)}
              className={`rounded-md px-2 py-1 text-xs ${
                showSnapshots
                  ? 'bg-accent text-white'
                  : 'text-secondary hover:bg-surface-3'
              }`}
            >
              Snapshots
            </button>
          </div>
        </div>
        <div className="flex min-w-[40px] items-center justify-end gap-2">
          {gitPolling.currentBranch && (
            <div
              className="flex items-center gap-1 text-xs text-secondary"
              title={
                gitPolling.currentBranch +
                (activeTab?.worktreeName ? ` (${activeTab.worktreeName})` : '')
              }
            >
              <BranchIcon className="h-3 w-3 shrink-0" />
              <span className="max-w-[120px] truncate">{gitPolling.currentBranch}</span>
              {activeTab?.worktreeName && (
                <span className="max-w-[80px] truncate text-tertiary">
                  ({activeTab.worktreeName})
                </span>
              )}
            </div>
          )}
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
              <Suspense fallback={<div className="h-full bg-terminal-bg" />}>
                <TerminalTabs ref={terminalTabsRef} />
              </Suspense>
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

            {/* Timeline mode */}
            {panelMode === 'timeline' && <PanelResizeHandle />}
            {panelMode === 'timeline' && (
              <Panel id="timeline" order={2} defaultSize={40} minSize={20}>
                <Suspense fallback={null}>
                  <SessionTimeline />
                </Suspense>
              </Panel>
            )}

          </PanelGroup>
        </DiffViewerProvider>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </Suspense>
      )}

      {/* Worktree Manager Modal */}
      {showWorktrees && contextPath && (
        <WorktreeManager
          repoPath={contextPath}
          onClose={() => setShowWorktrees(false)}
          createTerminal={createTerminal}
        />
      )}

      {/* Agent Workspaces Review Panel */}
      {showAgentWorkspaces && contextPath && (
        <Suspense fallback={null}>
          <ReviewPanel
            repoPath={contextPath}
            onClose={() => setShowAgentWorkspaces(false)}
            createTerminal={createTerminal}
          />
        </Suspense>
      )}

      {/* Snapshots Modal */}
      {showSnapshots && (
        <Suspense fallback={null}>
          <SnapshotPanel onClose={() => setShowSnapshots(false)} />
        </Suspense>
      )}

      {/* Floating Notes Panel */}
      <Suspense fallback={null}>
        <NotesPanel />
      </Suspense>
    </div>
  );
}
