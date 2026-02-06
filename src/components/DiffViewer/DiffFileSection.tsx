import { useMemo, useState, useEffect, useCallback, memo } from 'react';
import * as Diff from 'diff';
import { highlightCode, getLanguageFromPath } from '@/lib/highlight';

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

type DiffSection =
  | { kind: 'hunk'; lines: Omit<DiffLineProps, 'language'>[] }
  | { kind: 'collapsed'; lines: Omit<DiffLineProps, 'language'>[]; hiddenCount: number };

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
    () => highlightCode(content, language),
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

// Collapsed separator component
const CollapsedSeparator = memo(function CollapsedSeparator({
  hiddenCount,
  isExpanded,
  onToggle,
}: {
  hiddenCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 px-3 py-1 bg-surface-2 hover:bg-surface-3 border-y border-surface-3 font-mono text-xs text-tertiary cursor-pointer"
    >
      <svg
        className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M6 4l4 4-4 4V4z" />
      </svg>
      {hiddenCount} hidden lines
    </button>
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

// Diff content component - renders sections with collapsible hunks
const DiffContent = memo(function DiffContent({
  sections,
  expandedSections,
  onToggleSection,
  filePath,
}: {
  sections: DiffSection[];
  expandedSections: Set<number>;
  onToggleSection: (index: number) => void;
  filePath: string;
}) {
  const language = getLanguageFromPath(filePath);

  const totalLines = sections.reduce((sum, s) => sum + s.lines.length, 0);
  if (totalLines === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-tertiary text-sm">
        No differences (new file)
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-fit">
        {sections.map((section, sectionIndex) => {
          if (section.kind === 'collapsed') {
            const isExpanded = expandedSections.has(sectionIndex);
            return (
              <div key={sectionIndex}>
                <CollapsedSeparator
                  hiddenCount={section.hiddenCount}
                  isExpanded={isExpanded}
                  onToggle={() => onToggleSection(sectionIndex)}
                />
                {isExpanded &&
                  section.lines.map((line, lineIndex) => (
                    <DiffLine key={lineIndex} {...line} language={language} />
                  ))}
              </div>
            );
          }
          return (
            <div key={sectionIndex}>
              {section.lines.map((line, lineIndex) => (
                <DiffLine key={lineIndex} {...line} language={language} />
              ))}
            </div>
          );
        })}
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
  // Expand state for collapsed sections
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  // Reset expanded state when content changes
  useEffect(() => {
    setExpandedSections(new Set());
  }, [oldContent, newContent]);

  const toggleSection = useCallback((index: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Compute diff once — extract stats and sections from the same computation
  const { additions, deletions, sections } = useMemo(() => {
    if (isLoading || error || (!oldContent && !newContent)) {
      return { additions: 0, deletions: 0, sections: [] as DiffSection[] };
    }

    const changes = Diff.diffLines(oldContent, newContent);
    let adds = 0;
    let dels = 0;
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
          adds++;
          result.push({
            type: 'added',
            content: line,
            newLineNum: newLineNum++,
          });
        } else if (change.removed) {
          dels++;
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

    // Build sections: group changed lines with 10 lines of context
    const CONTEXT = 10;

    // Collect indices of changed lines
    const changedIndices: number[] = [];
    for (let i = 0; i < result.length; i++) {
      if (result[i].type !== 'unchanged') {
        changedIndices.push(i);
      }
    }

    // If no changes or all lines are changes, return a single hunk
    if (changedIndices.length === 0 || changedIndices.length === result.length) {
      return { additions: adds, deletions: dels, sections: [{ kind: 'hunk' as const, lines: result }] };
    }

    // Compute context ranges around each changed line, then merge overlapping
    type Range = { start: number; end: number };
    const ranges: Range[] = [];

    for (const idx of changedIndices) {
      const start = Math.max(0, idx - CONTEXT);
      const end = Math.min(result.length - 1, idx + CONTEXT);
      if (ranges.length > 0 && start <= ranges[ranges.length - 1].end + 1) {
        // Merge with previous range
        ranges[ranges.length - 1].end = Math.max(ranges[ranges.length - 1].end, end);
      } else {
        ranges.push({ start, end });
      }
    }

    // Build sections from ranges
    const sects: DiffSection[] = [];
    let cursor = 0;

    for (const range of ranges) {
      // Collapsed section before this range
      if (cursor < range.start) {
        const collapsedLines = result.slice(cursor, range.start);
        sects.push({ kind: 'collapsed', lines: collapsedLines, hiddenCount: collapsedLines.length });
      }
      // Hunk section
      sects.push({ kind: 'hunk', lines: result.slice(range.start, range.end + 1) });
      cursor = range.end + 1;
    }

    // Collapsed section after last range
    if (cursor < result.length) {
      const collapsedLines = result.slice(cursor);
      sects.push({ kind: 'collapsed', lines: collapsedLines, hiddenCount: collapsedLines.length });
    }

    return { additions: adds, deletions: dels, sections: sects };
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
            <DiffContent
              sections={sections}
              expandedSections={expandedSections}
              onToggleSection={toggleSection}
              filePath={filePath}
            />
          )}
        </div>
      )}
    </div>
  );
});
