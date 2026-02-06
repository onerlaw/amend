import { useDiffViewerState } from '@/hooks/useDiffViewerState';
import { DiffFileList } from './DiffFileList';

export function DiffFileListPanel() {
  const { status, statusLoading, allFiles, contextPath, handleRefresh, handleScrollToFile } =
    useDiffViewerState();

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
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.451 5.609l-.579-.939-1.068.812-.076.094c-.335.415-.927 1.341-1.124 2.876l-.021.165.033.163.071.345c.013.065.027.134.041.204H8.46l3.027 3.097L14.58 8.92l-2.857.07.035-.146.019-.074.012-.039v-.039c.212-1.082.211-2.136-.338-3.083zM6.514 6.027L3.487 2.933.393 6.028l2.86-.07-.037.147-.018.072-.013.04v.04c-.211 1.082-.21 2.136.339 3.083l.578.939 1.068-.812.076-.094c.335-.415.927-1.341 1.124-2.876l.021-.165-.033-.163-.071-.345a7.085 7.085 0 00-.041-.204h2.269L6.514 6.027z" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <DiffFileList
          status={status}
          onScrollToFile={handleScrollToFile}
          isLoading={statusLoading}
          onRefresh={handleRefresh}
          repoPath={contextPath}
        />
      </div>
    </div>
  );
}
