import { Virtuoso } from 'react-virtuoso';
import { useDiffViewer } from './DiffViewerContext';
import { useUIStore } from '@/stores/uiStore';
import { DiffFileSection } from './DiffFileSection';
import { DocumentIcon, CheckCircleIcon, SidebarIcon } from '@/components/Icons';
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
  } = useDiffViewer();
  const { diffFileListVisible, toggleDiffFileList, setFocusedPanel } = useUIStore();

  // No directory open state
  if (!currentDirectory) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-surface-0 px-6 text-center">
        <DocumentIcon className="h-16 w-16 text-tertiary mb-4" />
        <h3 className="text-lg font-medium text-primary mb-2">No Repository Open</h3>
        <p className="text-sm text-tertiary max-w-sm">
          Use "Open Repo" (Cmd+O) to open a Git repository and view changes.
        </p>
      </div>
    );
  }

  const changedFilesCount = allFiles.length;

  return (
    <div
      className="h-full overflow-hidden bg-surface-0 flex flex-col"
      onClick={() => setFocusedPanel('editor')}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between bg-surface-2 px-3 py-1.5">
        <span className="text-xs text-tertiary">
          {changedFilesCount > 0
            ? `${changedFilesCount} file${changedFilesCount !== 1 ? 's' : ''} changed`
            : 'No changes'}
        </span>
        <button
          onClick={toggleDiffFileList}
          className={`rounded-md p-1 ${
            diffFileListVisible
              ? 'text-accent hover:bg-surface-3'
              : 'text-secondary hover:bg-surface-3'
          }`}
          title={diffFileListVisible ? 'Hide file list' : 'Show file list'}
        >
          <SidebarIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {changedFilesCount === 0 && (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <CheckCircleIcon className="h-12 w-12 text-green-500 mb-3" />
          <h3 className="text-sm font-medium text-primary mb-1">No Changes</h3>
          <p className="text-xs text-tertiary">Working tree is clean</p>
        </div>
      )}

      {changedFilesCount > 0 && (
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
                isBinary={diffData?.isBinary ?? false}
                isCollapsed={collapsedDiffFiles.has(file.path)}
                isLoading={diffData?.isLoading ?? true}
                error={diffData?.error ?? null}
                onToggleCollapse={() => toggleDiffFileCollapse(file.path)}
                onEditFile={handleEditFile}
              />
            );
          }}
        />
      )}
    </div>
  );
}
