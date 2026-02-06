import { useFileBrowserState, SaveStatus } from '@/hooks/useFileBrowserState';
import { useUIStore } from '@/stores/uiStore';
import { FileContentPanel } from './FileContentPanel';
import { CloseIcon } from '@/components/Icons';

function StatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') {
    return null;
  }

  if (status === 'saving') {
    return (
      <span
        className="h-2 w-2 rounded-full bg-blue-500 animate-pulse"
        title="Saving..."
      />
    );
  }

  if (status === 'pending') {
    return (
      <span
        className="h-2 w-2 rounded-full bg-yellow-500"
        title="Unsaved changes (saving soon)"
      />
    );
  }

  if (status === 'error') {
    return (
      <span
        className="h-2 w-2 rounded-full bg-red-500"
        title="Save failed"
      />
    );
  }

  return null;
}

export function BrowseEditorTabs() {
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

  const handleClose = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    handleCloseFile(path);
  };

  if (browseOpenFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-0 text-tertiary">
        <div className="text-center">
          <svg
            className="mx-auto mb-4 h-16 w-16 text-tertiary"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
          <p>No file open</p>
          <p className="mt-2 text-sm">Select a file from the browser</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-0" onClick={() => setFocusedPanel('editor')}>
      {/* Tab bar */}
      <div className="flex bg-surface-2 overflow-x-auto px-1 pt-1 gap-0.5">
        {browseOpenFiles.map((file) => {
          const status = getSaveStatus(file.path);
          return (
            <button
              key={file.path}
              onClick={() => setBrowseActiveFile(file.path)}
              className={`group flex items-center gap-1.5 px-2 py-1 text-xs rounded-t-md ${
                browseActiveFilePath === file.path
                  ? 'bg-surface-0 text-primary'
                  : 'text-secondary hover:bg-surface-1 rounded-md'
              }`}
            >
              <StatusIndicator status={status} />
              <div className="flex flex-col items-start">
                <span className="truncate max-w-[150px]">{file.name}</span>
                {file.language && (
                  <span className="text-[10px] text-tertiary leading-tight">{file.language}</span>
                )}
              </div>
              <span
                onClick={(e) => handleClose(e, file.path)}
                className="rounded-full p-0.5 opacity-0 hover:bg-surface-3 group-hover:opacity-100"
              >
                <CloseIcon />
              </span>
            </button>
          );
        })}
      </div>

      {/* Editor content */}
      <div className="flex-1 min-h-0">
        {activeFile && (
          <FileContentPanel
            file={activeFile}
            onContentChange={(content) => handleContentChange(activeFile.path, content)}
          />
        )}
      </div>
    </div>
  );
}
