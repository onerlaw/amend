import { useFileStore } from '@/stores/fileStore';
import { Editor } from './Editor';

export function EditorTabs() {
  const { openFiles, activeFilePath, setActiveFile, closeFile } = useFileStore();

  const handleCloseFile = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    closeFile(path);
  };

  if (openFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-editor-bg text-gray-500">
        <div className="text-center">
          <svg
            className="mx-auto mb-4 h-16 w-16 text-gray-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
          <p>No file open</p>
          <p className="mt-2 text-sm">Select a file from the explorer</p>
        </div>
      </div>
    );
  }

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  return (
    <div className="flex h-full flex-col bg-editor-bg">
      {/* Tab bar */}
      <div className="flex border-b border-editor-border bg-editor-sidebar overflow-x-auto">
        {openFiles.map((file) => (
          <button
            key={file.path}
            onClick={() => setActiveFile(file.path)}
            className={`group flex items-center gap-2 border-r border-editor-border px-3 py-1.5 text-sm ${
              activeFilePath === file.path
                ? 'bg-editor-bg text-white'
                : 'text-editor-text hover:bg-editor-bg/50'
            }`}
          >
            {file.isDirty && (
              <span className="h-2 w-2 rounded-full bg-editor-accent" title="Unsaved changes" />
            )}
            <span className="truncate max-w-[150px]">{file.name}</span>
            <span
              onClick={(e) => handleCloseFile(e, file.path)}
              className="ml-1 rounded p-0.5 opacity-0 hover:bg-editor-border group-hover:opacity-100"
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                <path d="M9.5 3.205L8.795 2.5 6 5.295 3.205 2.5l-.705.705L5.295 6 2.5 8.795l.705.705L6 6.705 8.795 9.5l.705-.705L6.705 6z" />
              </svg>
            </span>
          </button>
        ))}
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        {activeFile && <Editor file={activeFile} />}
      </div>
    </div>
  );
}
