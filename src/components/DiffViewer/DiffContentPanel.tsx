import { Virtuoso } from 'react-virtuoso';
import { useDiffViewerState } from '@/hooks/useDiffViewerState';
import { useUIStore } from '@/stores/uiStore';
import { DiffFileSection } from './DiffFileSection';
import '@/styles/highlight-theme.css';

export function DiffContentPanel() {
  const {
    currentDirectory,
    allFiles,
    diffs,
    collapsedDiffFiles,
    virtuosoRef,
    toggleDiffFileCollapse,
    handleEditFile,
  } = useDiffViewerState();
  const { setFocusedPanel } = useUIStore();

  // No directory open state
  if (!currentDirectory) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-surface-0 px-6 text-center">
        <svg
          className="h-16 w-16 text-tertiary mb-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
        <h3 className="text-lg font-medium text-primary mb-2">No Repository Open</h3>
        <p className="text-sm text-tertiary max-w-sm">
          Use "Open Repo" (Cmd+O) to open a Git repository and view changes.
        </p>
      </div>
    );
  }

  const changedFilesCount = allFiles.length;

  return (
    <div className="h-full overflow-hidden bg-surface-0 flex flex-col" onClick={() => setFocusedPanel('editor')}>
      {changedFilesCount === 0 && (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <svg
            className="h-12 w-12 text-green-500 mb-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="text-sm font-medium text-primary mb-1">No Changes</h3>
          <p className="text-xs text-tertiary">Working tree is clean</p>
        </div>
      )}

      {changedFilesCount > 0 && (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between bg-surface-2 px-3 py-1.5">
            <span className="text-xs text-tertiary">
              {changedFilesCount} file{changedFilesCount !== 1 ? 's' : ''} changed
            </span>
          </div>

          {/* Virtualized diff list */}
          <Virtuoso
            ref={virtuosoRef}
            className="flex-1"
            data={allFiles}
            itemContent={(_index, file) => {
              const diffData = diffs.get(file.path);
              return (
                <DiffFileSection
                  key={`${file.category}-${file.path}`}
                  filePath={file.path}
                  category={file.category}
                  oldContent={diffData?.oldContent ?? ''}
                  newContent={diffData?.newContent ?? ''}
                  isCollapsed={collapsedDiffFiles.has(file.path)}
                  isLoading={diffData?.isLoading ?? true}
                  error={diffData?.error ?? null}
                  onToggleCollapse={() => toggleDiffFileCollapse(file.path)}
                  onEditFile={handleEditFile}
                />
              );
            }}
          />
        </>
      )}
    </div>
  );
}
