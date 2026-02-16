import { useEffect, useState } from 'react';
import { useFileStore, OpenFile } from '@/stores/fileStore';
import { findReferences, SymbolReference, readFile } from '@/lib/tauri';
import { getLanguageFromPath } from '@/lib/highlight';
import { getFileName } from '@/lib/fileUtils';
import { CloseIcon } from '@/components/Icons';

interface ReferencesByFile {
  filePath: string;
  relativePath: string;
  refs: SymbolReference[];
}

export function ReferencesPanel() {
  const { referencesSymbol, hideReferencesPanel, contextPath, openBrowseFileAtLine } =
    useFileStore();
  const [results, setResults] = useState<ReferencesByFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (!referencesSymbol || !contextPath) return;

    setLoading(true);
    findReferences(referencesSymbol, contextPath)
      .then((refs) => {
        setTotalCount(refs.length);

        // Group by file
        const byFile = new Map<string, SymbolReference[]>();
        for (const ref of refs) {
          const existing = byFile.get(ref.filePath) || [];
          existing.push(ref);
          byFile.set(ref.filePath, existing);
        }

        const grouped: ReferencesByFile[] = [];
        for (const [filePath, fileRefs] of byFile) {
          const relativePath = filePath.startsWith(contextPath)
            ? filePath.slice(contextPath.length + 1)
            : filePath;
          grouped.push({ filePath, relativePath, refs: fileRefs });
        }

        // Sort by file path
        grouped.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        setResults(grouped);
      })
      .catch((err) => {
        console.error('Failed to find references:', err);
        setResults([]);
        setTotalCount(0);
      })
      .finally(() => setLoading(false));
  }, [referencesSymbol, contextPath]);

  if (!referencesSymbol) return null;

  const handleClick = async (ref: SymbolReference) => {
    try {
      const content = await readFile(ref.filePath);
      const fileName = getFileName(ref.filePath);
      const language = getLanguageFromPath(ref.filePath) || 'plaintext';
      const file: OpenFile = {
        path: ref.filePath,
        name: fileName,
        content,
        isDirty: false,
        language,
      };
      openBrowseFileAtLine(file, ref.line);
    } catch (err) {
      console.error('Failed to open reference:', err);
    }
  };

  return (
    <div className="border-t border-border bg-surface-1 max-h-[200px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-xs text-secondary">
          {loading ? (
            'Searching...'
          ) : (
            <>
              <span className="text-primary font-medium">{totalCount}</span> references to{' '}
              <span className="text-primary font-mono font-medium">{referencesSymbol}</span>
            </>
          )}
        </span>
        <button
          onClick={hideReferencesPanel}
          className="rounded p-0.5 hover:bg-surface-3 text-tertiary hover:text-primary"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Results */}
      <div className="overflow-y-auto flex-1 text-xs">
        {loading ? (
          <div className="p-3 text-center text-tertiary">Searching for references...</div>
        ) : results.length === 0 ? (
          <div className="p-3 text-center text-tertiary">No references found</div>
        ) : (
          results.map((group) => (
            <div key={group.filePath}>
              <div className="px-3 py-1 text-tertiary bg-surface-2 font-mono sticky top-0">
                {group.relativePath} <span className="text-tertiary">({group.refs.length})</span>
              </div>
              {group.refs.map((ref, i) => (
                <button
                  key={`${ref.line}-${i}`}
                  onClick={() => handleClick(ref)}
                  className="w-full text-left px-3 py-0.5 hover:bg-surface-2 flex items-baseline gap-2 font-mono"
                >
                  <span className="text-tertiary shrink-0 w-8 text-right">{ref.line}</span>
                  <HighlightedLine content={ref.lineContent} symbol={referencesSymbol} />
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HighlightedLine({ content, symbol }: { content: string; symbol: string }) {
  const parts: { text: string; highlight: boolean }[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    const idx = remaining.indexOf(symbol);
    if (idx === -1) {
      parts.push({ text: remaining, highlight: false });
      break;
    }
    if (idx > 0) {
      parts.push({ text: remaining.slice(0, idx), highlight: false });
    }
    parts.push({ text: symbol, highlight: true });
    remaining = remaining.slice(idx + symbol.length);
  }

  return (
    <span className="text-secondary truncate">
      {parts.map((part, i) =>
        part.highlight ? (
          <span key={i} className="text-primary font-semibold bg-accent/20 rounded px-0.5">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}
