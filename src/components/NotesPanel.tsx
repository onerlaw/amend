import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useNotesStore } from '@/stores/notesStore';
import { createBaseExtensions } from '@/lib/codemirror';
import { CloseIcon } from '@/components/Icons';

export function NotesPanel() {
  const { isOpen, content, position, size, toggleNotes, setContent, setPosition, setSize } =
    useNotesStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentRef = useRef(content);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag state
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    posX: number;
    posY: number;
  } | null>(null);

  // Resize state
  const [resizeSize, setResizeSize] = useState<{ width: number; height: number } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; w: number; h: number } | null>(
    null
  );

  // Keep contentRef in sync
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Clamp position to viewport on open
  const clampedPosition = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.max(0, Math.min(position.x, vw - size.width));
    const y = Math.max(0, Math.min(position.y, vh - size.height));
    return { x, y };
  }, [position, size]);

  // Create / destroy CodeMirror when panel opens/closes
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    // Clamp stored position on open
    const clamped = clampedPosition();
    if (clamped.x !== position.x || clamped.y !== position.y) {
      setPosition(clamped);
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString();
        contentRef.current = newContent;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          setContent(newContent);
        }, 300);
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [...createBaseExtensions('markdown'), updateListener],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      // Flush pending content on unmount
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const finalContent = view.state.doc.toString();
      if (finalContent !== useNotesStore.getState().content) {
        setContent(finalContent);
      }
      view.destroy();
      viewRef.current = null;
    };
    // Only recreate editor when isOpen changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Drag handlers
  const handleDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const pos = dragPos ?? position;
      dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, posX: pos.x, posY: pos.y };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragStartRef.current) return;
        const dx = ev.clientX - dragStartRef.current.mouseX;
        const dy = ev.clientY - dragStartRef.current.mouseY;
        const currentSize = resizeSize ?? size;
        const newX = Math.max(
          0,
          Math.min(dragStartRef.current.posX + dx, window.innerWidth - currentSize.width)
        );
        const newY = Math.max(
          0,
          Math.min(dragStartRef.current.posY + dy, window.innerHeight - currentSize.height)
        );
        setDragPos({ x: newX, y: newY });
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        if (dragStartRef.current) {
          setDragPos((pos) => {
            if (pos) setPosition(pos);
            return null;
          });
          dragStartRef.current = null;
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [position, dragPos, size, resizeSize, setPosition]
  );

  // Resize handlers
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const currentSize = resizeSize ?? size;
      resizeStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        w: currentSize.width,
        h: currentSize.height,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizeStartRef.current) return;
        const dx = ev.clientX - resizeStartRef.current.mouseX;
        const dy = ev.clientY - resizeStartRef.current.mouseY;
        const newW = Math.max(200, resizeStartRef.current.w + dx);
        const newH = Math.max(150, resizeStartRef.current.h + dy);
        setResizeSize({ width: newW, height: newH });
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        if (resizeStartRef.current) {
          setResizeSize((s) => {
            if (s) setSize(s);
            return null;
          });
          resizeStartRef.current = null;
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [size, resizeSize, setSize]
  );

  if (!isOpen) return null;

  const currentPos = dragPos ?? position;
  const currentSize = resizeSize ?? size;

  return createPortal(
    <div
      data-notes-panel
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border bg-surface-0 shadow-xl"
      style={{
        left: currentPos.x,
        top: currentPos.y,
        width: currentSize.width,
        height: currentSize.height,
      }}
    >
      {/* Title bar — drag handle */}
      <div
        className="flex h-8 shrink-0 cursor-move items-center justify-between bg-surface-1 px-3"
        onMouseDown={handleDragMouseDown}
      >
        <span className="select-none text-xs font-medium text-primary">Notes</span>
        <button
          onClick={toggleNotes}
          onMouseDown={(e) => e.stopPropagation()}
          className="rounded-md p-0.5 text-secondary hover:bg-surface-3"
        >
          <CloseIcon className="h-3 w-3" />
        </button>
      </div>

      {/* CodeMirror container */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
        onMouseDown={handleResizeMouseDown}
        style={{
          background:
            'linear-gradient(135deg, transparent 50%, var(--text-tertiary) 50%, var(--text-tertiary) 65%, transparent 65%, transparent 75%, var(--text-tertiary) 75%, var(--text-tertiary) 90%, transparent 90%)',
        }}
      />
    </div>,
    document.body
  );
}
