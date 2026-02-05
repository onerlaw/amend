import { useMemo, memo } from 'react';
import * as Diff from 'diff';
import { highlightLine, getLanguageFromPath } from '@/lib/highlight';

interface DiffFileSectionProps {
  filePath: string;
  category: 'staged' | 'unstaged' | 'untracked';
  oldContent: string;
  newContent: string;
  isCollapsed: boolean;
  isLoading: boolean;
  error: string | null;
  onToggleCollapse: () => void;
  onEditFile: (filePath: string) => void;
}

interface DiffLineProps {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
  language?: string;
}

// Memoized diff line component
const DiffLine = memo(function DiffLine({
  type,
  content,
  oldLineNum,
  newLineNum,
  language,
}: DiffLineProps) {
  const bgClass =
    type === 'added'
      ? 'bg-diff-add-bg'
      : type === 'removed'
        ? 'bg-diff-remove-bg'
        : '';

  const prefixClass =
    type === 'added'
      ? 'text-diff-add-text'
      : type === 'removed'
        ? 'text-diff-remove-text'
        : 'text-tertiary';

  const prefix = type === 'added' ? '+' : type === 'removed' ? '-' : ' ';
  const highlightedContent = useMemo(
    () => highlightLine(content, language),
    [content, language]
  );

  return (
    <div className={`flex font-mono text-sm ${bgClass} whitespace-nowrap`}>
      <span className="w-12 flex-shrink-0 select-none px-2 text-right text-tertiary bg-surface-1">
        {oldLineNum ?? ''}
      </span>
      <span className="w-12 flex-shrink-0 select-none px-2 text-right text-tertiary bg-surface-1">
        {newLineNum ?? ''}
      </span>
      <span className={`w-4 flex-shrink-0 text-center ${prefixClass}`}>{prefix}</span>
      <span
        className="px-2 whitespace-pre hljs"
        dangerouslySetInnerHTML={{ __html: highlightedContent }}
      />
    </div>
  );
});

function getStatusBadge(category: 'staged' | 'unstaged' | 'untracked') {
  switch (category) {
    case 'staged':
      return (
        <span className="rounded-md bg-diff-add-bg px-1.5 py-0.5 text-xs font-medium text-diff-add-text">
          Staged
        </span>
      );
    case 'unstaged':
      return (
        <span className="rounded-md bg-amber-100 dark:bg-yellow-600/30 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-yellow-400">
          Changed
        </span>
      );
    case 'untracked':
      return (
        <span className="rounded-md bg-gray-200 dark:bg-gray-600/30 px-1.5 py-0.5 text-xs font-medium text-tertiary">
          Untracked
        </span>
      );
  }
}

// Diff content component
const DiffContent = memo(function DiffContent({
  oldContent,
  newContent,
  filePath,
}: {
  oldContent: string;
  newContent: string;
  filePath: string;
}) {
  const language = getLanguageFromPath(filePath);

  const lines = useMemo(() => {
    const changes = Diff.diffLines(oldContent, newContent);
    const result: Omit<DiffLineProps, 'language'>[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;

    for (const change of changes) {
      const changeLines = change.value.split('\n');
      if (changeLines[changeLines.length - 1] === '') {
        changeLines.pop();
      }

      for (const line of changeLines) {
        if (change.added) {
          result.push({
            type: 'added',
            content: line,
            newLineNum: newLineNum++,
          });
        } else if (change.removed) {
          result.push({
            type: 'removed',
            content: line,
            oldLineNum: oldLineNum++,
          });
        } else {
          result.push({
            type: 'unchanged',
            content: line,
            oldLineNum: oldLineNum++,
            newLineNum: newLineNum++,
          });
        }
      }
    }

    return result;
  }, [oldContent, newContent]);

  if (lines.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-tertiary text-sm">
        No differences (new file)
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-fit">
        {lines.map((line, index) => (
          <DiffLine key={index} {...line} language={language} />
        ))}
      </div>
    </div>
  );
});

export const DiffFileSection = memo(function DiffFileSection({
  filePath,
  category,
  oldContent,
  newContent,
  isCollapsed,
  isLoading,
  error,
  onToggleCollapse,
  onEditFile,
}: DiffFileSectionProps) {
  // Calculate stats from content (only when loaded)
  const { additions, deletions } = useMemo(() => {
    if (isLoading || error || (!oldContent && !newContent)) {
      return { additions: 0, deletions: 0 };
    }

    const changes = Diff.diffLines(oldContent, newContent);
    let adds = 0;
    let dels = 0;

    for (const change of changes) {
      const lineCount = change.value.split('\n').filter((l) => l !== '').length;
      if (change.added) adds += lineCount;
      else if (change.removed) dels += lineCount;
    }

    return { additions: adds, deletions: dels };
  }, [oldContent, newContent, isLoading, error]);

  const fileName = filePath.split('/').pop() || filePath;
  const hasContent = !isLoading && !error && (oldContent || newContent);

  return (
    <div className="m-2">
      {/* Header */}
      <div className={`flex items-center justify-between bg-surface-2 px-3 py-2 rounded-t-md ${isCollapsed ? 'rounded-b-md' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onToggleCollapse}
            className="rounded-md p-0.5 hover:bg-surface-3"
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            <svg
              className={`h-4 w-4 text-tertiary transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M6 4l4 4-4 4V4z" />
            </svg>
          </button>

          <span className="text-sm text-primary truncate" title={filePath}>
            {fileName}
          </span>

          {getStatusBadge(category)}

          {hasContent && (
            <div className="flex items-center gap-2 text-xs">
              {additions > 0 && <span className="text-diff-add-text">+{additions}</span>}
              {deletions > 0 && <span className="text-diff-remove-text">-{deletions}</span>}
            </div>
          )}
        </div>

        <button
          onClick={() => onEditFile(filePath)}
          className="rounded-md px-2 py-1 text-xs text-secondary hover:bg-surface-3"
          title="Edit file in Browse mode"
        >
          Edit
        </button>
      </div>

      {/* Diff Content - Only render when expanded */}
      {!isCollapsed && (
        <div className="bg-surface-1 rounded-b-md overflow-hidden">
          {isLoading && (
            <div className="flex items-center justify-center py-4 text-tertiary text-sm">
              Loading diff...
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center py-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          {!isLoading && !error && !oldContent && !newContent && (
            <div className="flex items-center justify-center py-4 text-tertiary text-sm">
              New file (no content yet)
            </div>
          )}

          {hasContent && (
            <DiffContent oldContent={oldContent} newContent={newContent} filePath={filePath} />
          )}
        </div>
      )}
    </div>
  );
});
