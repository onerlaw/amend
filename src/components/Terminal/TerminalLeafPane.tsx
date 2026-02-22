import { useCallback, useRef, useEffect, useState } from 'react';
import { TerminalPane } from './TerminalPane';
import { DropZoneOverlay } from './DropZoneOverlay';
import { TerminalTabLabel } from './TerminalTabs';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { useTerminalDragStore } from '@/stores/terminalDragStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useCloseTerminal } from '@/hooks/useTerminalLifecycle';
import { collectLeaves } from '@/lib/layoutTree';
import { CloseIcon } from '@/components/Icons';
import { isTerminalBusy } from '@/lib/tauri';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const DRAG_THRESHOLD = 5;

interface TerminalLeafPaneProps {
  leafId: string;
  terminalIds: string[];
  activeTerminalId: string;
}

export function TerminalLeafPane({ leafId, terminalIds, activeTerminalId }: TerminalLeafPaneProps) {
  const focusedPaneId = useTerminalLayoutStore((s) => s.focusedPaneId);
  const layout = useTerminalLayoutStore((s) => s.layout);
  const setFocusedPane = useTerminalLayoutStore((s) => s.setFocusedPane);
  const setActiveTerminalInPane = useTerminalLayoutStore((s) => s.setActiveTerminalInPane);
  const tabs = useTerminalStore((s) => s.tabs);
  const closeTerminal = useCloseTerminal();
  const [closingTabId, setClosingTabId] = useState<string | null>(null);

  // Drag state for per-pane tabs
  const dragTerminalRef = useRef<string | null>(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);

  const isFocused = focusedPaneId === leafId;
  const multipleVisible = layout ? collectLeaves(layout).length > 1 : false;
  const showTabBar = multipleVisible || terminalIds.length > 1;

  const handleMouseDown = useCallback(() => {
    if (!isFocused) {
      setFocusedPane(leafId);
    }
  }, [isFocused, leafId, setFocusedPane]);

  const handleTabClick = useCallback(
    (terminalId: string) => {
      setActiveTerminalInPane(leafId, terminalId);
    },
    [leafId, setActiveTerminalInPane]
  );

  const handleCloseTab = useCallback(
    async (e: React.MouseEvent, terminalId: string) => {
      e.stopPropagation();
      const busy = await isTerminalBusy(terminalId);
      if (busy) {
        setClosingTabId(terminalId);
      } else {
        closeTerminal(terminalId);
      }
    },
    [closeTerminal]
  );

  const handleTabMouseDown = useCallback((e: React.MouseEvent, terminalId: string) => {
    if (e.button !== 0) return;
    dragTerminalRef.current = terminalId;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!dragTerminalRef.current || isDraggingRef.current) return;

      const dx = Math.abs(e.clientX - dragStartPos.current.x);
      const dy = Math.abs(e.clientY - dragStartPos.current.y);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;

      isDraggingRef.current = true;
      setDraggingTabId(dragTerminalRef.current);
      useTerminalDragStore.getState().startDrag(dragTerminalRef.current, leafId);
    }

    function handleMouseUp() {
      if (isDraggingRef.current) {
        // DropZoneOverlay handles the actual drop; just clean up if drag ended
        // without a valid drop (endDrag is called by DropZoneOverlay on drop)
        const { isDragging } = useTerminalDragStore.getState();
        if (isDragging) {
          useTerminalDragStore.getState().endDrag();
        }
      }
      dragTerminalRef.current = null;
      isDraggingRef.current = false;
      setDraggingTabId(null);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leafId]);

  return (
    <div
      className={`relative flex h-full w-full flex-col ${
        multipleVisible && isFocused ? 'ring-1 ring-inset ring-accent/50' : ''
      } ${multipleVisible && !isFocused ? 'opacity-50' : ''}`}
      onMouseDown={handleMouseDown}
    >
      {showTabBar && (
        <div className="flex items-center bg-surface-1 px-1 gap-0.5 shrink-0 overflow-x-auto">
          {terminalIds.map((tid) => {
            const tab = tabs.find((t) => t.id === tid);
            if (!tab) return null;
            const isActive = tid === activeTerminalId;
            return (
              <button
                key={tid}
                onMouseDown={(e) => handleTabMouseDown(e, tid)}
                onClick={() => handleTabClick(tid)}
                className={`group flex items-center gap-1 px-1.5 py-0.5 text-[11px] shrink-0 ${
                  isActive ? 'bg-terminal-bg text-primary' : 'text-secondary hover:bg-surface-2 opacity-50 hover:opacity-75'
                } ${draggingTabId === tid ? 'opacity-50' : ''}`}
              >
                <TerminalTabLabel tab={tab} />
                <span
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleCloseTab(e, tid)}
                  className="ml-0.5 rounded-full p-0.5 opacity-0 hover:bg-surface-3 group-hover:opacity-100"
                >
                  <CloseIcon className="h-2.5 w-2.5" />
                </span>
              </button>
            );
          })}
        </div>
      )}
      {closingTabId && (
        <ConfirmDialog
          title="Close Terminal?"
          message="A process is running in this terminal. Close it anyway?"
          confirmLabel="Close"
          confirmClassName="bg-red-600 hover:bg-red-700"
          onConfirm={() => {
            closeTerminal(closingTabId);
            setClosingTabId(null);
          }}
          onCancel={() => setClosingTabId(null)}
        />
      )}
      <div className="flex-1 overflow-hidden relative">
        <TerminalPane key={activeTerminalId} id={activeTerminalId} isActive={true} />
        {terminalIds
          .filter((id) => id !== activeTerminalId)
          .map((id) => (
            <div key={id} className="hidden">
              <TerminalPane id={id} isActive={false} />
            </div>
          ))}
      </div>
      <DropZoneOverlay leafId={leafId} />
    </div>
  );
}
