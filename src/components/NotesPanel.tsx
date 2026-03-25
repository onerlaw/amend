import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useNotesStore } from '@/stores/notesStore';
import { createBaseExtensions } from '@/lib/codemirror';
import { CloseIcon, PlusIcon } from '@/components/Icons';
import { useDraggableTabs } from '@/hooks/useDraggableTabs';

function NoteTabLabel({
  title,
  isActive,
  isDragging,
  onSelect,
  onClose,
  onRename,
  dragProps,
}: {
  title: string;
  isActive: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  onRename: (title: string) => void;
  dragProps: { ref: (el: HTMLElement | null) => void; onMouseDown: (e: React.MouseEvent) => void };
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    onRename(trimmed || title);
    setRenaming(false);
  }, [renameValue, title, onRename]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(title);
    setRenaming(true);
  };

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  if (renaming) {
    return (
      <div
        {...dragProps}
        className={`group flex items-center gap-1 px-2 py-1 text-xs ${
          isActive ? 'bg-surface-0 text-primary' : 'text-secondary'
        } ${isDragging ? 'opacity-50' : ''}`}
      >
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={commitRename}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="bg-surface-3 text-primary text-xs rounded px-1 py-0 outline-none border border-accent w-24 min-w-[40px]"
        />
      </div>
    );
  }

  return (
    <div className={`group flex items-center ${isDragging ? 'opacity-50' : ''}`}>
      <button
        {...dragProps}
        onClick={onSelect}
        onDoubleClick={handleDoubleClick}
        className={`flex items-center gap-1 px-2 py-1 text-xs ${
          isActive
            ? 'bg-surface-0 text-primary'
            : 'text-secondary hover:bg-surface-1 opacity-50 hover:opacity-75'
        }`}
      >
        <span className="truncate max-w-[120px]">{title || 'Untitled'}</span>
        <span
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="rounded-full p-0.5 opacity-0 hover:bg-surface-3 group-hover:opacity-100"
        >
          <CloseIcon className="h-3 w-3" />
        </span>
      </button>
    </div>
  );
}

export function NotesPanel() {
  const {
    isOpen,
    notes,
    activeNoteId,
    position,
    size,
    toggleNotes,
    setActiveNote,
    addNote,
    removeNote,
    renameNote,
    reorderNotes,
    updateNoteContent,
    setPosition,
    setSize,
  } = useNotesStore();

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeNoteIdRef = useRef(activeNoteId);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousNoteIdRef = useRef<string | null>(null);

  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    posX: number;
    posY: number;
  } | null>(null);

  const [resizeSize, setResizeSize] = useState<{ width: number; height: number } | null>(null);
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; w: number; h: number } | null>(
    null
  );

  useEffect(() => {
    previousNoteIdRef.current = activeNoteIdRef.current;
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);

  const flushPendingSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const view = viewRef.current;
    if (!view) return;
    const currentId = activeNoteIdRef.current;
    if (!currentId) return;
    const content = view.state.doc.toString();
    const note = useNotesStore.getState().notes.find((n) => n.id === currentId);
    if (note && content !== note.content) {
      updateNoteContent(currentId, content);
    }
  }, [updateNoteContent]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const prevId = previousNoteIdRef.current;
    if (prevId && prevId !== activeNoteId) {
      flushPendingSave();
    }

    const note = notes.find((n) => n.id === activeNoteId);
    if (!note) return;

    const currentDoc = view.state.doc.toString();
    if (currentDoc !== note.content) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: note.content },
      });
    }
  }, [activeNoteId, notes, flushPendingSave]);

  useEffect(() => {
    if (!isOpen || !editorContainerRef.current) return;

    const clamped = (() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        x: Math.max(0, Math.min(position.x, vw - size.width)),
        y: Math.max(0, Math.min(position.y, vh - size.height)),
      };
    })();
    if (clamped.x !== position.x || clamped.y !== position.y) {
      setPosition(clamped);
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString();
        const currentId = activeNoteIdRef.current;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const note = useNotesStore.getState().notes.find((n) => n.id === currentId);
          if (note && newContent !== note.content) {
            updateNoteContent(currentId, newContent);
          }
        }, 300);
      }
    });

    const note = notes.find((n) => n.id === activeNoteId);
    const initialContent = note?.content ?? '';

    const state = EditorState.create({
      doc: initialContent,
      extensions: [...createBaseExtensions('markdown'), updateListener],
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    viewRef.current = view;
    view.focus();

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const finalContent = view.state.doc.toString();
      const currentId = activeNoteIdRef.current;
      if (currentId) {
        const note = useNotesStore.getState().notes.find((n) => n.id === currentId);
        if (note && finalContent !== note.content) {
          updateNoteContent(currentId, finalContent);
        }
      }
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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

  const {
    getTabDragProps,
    containerRef: tabsContainerRef,
    dropIndicatorIndex,
    dragFromIndex,
  } = useDraggableTabs({
    itemCount: notes.length,
    onReorder: reorderNotes,
  });

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, noteId: string) => {
      e.stopPropagation();
      removeNote(noteId);
    },
    [removeNote]
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
        className="flex h-8 shrink-0 cursor-move items-center justify-between bg-surface-1 px-3 select-none"
        onMouseDown={handleDragMouseDown}
      >
        <span className="text-xs font-medium text-primary">Notes</span>
        <button
          onClick={toggleNotes}
          onMouseDown={(e) => e.stopPropagation()}
          className="rounded-md p-0.5 text-secondary hover:bg-surface-3"
        >
          <CloseIcon className="h-3 w-3" />
        </button>
      </div>

      {/* Tab bar */}
      <div
        ref={tabsContainerRef}
        className="flex bg-surface-2 overflow-x-auto px-1 pt-0.5 gap-0.5 items-end shrink-0"
      >
        {notes.map((note, index) => (
          <div key={note.id} className="relative flex">
            {dropIndicatorIndex === index && (
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
            )}
            <NoteTabLabel
              title={note.title}
              isActive={note.id === activeNoteId}
              isDragging={dragFromIndex === index}
              onSelect={() => setActiveNote(note.id)}
              onClose={(e) => handleCloseTab(e, note.id)}
              onRename={(title) => renameNote(note.id, title)}
              dragProps={getTabDragProps(index)}
            />
          </div>
        ))}
        {dropIndicatorIndex === notes.length && (
          <div className="relative flex">
            <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
          </div>
        )}
        <button
          onClick={addNote}
          className="flex items-center justify-center rounded p-0.5 text-secondary hover:bg-surface-1 hover:text-primary mb-0.5"
        >
          <PlusIcon className="h-3 w-3" />
        </button>
      </div>

      {/* CodeMirror container */}
      <div ref={editorContainerRef} className="min-h-0 flex-1 overflow-hidden" />

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
