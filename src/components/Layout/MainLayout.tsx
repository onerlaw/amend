import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '@/stores/uiStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useGitPolling } from '@/hooks/useGit';
import { useTheme } from '@/hooks/useTheme';
import { useCommands } from '@/hooks/useCommands';
import { TerminalTabs, TerminalTabsHandle } from '@/components/Terminal/TerminalTabs';
import { DiffViewerProvider } from '@/components/DiffViewer/DiffViewerContext';
import type { BrowseEditorTabsHandle } from '@/components/FileBrowser/BrowseEditorTabs';
import { GlobalSearch } from '@/components/GlobalSearch/GlobalSearch';
import { ModalOverlay } from '@/components/ModalOverlay';
import { indexProject, getGitRoot } from '@/lib/tauri';
import { formatShortcut } from '@/lib/fileUtils';
import {
  PlusIcon,
  CloseIcon,
  InfoIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  SidebarIcon,
  NotesIcon,
  BranchIcon,
  FolderIcon,
} from '@/components/Icons';
import { useNotesStore } from '@/stores/notesStore';
import { WorktreeManager } from '@/components/WorktreeManager';
import { useCreateTerminal } from '@/hooks/useTerminal';

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

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="w-80 rounded-xl bg-surface-2 p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="rounded-md p-1 text-secondary hover:bg-surface-3">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 text-xs">
          {[
            ['New Terminal', formatShortcut('Mod+T')],
            ['Open Folder', formatShortcut('Mod+O')],
            ['Cycle Terminals', formatShortcut('Mod+`')],
            ['Close Tab', formatShortcut('Mod+W')],
            ['Search', `${formatShortcut('Mod+P')} / ${formatShortcut('Mod+Shift+F')}`],
            ['Find in File', formatShortcut('Mod+F')],
            ['Go to Line', formatShortcut('Mod+G')],
            ['Fold Code', formatShortcut('Mod+Shift+[')],
            ['Unfold Code', formatShortcut('Mod+Shift+]')],
            ['Paste Files', formatShortcut('Mod+V')],
            ['Toggle Notes', formatShortcut('Mod+Shift+N')],
            ['Increase Font Size', formatShortcut('Mod+=')],
            ['Decrease Font Size', formatShortcut('Mod+-')],
            ['Reset Font Size', formatShortcut('Mod+0')],
          ].map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between py-1">
              <span className="text-primary">{label}</span>
              <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </ModalOverlay>
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
  const { browseOpenFiles, syncTabContext, contextPath } = useFileStore();
  const { tabs, activeTabId } = useTerminalStore();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showWorktrees, setShowWorktrees] = useState(false);
  const createTerminal = useCreateTerminal();
  const terminalTabsRef = useRef<TerminalTabsHandle>(null);
  const browseEditorTabsRef = useRef<BrowseEditorTabsHandle>(null);
  const gitPolling = useGitPolling(contextPath);
  const diffStats = gitPolling.diffStats;

  // Centralized keyboard shortcuts
  useCommands({ terminalTabsRef, browseEditorTabsRef });

  // One-time cleanup of legacy localStorage data
  useEffect(() => {
    localStorage.removeItem('amend-projects');
    localStorage.removeItem('amend-files');
  }, []);

  // Derive active tab's cwd outside the effect so it only re-runs when the cwd changes
  const activeTabCwd = tabs.find((t) => t.id === activeTabId)?.cwd;

  // Sync file tree context with active terminal's cwd via git root detection
  useEffect(() => {
    console.log('[CWD] MainLayout effect fired:', { activeTabCwd });
    if (!activeTabCwd) return;
    let cancelled = false;

    getGitRoot(activeTabCwd).then((gitRoot) => {
      console.log('[CWD] getGitRoot resolved:', { activeTabCwd, gitRoot });
      if (!cancelled) {
        syncTabContext(gitRoot);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTabCwd, syncTabContext]);

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
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {/* Worktree Manager Modal */}
      {showWorktrees && contextPath && (
        <WorktreeManager
          repoPath={contextPath}
          onClose={() => setShowWorktrees(false)}
          createTerminal={createTerminal}
        />
      )}

      {/* Floating Notes Panel */}
      <Suspense fallback={null}>
        <NotesPanel />
      </Suspense>
    </div>
  );
}
