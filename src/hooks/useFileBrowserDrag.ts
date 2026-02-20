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
}

export function useFileBrowserDrag({
  flatRows,
  expandedDirs,
  onExpand,
}: UseFileBrowserDragOptions) {
  // Refs — never cause re-renders (same pattern as useDraggableTabs)
  const flatRowsRef = useRef(flatRows);
  const expandedDirsRef = useRef(expandedDirs);
  const onExpandRef = useRef(onExpand);
  flatRowsRef.current = flatRows;
  expandedDirsRef.current = expandedDirs;
  onExpandRef.current = onExpand;

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
    }

    function getDirectoryAtPoint(clientX: number, clientY: number): FileEntry | null {
      const el = document.elementFromPoint(clientX, clientY);
      const rowEl = el?.closest('[data-drag-path]') as HTMLElement | null;
      if (!rowEl) return null;
      const path = rowEl.dataset.dragPath;
      if (!path) return null;
      const row = flatRowsRef.current.find((r) => r.entry.path === path);
      return row?.entry?.isDirectory ? row.entry : null;
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

        if (hoveredDir && !expandedDirsRef.current.has(hoveredDir.path)) {
          const dirToExpand = hoveredDir;
          autoExpandTimerRef.current = setTimeout(() => {
            autoExpandTimerRef.current = null;
            onExpandRef.current(dirToExpand.path);
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
      reset();

      if (destDir && isValidDrop(src.path, destDir)) {
        try {
          await moveEntry(src.path, join(destDir, basename(src.path)));
          useFileStore.getState().invalidateFileTree();
        } catch (err) {
          console.error('Failed to move entry:', err);
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
    (entry: FileEntry) => ({
      onMouseDown: (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        wasDragRef.current = false;
        dragEntryRef.current = entry;
        startXRef.current = e.clientX;
        startYRef.current = e.clientY;
      },
      isDragging: dragPath === entry.path,
      isDropTarget: dropTargetPath === entry.path,
    }),
    [dragPath, dropTargetPath]
  );

  return {
    getDragProps,
    wasDragRef,
    ghost: ghostPos && dragPath ? { name: basename(dragPath), x: ghostPos.x, y: ghostPos.y } : null,
  };
}
