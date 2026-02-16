import { useEffect, useCallback, RefObject } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useCloseTerminal } from '@/hooks/useTerminalLifecycle';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useNotesStore } from '@/stores/notesStore';
import { copyEntry, moveEntry, getClipboardFilePaths } from '@/lib/tauri';
import { basename, join } from '@/lib/pathUtils';
import type { TerminalTabsHandle } from '@/components/Terminal/TerminalTabs';
import type { BrowseEditorTabsHandle } from '@/components/FileBrowser/BrowseEditorTabs';

interface CommandRefs {
  terminalTabsRef: RefObject<TerminalTabsHandle | null>;
  browseEditorTabsRef: RefObject<BrowseEditorTabsHandle | null>;
}

/**
 * Centralized keyboard shortcut handler. Registers all global shortcuts
 * and wires them to the appropriate store actions or ref methods.
 */
export function useCommands({ terminalTabsRef, browseEditorTabsRef }: CommandRefs) {
  const { panelMode } = useUIStore();
  const { tabs, activeTabId, setActiveTab } = useTerminalStore();
  const { browseActiveFilePath, closeBrowseFile, contextPath } = useFileStore();
  const closeTerminal = useCloseTerminal();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      switch (e.key) {
        // Cmd/Ctrl + T: New terminal (home dir)
        case 't': {
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

        // Cmd/Ctrl + `: Cycle terminals
        case '`': {
          e.preventDefault();
          if (tabs.length > 1 && activeTabId) {
            const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
            const nextIndex = (currentIndex + 1) % tabs.length;
            setActiveTab(tabs[nextIndex].id);
          }
          return;
        }

        // Cmd/Ctrl + F (without Shift): Find in file (browse mode)
        case 'f': {
          if (!e.shiftKey && panelMode === 'browse' && browseActiveFilePath) {
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
              closeTerminal(activeTabId);
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
      closeTerminal,
      panelMode,
      browseActiveFilePath,
      closeBrowseFile,
      terminalTabsRef,
      browseEditorTabsRef,
      contextPath,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
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

        while (true) {
          try {
            await copyEntry(srcPath, destPath);
            break;
          } catch {
            destPath = join(contextPath, `${baseName} (${counter})${ext}`);
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
