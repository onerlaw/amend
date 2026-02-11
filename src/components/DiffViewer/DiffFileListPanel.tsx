import { useDiffViewer } from './DiffViewerContext';
import { DiffFileList } from './DiffFileList';
import { useUIStore } from '@/stores/uiStore';
import { PanelHeader } from '@/components/FileTree/TreePrimitives';

export function DiffFileListPanel() {
  const { status, statusLoading, allFiles, contextPath, handleRefresh, handleScrollToFile } =
    useDiffViewer();
  const selectedDiffFile = useUIStore((s) => s.selectedDiffFile);
  const setSelectedDiffFile = useUIStore((s) => s.setSelectedDiffFile);

  const changedFilesCount = allFiles.length;

  return (
    <div className="h-full bg-surface-2 flex flex-col">
      <PanelHeader title="Changes" badge={changedFilesCount} onRefresh={handleRefresh} />
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
