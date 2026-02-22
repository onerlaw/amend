import { useState, useRef, useCallback, useEffect } from 'react';
import { useTerminalDragStore } from '@/stores/terminalDragStore';
import { useTerminalStore } from '@/stores/terminalStore';

interface UseDraggableTabsOptions {
  itemCount: number;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

const DRAG_THRESHOLD = 5;

export function useDraggableTabs({ itemCount, onReorder }: UseDraggableTabsOptions) {
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);

  const dragFromRef = useRef<number | null>(null);
  const dropIndicatorRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const inSplitModeRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const tabElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const containerRef = useRef<HTMLElement | null>(null);
  const tabRectsRef = useRef<DOMRect[]>([]);
  const containerRectRef = useRef<DOMRect | null>(null);

  // Keep latest values in refs so the document-level listeners never go stale
  const itemCountRef = useRef(itemCount);
  const onReorderRef = useRef(onReorder);
  itemCountRef.current = itemCount;
  onReorderRef.current = onReorder;

  useEffect(() => {
    function calculateDropIndex(clientX: number): number | null {
      const rects = tabRectsRef.current;
      const from = dragFromRef.current;
      if (from === null || rects.length === 0) return null;

      for (let i = 0; i < rects.length; i++) {
        const midX = rects[i].left + rects[i].width / 2;
        if (clientX < midX) {
          if (i === from || i === from + 1) return null;
          return i;
        }
      }

      const last = rects.length;
      if (last === from || last === from + 1) return null;
      return last;
    }

    function reset() {
      dragFromRef.current = null;
      dropIndicatorRef.current = null;
      isDraggingRef.current = false;
      inSplitModeRef.current = false;
      tabRectsRef.current = [];
      containerRectRef.current = null;
      setDragFromIndex(null);
      setDropIndicatorIndex(null);
    }

    function handleMouseMove(e: MouseEvent) {
      if (dragFromRef.current === null) return;

      if (!isDraggingRef.current) {
        const dx = Math.abs(e.clientX - startXRef.current);
        const dy = Math.abs(e.clientY - startYRef.current);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        isDraggingRef.current = true;
        setDragFromIndex(dragFromRef.current);

        // Snapshot all tab positions at drag start
        const rects: DOMRect[] = [];
        for (let i = 0; i < itemCountRef.current; i++) {
          const el = tabElementsRef.current.get(i);
          if (el) rects.push(el.getBoundingClientRect());
        }
        tabRectsRef.current = rects;
        containerRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
      }

      // Check if cursor has moved below the tab bar — transition to split mode
      const cRect = containerRectRef.current;
      if (cRect && e.clientY > cRect.bottom && !inSplitModeRef.current) {
        // Only allow split mode if there's more than 1 tab
        const tabs = useTerminalStore.getState().tabs;
        if (tabs.length > 1) {
          inSplitModeRef.current = true;
          const fromIdx = dragFromRef.current;
          if (fromIdx !== null && fromIdx < tabs.length) {
            const terminalId = tabs[fromIdx].id;
            useTerminalDragStore.getState().startDrag(terminalId);
          }
          // Clear reorder indicator
          dropIndicatorRef.current = null;
          setDropIndicatorIndex(null);
        }
        return;
      }

      // If in split mode, let the DropZoneOverlay handle everything
      if (inSplitModeRef.current) return;

      // Clear indicator if cursor leaves the container vertically
      if (cRect && (e.clientY < cRect.top || e.clientY > cRect.bottom)) {
        dropIndicatorRef.current = null;
        setDropIndicatorIndex(null);
        return;
      }

      const idx = calculateDropIndex(e.clientX);
      dropIndicatorRef.current = idx;
      setDropIndicatorIndex(idx);
    }

    function handleMouseUp() {
      if (inSplitModeRef.current) {
        useTerminalDragStore.getState().endDrag();
      } else if (isDraggingRef.current) {
        const from = dragFromRef.current;
        const indicator = dropIndicatorRef.current;
        if (from !== null && indicator !== null) {
          let to = indicator;
          if (from < to) to -= 1;
          if (from !== to) {
            onReorderRef.current(from, to);
          }
        }
      }
      reset();
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const setContainerRef = useCallback((el: HTMLElement | null) => {
    containerRef.current = el;
  }, []);

  const getTabDragProps = useCallback(
    (index: number) => ({
      ref: (el: HTMLElement | null) => {
        if (el) tabElementsRef.current.set(index, el);
        else tabElementsRef.current.delete(index);
      },
      onMouseDown: (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        dragFromRef.current = index;
        startXRef.current = e.clientX;
        startYRef.current = e.clientY;
      },
    }),
    []
  );

  return { getTabDragProps, containerRef: setContainerRef, dropIndicatorIndex, dragFromIndex };
}
