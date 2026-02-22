import { useState, useCallback } from 'react';
import { useTerminalDragStore } from '@/stores/terminalDragStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { findLeafByTerminalId } from '@/lib/layoutTree';

type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center' | null;

interface DropZoneOverlayProps {
  leafId: string;
}

/** Placement preview: shows where the dropped terminal will appear. */
function DropPreview({ zone }: { zone: DropZone }) {
  if (!zone) return null;

  // For edge zones, show a half-pane highlight where the new split will appear.
  // For center, highlight the full pane to indicate "add to this tab group".
  const previewStyle: Record<NonNullable<DropZone>, string> = {
    left: 'left-1 top-1 bottom-1 w-[calc(50%-4px)]',
    right: 'right-1 top-1 bottom-1 w-[calc(50%-4px)]',
    top: 'left-1 top-1 right-1 h-[calc(50%-4px)]',
    bottom: 'left-1 bottom-1 right-1 h-[calc(50%-4px)]',
    center: 'inset-1',
  };

  return (
    <div
      className={`absolute ${previewStyle[zone]} rounded-md bg-accent/25 border-2 border-accent/60 pointer-events-none transition-all duration-100`}
    />
  );
}

export function DropZoneOverlay({ leafId }: DropZoneOverlayProps) {
  const isDragging = useTerminalDragStore((s) => s.isDragging);
  const draggedTerminalId = useTerminalDragStore((s) => s.draggedTerminalId);
  const endDrag = useTerminalDragStore((s) => s.endDrag);
  const splitPane = useTerminalLayoutStore((s) => s.splitPane);
  const assignTerminalToPane = useTerminalLayoutStore((s) => s.assignTerminalToPane);
  const layout = useTerminalLayoutStore((s) => s.layout);
  const removeFromLayout = useTerminalLayoutStore((s) => s.removeFromLayout);

  const [hoveredZone, setHoveredZone] = useState<DropZone>(null);

  const getZone = useCallback((e: React.MouseEvent<HTMLDivElement>): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const edgeThreshold = 0.25;

    if (x < edgeThreshold) return 'left';
    if (x > 1 - edgeThreshold) return 'right';
    if (y < edgeThreshold) return 'top';
    if (y > 1 - edgeThreshold) return 'bottom';
    return 'center';
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setHoveredZone(getZone(e));
    },
    [getZone]
  );

  const handleMouseUp = useCallback(() => {
    if (!draggedTerminalId || !hoveredZone) {
      endDrag();
      return;
    }

    // Don't drop on self (same leaf showing same terminal)
    if (layout) {
      const sourceLeaf = findLeafByTerminalId(layout, draggedTerminalId);
      if (sourceLeaf && sourceLeaf.id === leafId && hoveredZone === 'center') {
        endDrag();
        return;
      }
    }

    if (hoveredZone === 'center') {
      // assignTerminalToPane handles removing from source leaf internally
      assignTerminalToPane(leafId, draggedTerminalId);
    } else {
      const direction: 'horizontal' | 'vertical' =
        hoveredZone === 'left' || hoveredZone === 'right' ? 'horizontal' : 'vertical';
      const side: 'first' | 'second' =
        hoveredZone === 'left' || hoveredZone === 'top' ? 'first' : 'second';

      // Remove from old position if it was in layout
      if (layout && findLeafByTerminalId(layout, draggedTerminalId)) {
        removeFromLayout(draggedTerminalId);
      }
      splitPane(leafId, direction, side, draggedTerminalId);
    }

    endDrag();
  }, [
    draggedTerminalId,
    hoveredZone,
    leafId,
    layout,
    splitPane,
    assignTerminalToPane,
    removeFromLayout,
    endDrag,
  ]);

  const handleMouseLeave = useCallback(() => {
    setHoveredZone(null);
  }, []);

  if (!isDragging) return null;

  return (
    <div
      className="absolute inset-0 z-20"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* Translucent scrim so the preview stands out */}
      <div className="absolute inset-0 bg-black/20 pointer-events-none" />

      {/* Placement preview */}
      <DropPreview zone={hoveredZone} />
    </div>
  );
}
