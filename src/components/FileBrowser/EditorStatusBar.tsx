import type { OpenFile } from '@/stores/fileStore';

export interface EditorInfo {
  line: number;
  col: number;
  selectedChars: number;
  selectedLines: number;
  cursors: number;
  totalLines: number;
}

interface EditorStatusBarProps {
  file: OpenFile;
  contextPath: string | null;
  editorInfo: EditorInfo | null;
}

export function EditorStatusBar({ file, contextPath, editorInfo }: EditorStatusBarProps) {
  const relativePath =
    contextPath && file.path.startsWith(contextPath)
      ? file.path.slice(contextPath.length + 1)
      : file.path;

  return (
    <div className="flex items-center justify-between px-2 py-0.5 bg-surface-2 text-tertiary text-xs border-t border-border select-text">
      <span className="truncate mr-4">{relativePath}</span>
      {editorInfo && (
        <div className="flex items-center gap-3 shrink-0">
          <span>
            Ln {editorInfo.line}, Col {editorInfo.col}
          </span>
          {editorInfo.selectedChars > 0 && (
            <span>
              {editorInfo.selectedChars} selected
              {editorInfo.selectedLines > 1 && ` (${editorInfo.selectedLines} lines)`}
            </span>
          )}
          {editorInfo.cursors > 1 && <span>{editorInfo.cursors} cursors</span>}
          <span>Spaces: 2</span>
          {file.language && <span>{file.language}</span>}
          <span>{editorInfo.totalLines} lines</span>
        </div>
      )}
    </div>
  );
}
