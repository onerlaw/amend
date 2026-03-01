import { useState, useRef, useCallback, useEffect } from 'react';
import { FileEntry, moveEntry } from '@/lib/tauri';
import { basename, dirname, join } from '@/lib/pathUtils';
import { useFileStore } from '@/stores/fileStore';

interface FlatRow {
  entry: FileEntry;
  depth: number;
}

interface UseFileBrowserDragOptions {
  flatRows: FlatRow[];
  expandedDirs: Set<string>;
  onExpand: (path: string) => void;
  selectedPaths: Set<string>;
  onClearSelection: () => void;
  contextPath: string | null;
}

function filterTopLevelPaths(paths: string[]): string[] {
  return paths.filter((p) => !paths.some((other) => other !== p && p.startsWith(other + '/')));
}

export function useFileBrowserDrag({
  flatRows,
  expandedDirs,
  onExpand,
  selectedPaths,
  onClearSelection,
  contextPath,
}: UseFileBrowserDragOptions) {
  // Refs — never cause re-renders (same pattern as useDraggableTabs)
  const flatRowsRef = useRef(flatRows);
  const expandedDirsRef = useRef(expandedDirs);
  const onExpandRef = useRef(onExpand);
  const contextPathRef = useRef(contextPath);
  flatRowsRef.current = flatRows;
  expandedDirsRef.current = expandedDirs;
  onExpandRef.current = onExpand;
  contextPathRef.current = contextPath;

  const selectedPathsRef = useRef(selectedPaths);
  selectedPathsRef.current = selectedPaths;
  const onClearSelectionRef = useRef(onClearSelection);
  onClearSelectionRef.current = onClearSelection;

  const dragEntryRef = useRef<FileEntry | null>(null);
  const isDraggingRef = useRef(false);
  const wasDragRef = useRef(false); // true after drag threshold crossed; stays true through click
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const dropTargetPathRef = useRef<string | null>(null);
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React state — only for visual feedback
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [isRootDropTarget, setIsRootDropTarget] = useState(false);

  useEffect(() => {
    function isValidDrop(src: string, destDir: string): boolean {
      if (src === destDir) return false;
      if (dirname(src) === destDir) return false;
      if (destDir.startsWith(src + '/')) return false;
      return true;
    }

    function reset() {
      dragEntryRef.current = null;
      isDraggingRef.current = false;
      dropTargetPathRef.current = null;
      if (autoExpandTimerRef.current) {
        clearTimeout(autoExpandTimerRef.current);
        autoExpandTimerRef.current = null;
      }
      document.body.classList.remove('file-drag-active');
      setDragPath(null);
      setDropTargetPath(null);
      setGhostPos(null);
      setIsRootDropTarget(false);
    }

    function getDirectoryAtPoint(
      clientX: number,
      clientY: number
    ): { path: string; isRoot: boolean } | null {
      const el = document.elementFromPoint(clientX, clientY);
      // Check for a directory row first
      const rowEl = el?.closest('[data-drag-path]') as HTMLElement | null;
      if (rowEl) {
        const path = rowEl.dataset.dragPath;
        if (path) {
          // If it's the root container, return it as root
          if (rowEl.hasAttribute('data-file-list-root')) {
            return { path, isRoot: true };
          }
          const row = flatRowsRef.current.find((r) => r.entry.path === path);
          if (row?.entry?.isDirectory) {
            return { path: row.entry.path, isRoot: false };
          }
        }
        return null;
      }
      // Check if we're over the root container
      const rootEl = el?.closest('[data-file-list-root]') as HTMLElement | null;
      if (rootEl) {
        const path = rootEl.dataset.dragPath;
        if (path) return { path, isRoot: true };
      }
      return null;
    }

    function handleMouseMove(e: MouseEvent) {
      if (!dragEntryRef.current) return;

      if (!isDraggingRef.current) {
        const dx = Math.abs(e.clientX - startXRef.current);
        const dy = Math.abs(e.clientY - startYRef.current);
        if (dx < 5 && dy < 5) return;
        isDraggingRef.current = true;
        wasDragRef.current = true;
        document.body.classList.add('file-drag-active');
        setDragPath(dragEntryRef.current.path);
      }

      setGhostPos({ x: e.clientX, y: e.clientY });

      const hoveredDir = getDirectoryAtPoint(e.clientX, e.clientY);
      const newTargetPath = hoveredDir?.path ?? null;

      if (newTargetPath !== dropTargetPathRef.current) {
        if (autoExpandTimerRef.current) {
          clearTimeout(autoExpandTimerRef.current);
          autoExpandTimerRef.current = null;
        }
        dropTargetPathRef.current = newTargetPath;
        setDropTargetPath(newTargetPath);
        setIsRootDropTarget(hoveredDir?.isRoot ?? false);

        // Only auto-expand actual directory rows, not the root container
        if (hoveredDir && !hoveredDir.isRoot && !expandedDirsRef.current.has(hoveredDir.path)) {
          const pathToExpand = hoveredDir.path;
          autoExpandTimerRef.current = setTimeout(() => {
            autoExpandTimerRef.current = null;
            onExpandRef.current(pathToExpand);
          }, 600);
        }
      }
    }

    async function handleMouseUp() {
      if (!isDraggingRef.current || !dragEntryRef.current) {
        reset();
        return;
      }
      const src = dragEntryRef.current;
      const destDir = dropTargetPathRef.current;
      const sel = selectedPathsRef.current;
      const isMultiDrag = sel.has(src.path) && sel.size > 1;
      const pathsToMove = isMultiDrag ? filterTopLevelPaths(Array.from(sel)) : [src.path];
      reset();

      if (destDir) {
        const moves = pathsToMove
          .filter((p) => isValidDrop(p, destDir))
          .map((p) => moveEntry(p, join(destDir, basename(p))));
        if (moves.length) {
          try {
            await Promise.all(moves);
            useFileStore.getState().invalidateFileTree();
            if (isMultiDrag) onClearSelectionRef.current();
          } catch (err) {
            console.error('Failed to move entry:', err);
          }
        }
      }
    }

    function handleBlur() {
      reset();
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleBlur);
      if (autoExpandTimerRef.current) clearTimeout(autoExpandTimerRef.current);
      document.body.classList.remove('file-drag-active');
    };
  }, []);

  const getDragProps = useCallback(
    (entry: FileEntry) => {
      const sel = selectedPathsRef.current;
      return {
        onMouseDown: (e: React.MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          wasDragRef.current = false;
          dragEntryRef.current = entry;
          startXRef.current = e.clientX;
          startYRef.current = e.clientY;
        },
        isDragging:
          dragPath !== null &&
          (dragPath === entry.path || (sel.has(dragPath) && sel.has(entry.path))),
        isDropTarget: dropTargetPath === entry.path,
      };
    },
    [dragPath, dropTargetPath]
  );

  const sel = selectedPathsRef.current;
  const count = dragPath && sel.has(dragPath) ? sel.size : 1;

  return {
    getDragProps,
    wasDragRef,
    isRootDropTarget,
    ghost:
      ghostPos && dragPath
        ? { name: basename(dragPath), count, x: ghostPos.x, y: ghostPos.y }
        : null,
  };
}
