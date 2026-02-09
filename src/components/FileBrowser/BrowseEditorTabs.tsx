import { forwardRef, useImperativeHandle, useRef, useCallback, useMemo, useEffect } from 'react';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { useFileBrowserState, SaveStatus } from '@/hooks/useFileBrowserState';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { FileContentPanel } from './FileContentPanel';
import { CloseIcon, DocumentIcon } from '@/components/Icons';
import {
  goToDefinitionExtension,
  symbolHoverTooltip,
  cmdHeldCursorExtension,
  scrollToLine,
} from '@/extensions';
import { useDraggableTabs } from '@/hooks/useDraggableTabs';
import { ReferencesPanel } from './ReferencesPanel';

export interface BrowseEditorTabsHandle {
  openSearch: () => void;
}

const STATUS_CONFIG: Record<string, { color: string; title: string }> = {
  saving: { color: 'bg-blue-500 animate-pulse', title: 'Saving...' },
  pending: { color: 'bg-yellow-500', title: 'Unsaved changes (saving soon)' },
  error: { color: 'bg-red-500', title: 'Save failed' },
};

function StatusIndicator({ status }: { status: SaveStatus }) {
  const config = STATUS_CONFIG[status];
  if (!config) return null;
  return <span className={`h-2 w-2 rounded-full ${config.color}`} title={config.title} />;
}

export const BrowseEditorTabs = forwardRef<BrowseEditorTabsHandle>(
  function BrowseEditorTabs(_, ref) {
    const {
      browseOpenFiles,
      browseActiveFilePath,
      activeFile,
      setBrowseActiveFile,
      handleCloseFile,
      handleContentChange,
      getSaveStatus,
    } = useFileBrowserState();
    const { setFocusedPanel } = useUIStore();
    const {
      openBrowseFileAtLine,
      pendingScrollToLine,
      pendingScrollToFile,
      clearPendingScrollToLine,
      reorderBrowseFiles,
      currentDirectory,
      contextPath,
      referencesSymbol,
      showReferencesPanel,
    } = useFileStore();
    const editorViewRef = useRef<EditorView | null>(null);
    const { getTabDragProps, containerRef, dropIndicatorIndex, dragFromIndex } = useDraggableTabs({
      itemCount: browseOpenFiles.length,
      onReorder: reorderBrowseFiles,
    });

    // Build navigation extensions keyed on the active file path
    const additionalExtensions = useMemo(() => {
      if (!activeFile?.path) return [];

      const currentFilePath = activeFile.path;
      const projectRoot = currentDirectory || '';

      return [
        goToDefinitionExtension({
          currentFilePath,
          projectRoot,
          onNavigate: (file, line) => openBrowseFileAtLine(file, line),
          onLocalNavigate: (line) => {
            const view = editorViewRef.current;
            if (view) scrollToLine(view, line);
          },
          onShowReferences: (symbolName) => showReferencesPanel(symbolName),
        }),
        symbolHoverTooltip({ currentFilePath }),
        cmdHeldCursorExtension(),
      ];
    }, [activeFile?.path, openBrowseFileAtLine, currentDirectory, showReferencesPanel]);

    // Consume pending scroll-to-line state
    useEffect(() => {
      if (
        pendingScrollToLine != null &&
        pendingScrollToFile &&
        pendingScrollToFile === activeFile?.path &&
        editorViewRef.current
      ) {
        scrollToLine(editorViewRef.current, pendingScrollToLine);
        clearPendingScrollToLine();
      }
    }, [pendingScrollToLine, pendingScrollToFile, activeFile?.path, clearPendingScrollToLine]);

    const handleEditorView = useCallback((view: EditorView | null) => {
      editorViewRef.current = view;

      // When a new editor mounts, check if there's a pending scroll for it
      if (view) {
        const state = useFileStore.getState();
        if (
          state.pendingScrollToLine != null &&
          state.pendingScrollToFile &&
          state.pendingScrollToFile === state.browseActiveFilePath
        ) {
          requestAnimationFrame(() => {
            scrollToLine(view, state.pendingScrollToLine!);
            state.clearPendingScrollToLine();
          });
        }
      }
    }, []);

    useImperativeHandle(ref, () => ({
      openSearch() {
        const view = editorViewRef.current;
        if (view) {
          view.focus();
          openSearchPanel(view);
        }
      },
    }));

    const handleClose = (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      handleCloseFile(path);
    };

    if (browseOpenFiles.length === 0) {
      return (
        <div className="flex h-full items-center justify-center bg-surface-0 text-tertiary">
          <div className="text-center">
            <DocumentIcon className="mx-auto mb-4 h-16 w-16 text-tertiary" />
            <p>No file open</p>
            <p className="mt-2 text-sm">Select a file from the browser</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col bg-surface-0" onClick={() => setFocusedPanel('editor')}>
        {/* Tab bar */}
        <div ref={containerRef} className="flex bg-surface-2 overflow-x-auto px-1 pt-1 gap-0.5">
          {browseOpenFiles.map((file, index) => {
            const status = getSaveStatus(file.path);
            return (
              <div key={file.path} className="relative flex">
                {dropIndicatorIndex === index && (
                  <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
                )}
                <button
                  {...getTabDragProps(index)}
                  onClick={() => setBrowseActiveFile(file.path)}
                  className={`group flex items-center gap-1.5 px-2 py-1 text-xs rounded-t-md ${
                    browseActiveFilePath === file.path
                      ? 'bg-surface-0 text-primary'
                      : 'text-secondary hover:bg-surface-1 rounded-md'
                  } ${dragFromIndex === index ? 'opacity-50' : ''}`}
                >
                  <StatusIndicator status={status} />
                  <div className="flex flex-col items-start">
                    <span className="truncate max-w-[150px]">{file.name}</span>
                    {file.language && (
                      <span className="text-[10px] text-tertiary leading-tight">
                        {file.language}
                      </span>
                    )}
                  </div>
                  <span
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => handleClose(e, file.path)}
                    className="rounded-full p-0.5 opacity-0 hover:bg-surface-3 group-hover:opacity-100"
                  >
                    <CloseIcon />
                  </span>
                </button>
              </div>
            );
          })}
          {dropIndicatorIndex === browseOpenFiles.length && (
            <div className="relative flex">
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
            </div>
          )}
        </div>

        {/* References panel */}
        {referencesSymbol && <ReferencesPanel />}

        {/* Editor content */}
        <div className="flex-1 min-h-0">
          {activeFile && (
            <FileContentPanel
              file={activeFile}
              onContentChange={(content) => handleContentChange(activeFile.path, content)}
              onEditorView={handleEditorView}
              additionalExtensions={additionalExtensions}
            />
          )}
        </div>

        {/* File path bar */}
        {activeFile && (
          <div className="flex items-center px-2 py-0.5 bg-surface-2 text-tertiary text-xs border-t border-border truncate select-text">
            {contextPath && activeFile.path.startsWith(contextPath)
              ? activeFile.path.slice(contextPath.length + 1)
              : activeFile.path}
          </div>
        )}
      </div>
    );
  }
);
