import { useDiffViewer } from './DiffViewerContext';
import { DiffFileList } from './DiffFileList';
import { RefreshIcon } from '@/components/Icons';
import { useUIStore } from '@/stores/uiStore';

export function DiffFileListPanel() {
  const { status, statusLoading, allFiles, contextPath, handleRefresh, handleScrollToFile } =
    useDiffViewer();
  const selectedDiffFile = useUIStore((s) => s.selectedDiffFile);
  const setSelectedDiffFile = useUIStore((s) => s.setSelectedDiffFile);

  const changedFilesCount = allFiles.length;

  return (
    <div className="h-full bg-surface-2 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            Changes
          </span>
          {changedFilesCount > 0 && (
            <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-medium text-white">
              {changedFilesCount}
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-md p-1 text-secondary hover:bg-surface-3"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <DiffFileList
          status={status}
          onScrollToFile={handleScrollToFile}
          isLoading={statusLoading}
          onRefresh={handleRefresh}
          repoPath={contextPath}
          selectedFile={selectedDiffFile}
          onSelectFile={setSelectedDiffFile}
        />
      </div>
    </div>
  );
}
