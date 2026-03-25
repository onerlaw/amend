import { useEffect, useCallback, RefObject } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useCreateTerminal } from '@/hooks/useTerminalLifecycle';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useNotesStore } from '@/stores/notesStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves, findNode } from '@/lib/layoutTree';
import { copyEntry, moveEntry, getClipboardFilePaths } from '@/lib/tauri';
import { basename, join } from '@/lib/pathUtils';
import type { TerminalTabsHandle } from '@/components/Terminal/TerminalTabs';
import type { BrowseEditorTabsHandle } from '@/components/FileBrowser/BrowseEditorTabs';
import type { TerminalTab } from '@/stores/terminalStore';

interface CommandRefs {
  terminalTabsRef: RefObject<TerminalTabsHandle | null>;
  browseEditorTabsRef: RefObject<BrowseEditorTabsHandle | null>;
  onOpenWorktrees?: () => void;
}

/**
 * Centralized keyboard shortcut handler. Registers all global shortcuts
 * and wires them to the appropriate store actions or ref methods.
 */
export function useCommands({
  terminalTabsRef,
  browseEditorTabsRef,
  onOpenWorktrees,
}: CommandRefs) {
  const { panelMode } = useUIStore();
  const { tabs, activeTabId, setActiveTab } = useTerminalStore();
  const { browseActiveFilePath, closeBrowseFile, contextPath } = useFileStore();
  const createTerminal = useCreateTerminal();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + Alt + Arrow: Navigate focus between panes (no switch needed)
      if (mod && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const layoutState = useTerminalLayoutStore.getState();
        const { layout, focusedPaneId, setFocusedPane } = layoutState;
        if (!layout || !focusedPaneId) return;

        const leaves = collectLeaves(layout);
        if (leaves.length <= 1) return;

        const currentIdx = leaves.findIndex((l) => l.id === focusedPaneId);
        if (currentIdx === -1) return;

        let nextIdx: number;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          nextIdx = (currentIdx - 1 + leaves.length) % leaves.length;
        } else {
          nextIdx = (currentIdx + 1) % leaves.length;
        }
        setFocusedPane(leaves[nextIdx].id);
        return;
      }

      // Cmd/Ctrl + Shift + [ or ]: Cycle through terminals within focused pane
      if (mod && e.shiftKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const layoutState = useTerminalLayoutStore.getState();
        const { layout, focusedPaneId, setActiveTerminalInPane } = layoutState;
        if (!layout || !focusedPaneId) return;

        const target = findNode(layout, focusedPaneId);
        if (!target || target.type !== 'leaf' || target.terminalIds.length <= 1) return;

        const currentIdx = target.terminalIds.indexOf(target.activeTerminalId);
        const len = target.terminalIds.length;
        const nextIdx = e.key === '[' ? (currentIdx - 1 + len) % len : (currentIdx + 1) % len;
        setActiveTerminalInPane(focusedPaneId, target.terminalIds[nextIdx]);
        return;
      }

      if (!mod) return;

      switch (e.key) {
        // Cmd/Ctrl + T: New terminal (home dir) or new worktree
        case 't': {
          if (e.shiftKey) {
            e.preventDefault();
            onOpenWorktrees?.();
            return;
          }
          e.preventDefault();
          terminalTabsRef.current?.openNewTerminal();
          return;
        }

        // Cmd/Ctrl + O: Open folder
        case 'o': {
          e.preventDefault();
          terminalTabsRef.current?.openFolder();
          return;
        }

        // Cmd/Ctrl + `: Cycle focus between visible panes
        case '`': {
          e.preventDefault();
          const layoutState = useTerminalLayoutStore.getState();
          const { layout, focusedPaneId, setFocusedPane } = layoutState;
          if (layout) {
            const leaves = collectLeaves(layout);
            if (leaves.length > 1 && focusedPaneId) {
              const currentIdx = leaves.findIndex((l) => l.id === focusedPaneId);
              const nextIdx = (currentIdx + 1) % leaves.length;
              setFocusedPane(leaves[nextIdx].id);
            }
          } else if (tabs.length > 1 && activeTabId) {
            const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
            const nextIndex = (currentIndex + 1) % tabs.length;
            setActiveTab(tabs[nextIndex].id);
          }
          return;
        }

        // Cmd/Ctrl + D: Split focused pane horizontally (new terminal right)
        case 'd': {
          if (!e.shiftKey) {
            e.preventDefault();
            handleSplitPane('horizontal', createTerminal, tabs, activeTabId);
          } else {
            // Cmd/Ctrl + Shift + D: Split focused pane vertically (new terminal bottom)
            e.preventDefault();
            handleSplitPane('vertical', createTerminal, tabs, activeTabId);
          }
          return;
        }
        case 'D': {
          if (e.shiftKey) {
            e.preventDefault();
            handleSplitPane('vertical', createTerminal, tabs, activeTabId);
          }
          return;
        }

        // Cmd/Ctrl + S: Save active file immediately
        case 's': {
          e.preventDefault();
          browseEditorTabsRef.current?.saveActiveFile();
          return;
        }

        // Cmd/Ctrl + F (without Shift): Find in file (browse mode) or terminal search
        case 'f': {
          if (e.shiftKey) return;
          const { focusedPanel } = useUIStore.getState();
          if (focusedPanel === 'terminal') {
            e.preventDefault();
            const { focusedPaneId, searchingPaneId, setSearchingPaneId } =
              useTerminalLayoutStore.getState();
            if (focusedPaneId) {
              setSearchingPaneId(searchingPaneId === focusedPaneId ? null : focusedPaneId);
            }
          } else if (panelMode === 'browse' && browseActiveFilePath) {
            e.preventDefault();
            browseEditorTabsRef.current?.openSearch();
          }
          return;
        }

        // Cmd/Ctrl + V: Paste files into file browser
        case 'v': {
          handlePasteFiles(e, contextPath, panelMode);
          return;
        }

        // Cmd/Ctrl + Shift + N: Toggle notes panel
        case 'n':
        case 'N': {
          if (e.shiftKey) {
            e.preventDefault();
            useNotesStore.getState().toggleNotes();
          }
          return;
        }

        // Cmd/Ctrl + = or +: Increase font size
        case '=':
        case '+': {
          e.preventDefault();
          useUIStore.getState().increaseFontSize();
          return;
        }

        // Cmd/Ctrl + -: Decrease font size
        case '-': {
          e.preventDefault();
          useUIStore.getState().decreaseFontSize();
          return;
        }

        // Cmd/Ctrl + 0: Reset font size
        case '0': {
          e.preventDefault();
          useUIStore.getState().resetFontSize();
          return;
        }

        // Cmd/Ctrl + W: Close current tab or notes panel
        case 'w': {
          e.preventDefault();

          // Close notes panel if it's focused
          const notesPanel = document.querySelector('[data-notes-panel]');
          if (notesPanel && notesPanel.contains(document.activeElement)) {
            useNotesStore.getState().toggleNotes();
            return;
          }

          const { focusedPanel } = useUIStore.getState();

          if (focusedPanel === 'terminal') {
            if (tabs.length > 1 && activeTabId) {
              terminalTabsRef.current?.requestClose(activeTabId);
            }
          } else if (focusedPanel === 'editor') {
            if (panelMode === 'browse' && browseActiveFilePath) {
              closeBrowseFile(browseActiveFilePath);
            }
          }
          return;
        }
      }
    },
    [
      tabs,
      activeTabId,
      setActiveTab,
      createTerminal,
      panelMode,
      browseActiveFilePath,
      closeBrowseFile,
      terminalTabsRef,
      browseEditorTabsRef,
      contextPath,
      onOpenWorktrees,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

async function handleSplitPane(
  direction: 'horizontal' | 'vertical',
  createTerminal: (cwd: string, afterTabId?: string) => Promise<string>,
  tabs: TerminalTab[],
  activeTabId: string | null
) {
  const { focusedPaneId, splitPane, layout } = useTerminalLayoutStore.getState();
  if (!focusedPaneId || !layout) return;

  const target = findNode(layout, focusedPaneId);
  if (!target || target.type !== 'leaf') return;

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const cwd = activeTab?.cwd;
  if (!cwd) return;

  try {
    const newId = await createTerminal(cwd, activeTabId ?? undefined);
    splitPane(focusedPaneId, direction, 'second', newId);
  } catch (err) {
    console.error('Failed to create terminal for split:', err);
  }
}

function handlePasteFiles(e: KeyboardEvent, contextPath: string | null, panelMode: string | null) {
  const { focusedPanel } = useUIStore.getState();
  if (panelMode !== 'browse' || focusedPanel !== 'file-list' || !contextPath) return;

  e.preventDefault();

  const { clipboard, clearClipboard } = useContextMenuStore.getState();

  // Priority 1: internal clipboard (cut/copy from context menu)
  if (clipboard.entry && clipboard.operation) {
    const destPath = join(contextPath, clipboard.entry.name);
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
        const fileName = basename(srcPath) || 'file';
        let destPath = join(contextPath, fileName);

        // Collision handling: name (1).ext, name (2).ext, etc.
        let counter = 1;
        const dot = fileName.lastIndexOf('.');
        const baseName = dot > 0 ? fileName.slice(0, dot) : fileName;
        const ext = dot > 0 ? fileName.slice(dot) : '';

        while (counter <= 100) {
          try {
            await copyEntry(srcPath, destPath);
            break;
          } catch (copyErr) {
            const msg = String(copyErr);
            // Only retry with incremented name on "already exists" collisions
            if (!msg.includes('exists')) {
              console.error('Failed to paste file:', copyErr);
              break;
            }
            destPath = join(contextPath, `${baseName} (${counter})${ext}`);
            counter++;
          }
        }
      }
      useFileStore.getState().invalidateFileTree();
    } catch (err) {
      console.error('Failed to paste files from clipboard:', err);
    }
  })();
}
