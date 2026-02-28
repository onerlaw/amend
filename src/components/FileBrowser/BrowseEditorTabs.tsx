import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  useState,
} from 'react';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { useFileBrowserState, SaveStatus } from '@/hooks/useFileBrowserState';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { FileContentPanel } from './FileContentPanel';
import { MarkdownPreview } from './MarkdownPreview';
import { CloseIcon, DocumentIcon, EyeIcon, EditIcon } from '@/components/Icons';
import {
  goToDefinitionExtension,
  scrollToLine,
  cmdHeldCursorExtension,
} from '@/extensions/goToDefinition';
import { symbolHoverTooltip } from '@/extensions/hoverTooltip';
import { getOrStartLspClient, releaseLspClient } from '@/lsp/manager';
import type { LSPClient } from '@codemirror/lsp-client';
import { useDraggableTabs } from '@/hooks/useDraggableTabs';
import { ReferencesPanel } from './ReferencesPanel';
import { EditorStatusBar, type EditorInfo } from './EditorStatusBar';

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
      contextPath,
      referencesSymbol,
      showReferencesPanel,
    } = useFileStore();
    const editorViewRef = useRef<EditorView | null>(null);
    const [editorInfo, setEditorInfo] = useState<EditorInfo | null>(null);
    const [isMarkdownPreview, setIsMarkdownPreview] = useState(false);
    const [lspClient, setLspClient] = useState<{
      client: LSPClient;
      languageId: string;
    } | null>(null);

    // Reset preview mode when switching to a non-markdown file
    useEffect(() => {
      if (activeFile?.language !== 'markdown') {
        setIsMarkdownPreview(false);
      }
    }, [browseActiveFilePath, activeFile?.language]);

    // Start/stop LSP client when file or context changes (skip for large files)
    useEffect(() => {
      if (!activeFile?.path || !contextPath || activeFile.isLargeFile) {
        setLspClient(null);
        return;
      }

      const ext = activeFile.path.split('.').pop() || '';
      let cancelled = false;

      getOrStartLspClient(ext, contextPath).then((result) => {
        if (!cancelled) {
          setLspClient(result);
        }
      });

      return () => {
        cancelled = true;
        releaseLspClient(ext, contextPath);
      };
    }, [activeFile?.path, activeFile?.isLargeFile, contextPath]);
    const { getTabDragProps, containerRef, dropIndicatorIndex, dragFromIndex } = useDraggableTabs({
      itemCount: browseOpenFiles.length,
      onReorder: reorderBrowseFiles,
    });

    // Build navigation extensions keyed on the active file path
    const additionalExtensions = useMemo(() => {
      if (!activeFile?.path) return [];

      const currentFilePath = activeFile.path;
      const projectRoot = contextPath || '';
      const isLarge = activeFile.isLargeFile;

      const extensions = [
        // Cursor position listener (always active, for status bar line/col info)
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) {
            const state = update.state;
            const primary = state.selection.main;
            const line = state.doc.lineAt(primary.head);
            const selectedChars = state.selection.ranges.reduce(
              (sum, r) => sum + Math.abs(r.to - r.from),
              0
            );
            const selectedLines =
              selectedChars > 0
                ? state.doc.lineAt(primary.to).number - state.doc.lineAt(primary.from).number + 1
                : 0;
            setEditorInfo({
              line: line.number,
              col: primary.head - line.from + 1,
              selectedChars,
              selectedLines,
              cursors: state.selection.ranges.length,
              totalLines: state.doc.lines,
            });
          }
        }),
      ];

      // Skip navigation and LSP extensions for large files
      if (!isLarge) {
        extensions.push(
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
          cmdHeldCursorExtension()
        );

        // Wire in LSP diagnostics + hover when a server is available
        if (lspClient) {
          const fileUri = `file://${currentFilePath}`;
          extensions.push(lspClient.client.plugin(fileUri, lspClient.languageId));
        }
      }

      return extensions;
    }, [
      activeFile?.path,
      activeFile?.isLargeFile,
      openBrowseFileAtLine,
      contextPath,
      showReferencesPanel,
      lspClient,
    ]);

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
        <div
          ref={containerRef}
          className="flex bg-surface-2 overflow-x-auto px-1 pt-1 gap-0.5 items-end"
        >
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
                  className={`group flex items-center gap-1.5 px-2 py-1 text-xs ${
                    browseActiveFilePath === file.path
                      ? 'bg-surface-0 text-primary'
                      : 'text-secondary hover:bg-surface-1 opacity-50 hover:opacity-75'
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
          {activeFile?.language === 'markdown' && (
            <div className="ml-auto flex-shrink-0 flex items-center px-2 pb-1">
              <button
                onClick={() => setIsMarkdownPreview((v) => !v)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-secondary hover:text-primary hover:bg-surface-3 transition-colors"
              >
                {isMarkdownPreview ? (
                  <>
                    <EditIcon className="h-3 w-3" />
                    Edit
                  </>
                ) : (
                  <>
                    <EyeIcon className="h-3 w-3" />
                    Preview
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* References panel */}
        {referencesSymbol && <ReferencesPanel />}

        {/* Editor content */}
        <div className="flex-1 min-h-0">
          {activeFile &&
            (isMarkdownPreview && activeFile.language === 'markdown' ? (
              <MarkdownPreview content={activeFile.content} />
            ) : (
              <FileContentPanel
                file={activeFile}
                onContentChange={(content) => handleContentChange(activeFile.path, content)}
                onEditorView={handleEditorView}
                additionalExtensions={additionalExtensions}
              />
            ))}
        </div>

        {/* Status bar */}
        {activeFile && (
          <EditorStatusBar file={activeFile} contextPath={contextPath} editorInfo={editorInfo} />
        )}
      </div>
    );
  }
);
