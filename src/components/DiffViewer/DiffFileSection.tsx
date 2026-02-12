import { useMemo, useState, useEffect, useCallback, memo } from 'react';
import * as Diff from 'diff';
import { highlightCode, getLanguageFromPath } from '@/lib/highlight';
import { getFileName, toggleSetItem, buildImageDataUrl } from '@/lib/fileUtils';
import { ChevronIcon } from '@/components/Icons';
import {
  parseConflicts,
  resolveConflict,
  hasConflictMarkers,
  FileSegment,
} from '@/lib/conflictParser';
import { writeFile, stageFile } from '@/lib/tauri';

interface DiffFileSectionProps {
  filePath: string;
  category: 'staged' | 'unstaged' | 'untracked' | 'conflicted' | 'branch';
  oldContent: string;
  newContent: string;
  isBinary: boolean;
  isCollapsed: boolean;
  isLoading: boolean;
  error: string | null;
  onToggleCollapse: () => void;
  onEditFile: (filePath: string) => void;
  repoPath?: string;
  onRefresh?: () => void;
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

// Gutter (line numbers + prefix) — rendered in a fixed column outside the horizontal scroller
const DiffLineGutter = memo(function DiffLineGutter({
  type,
  oldLineNum,
  newLineNum,
}: {
  type: 'added' | 'removed' | 'unchanged';
  oldLineNum?: number;
  newLineNum?: number;
}) {
  const bgClass =
    type === 'added' ? 'bg-diff-add-bg' : type === 'removed' ? 'bg-diff-remove-bg' : '';

  const prefixClass =
    type === 'added'
      ? 'text-diff-add-text'
      : type === 'removed'
        ? 'text-diff-remove-text'
        : 'text-tertiary';

  const prefix = type === 'added' ? '+' : type === 'removed' ? '-' : ' ';

  return (
    <div className={`flex font-mono text-sm ${bgClass}`}>
      <span className="w-12 flex-shrink-0 select-none px-2 text-right text-tertiary bg-surface-1">
        {oldLineNum ?? ''}
      </span>
      <span className="w-12 flex-shrink-0 select-none px-2 text-right text-tertiary bg-surface-1">
        {newLineNum ?? ''}
      </span>
      <span className={`w-4 flex-shrink-0 text-center ${prefixClass} ${bgClass || 'bg-surface-1'}`}>
        {prefix}
      </span>
    </div>
  );
});

// Code content — rendered inside the horizontally scrollable column
const DiffLineCode = memo(function DiffLineCode({
  type,
  content,
  language,
}: {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  language?: string;
}) {
  const bgClass =
    type === 'added' ? 'bg-diff-add-bg' : type === 'removed' ? 'bg-diff-remove-bg' : '';

  const highlightedContent = useMemo(() => highlightCode(content, language), [content, language]);

  return (
    <div className={`font-mono text-sm ${bgClass} whitespace-nowrap`}>
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
      <ChevronIcon className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      {hiddenCount} hidden lines
    </button>
  );
});

const BADGE_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  staged: { bg: 'bg-diff-add-bg', text: 'text-diff-add-text', label: 'Staged' },
  unstaged: {
    bg: 'bg-amber-100 dark:bg-yellow-600/30',
    text: 'text-amber-600 dark:text-yellow-400',
    label: 'Changed',
  },
  untracked: { bg: 'bg-gray-200 dark:bg-gray-600/30', text: 'text-tertiary', label: 'Untracked' },
  conflicted: {
    bg: 'bg-red-100 dark:bg-red-600/20',
    text: 'text-red-600 dark:text-red-400',
    label: 'Conflict',
  },
  branch: {
    bg: 'bg-blue-100 dark:bg-blue-600/20',
    text: 'text-blue-600 dark:text-blue-400',
    label: 'Branch',
  },
};

function getStatusBadge(category: 'staged' | 'unstaged' | 'untracked' | 'conflicted' | 'branch') {
  const config = BADGE_CONFIG[category];
  return (
    <span className={`rounded-md ${config.bg} px-1.5 py-0.5 text-xs font-medium ${config.text}`}>
      {config.label}
    </span>
  );
}

// Diff content component - two-column layout: fixed gutter + scrollable code.
// The gutter column is outside the horizontal scroll container so it never
// scrolls sideways (works around WebKit position:sticky bugs in flex scroll
// containers). Vertical scroll is handled by the parent and moves both columns.
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
    <div className="flex">
      {/* Fixed gutter column — never scrolls horizontally */}
      <div className="flex-shrink-0">
        {sections.map((section, sectionIndex) => {
          if (section.kind === 'collapsed') {
            const isExpanded = expandedSections.has(sectionIndex);
            return (
              <div key={sectionIndex}>
                {/* Height-matched placeholder for CollapsedSeparator */}
                <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-2 border-y border-surface-3 font-mono text-xs text-tertiary">
                  {'\u00A0'}
                </div>
                {isExpanded &&
                  section.lines.map((line, lineIndex) => (
                    <DiffLineGutter
                      key={lineIndex}
                      type={line.type}
                      oldLineNum={line.oldLineNum}
                      newLineNum={line.newLineNum}
                    />
                  ))}
              </div>
            );
          }
          return (
            <div key={sectionIndex}>
              {section.lines.map((line, lineIndex) => (
                <DiffLineGutter
                  key={lineIndex}
                  type={line.type}
                  oldLineNum={line.oldLineNum}
                  newLineNum={line.newLineNum}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Scrollable code column — horizontal scroll only */}
      <div className="overflow-x-auto flex-1 min-w-0">
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
                      <DiffLineCode
                        key={lineIndex}
                        type={line.type}
                        content={line.content}
                        language={language}
                      />
                    ))}
                </div>
              );
            }
            return (
              <div key={sectionIndex}>
                {section.lines.map((line, lineIndex) => (
                  <DiffLineCode
                    key={lineIndex}
                    type={line.type}
                    content={line.content}
                    language={language}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

// Image diff component - renders old/new images side-by-side
const ImageDiffContent = memo(function ImageDiffContent({
  filePath,
  oldContent,
  newContent,
}: {
  filePath: string;
  oldContent: string;
  newContent: string;
}) {
  const hasOld = oldContent.length > 0;
  const hasNew = newContent.length > 0;

  const label = !hasOld ? 'Added' : !hasNew ? 'Removed' : 'Modified';

  return (
    <div className="p-4">
      <div className="text-xs text-tertiary mb-3">{label} (binary image file)</div>
      <div className="flex items-start gap-4">
        {hasOld && (
          <div className="flex-1 min-w-0">
            {hasNew && <div className="text-xs text-diff-remove-text mb-1">Old</div>}
            <div className="border border-surface-3 rounded-md p-2 bg-surface-0">
              <img
                src={buildImageDataUrl(oldContent, filePath)}
                alt="Old version"
                className="max-w-full max-h-64 object-contain mx-auto"
              />
            </div>
          </div>
        )}
        {hasNew && (
          <div className="flex-1 min-w-0">
            {hasOld && <div className="text-xs text-diff-add-text mb-1">New</div>}
            <div className="border border-surface-3 rounded-md p-2 bg-surface-0">
              <img
                src={buildImageDataUrl(newContent, filePath)}
                alt="New version"
                className="max-w-full max-h-64 object-contain mx-auto"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// Conflict resolution content component
const ConflictContent = memo(function ConflictContent({
  filePath,
  newContent,
  repoPath,
  onRefresh,
}: {
  filePath: string;
  newContent: string;
  repoPath: string;
  onRefresh: () => void;
}) {
  const [segments, setSegments] = useState<FileSegment[] | null>(null);
  const [allResolved, setAllResolved] = useState(false);
  const language = getLanguageFromPath(filePath);

  useEffect(() => {
    const parsed = parseConflicts(newContent);
    setSegments(parsed);
    setAllResolved(!hasConflictMarkers(newContent));
  }, [newContent]);

  const handleResolve = useCallback(
    async (conflictIndex: number, resolution: 'ours' | 'theirs' | 'both') => {
      if (!segments) return;
      const resolved = resolveConflict(segments, conflictIndex, resolution);
      const fullPath = `${repoPath}/${filePath}`;
      await writeFile(fullPath, resolved);
      onRefresh();
    },
    [segments, repoPath, filePath, onRefresh]
  );

  const handleMarkResolved = useCallback(async () => {
    await stageFile(repoPath, filePath);
    onRefresh();
  }, [repoPath, filePath, onRefresh]);

  if (!segments) {
    return (
      <div className="flex items-center justify-center py-4 text-tertiary text-sm">
        No conflict markers found
      </div>
    );
  }

  let conflictIndex = 0;

  return (
    <div>
      {segments.map((segment, i) => {
        if (segment.kind === 'normal') {
          return (
            <div key={i}>
              {segment.lines.map((line, li) => (
                <div key={li} className="font-mono text-sm whitespace-nowrap">
                  <span
                    className="px-2 whitespace-pre hljs"
                    dangerouslySetInnerHTML={{ __html: highlightCode(line, language) }}
                  />
                </div>
              ))}
            </div>
          );
        }

        const idx = conflictIndex++;
        return (
          <div key={i} className="border-y border-surface-3">
            {/* Resolution buttons */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-2">
              <span className="text-xs font-medium text-secondary mr-auto">
                Conflict #{idx + 1}
              </span>
              <button
                onClick={() => handleResolve(idx, 'ours')}
                className="rounded-md px-2 py-0.5 text-xs font-medium text-conflict-ours-text bg-conflict-ours-bg hover:opacity-80"
              >
                Accept Current
              </button>
              <button
                onClick={() => handleResolve(idx, 'theirs')}
                className="rounded-md px-2 py-0.5 text-xs font-medium text-conflict-theirs-text bg-conflict-theirs-bg hover:opacity-80"
              >
                Accept Incoming
              </button>
              <button
                onClick={() => handleResolve(idx, 'both')}
                className="rounded-md px-2 py-0.5 text-xs font-medium text-secondary bg-surface-3 hover:opacity-80"
              >
                Accept Both
              </button>
            </div>

            {/* Ours section */}
            <div className="bg-conflict-ours-bg">
              <div className="px-3 py-0.5 text-xs text-conflict-ours-text font-medium border-b border-conflict-ours-text/20">
                Current ({segment.oursLabel})
              </div>
              {segment.oursLines.map((line, li) => (
                <div key={li} className="font-mono text-sm whitespace-nowrap">
                  <span
                    className="px-2 whitespace-pre hljs"
                    dangerouslySetInnerHTML={{ __html: highlightCode(line, language) }}
                  />
                </div>
              ))}
            </div>

            {/* Theirs section */}
            <div className="bg-conflict-theirs-bg">
              <div className="px-3 py-0.5 text-xs text-conflict-theirs-text font-medium border-b border-conflict-theirs-text/20">
                Incoming ({segment.theirsLabel})
              </div>
              {segment.theirsLines.map((line, li) => (
                <div key={li} className="font-mono text-sm whitespace-nowrap">
                  <span
                    className="px-2 whitespace-pre hljs"
                    dangerouslySetInnerHTML={{ __html: highlightCode(line, language) }}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Mark as Resolved button when all conflicts are resolved */}
      {allResolved && (
        <div className="flex items-center justify-center py-3 bg-surface-1">
          <button
            onClick={handleMarkResolved}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700"
          >
            Mark as Resolved
          </button>
        </div>
      )}
    </div>
  );
});

export const DiffFileSection = memo(function DiffFileSection({
  filePath,
  category,
  oldContent,
  newContent,
  isBinary,
  isCollapsed,
  isLoading,
  error,
  onToggleCollapse,
  onEditFile,
  repoPath,
  onRefresh,
}: DiffFileSectionProps) {
  // Expand state for collapsed sections
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  // Reset expanded state when content changes
  useEffect(() => {
    setExpandedSections(new Set());
  }, [oldContent, newContent]);

  const toggleSection = useCallback((index: number) => {
    setExpandedSections((prev) => toggleSetItem(prev, index));
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
    const CONTEXT = 4;

    // Collect indices of changed lines
    const changedIndices: number[] = [];
    for (let i = 0; i < result.length; i++) {
      if (result[i].type !== 'unchanged') {
        changedIndices.push(i);
      }
    }

    // If no changes or all lines are changes, return a single hunk
    if (changedIndices.length === 0 || changedIndices.length === result.length) {
      return {
        additions: adds,
        deletions: dels,
        sections: [{ kind: 'hunk' as const, lines: result }],
      };
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
        sects.push({
          kind: 'collapsed',
          lines: collapsedLines,
          hiddenCount: collapsedLines.length,
        });
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

  const fileName = getFileName(filePath);
  const dirPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : '';
  const hasContent = !isLoading && !error && (oldContent || newContent);

  return (
    <div className="m-2">
      {/* Header */}
      <div
        className={`flex items-center justify-between bg-surface-2 px-3 py-2 rounded-t-md ${isCollapsed ? 'rounded-b-md' : ''}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onToggleCollapse}
            className="rounded-md p-0.5 hover:bg-surface-3"
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            <ChevronIcon
              className={`h-4 w-4 text-tertiary transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
            />
          </button>

          <span className="text-sm truncate" title={filePath}>
            {dirPath && <span className="text-tertiary">{dirPath}</span>}
            <span className="text-primary">{fileName}</span>
          </span>

          {getStatusBadge(category)}

          {hasContent && !isBinary && (
            <div className="flex items-center gap-2 text-xs">
              {additions > 0 && <span className="text-diff-add-text">+{additions}</span>}
              {deletions > 0 && <span className="text-diff-remove-text">-{deletions}</span>}
            </div>
          )}

          {hasContent && isBinary && (
            <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-xs text-tertiary">
              Binary file
            </span>
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

          {hasContent && isBinary && (
            <ImageDiffContent filePath={filePath} oldContent={oldContent} newContent={newContent} />
          )}

          {hasContent && !isBinary && category === 'conflicted' && repoPath && onRefresh && (
            <ConflictContent
              filePath={filePath}
              newContent={newContent}
              repoPath={repoPath}
              onRefresh={onRefresh}
            />
          )}

          {hasContent && !isBinary && category !== 'conflicted' && (
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
