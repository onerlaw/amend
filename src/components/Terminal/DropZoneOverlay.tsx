import { useState, useCallback } from 'react';
import { useTerminalDragStore } from '@/stores/terminalDragStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { findLeafByTerminalId } from '@/lib/layoutTree';

type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center' | null;

interface DropZoneOverlayProps {
  leafId: string;
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

    const edgeThreshold = 0.3;

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
      // Remove from old position first if it was in layout
      if (layout && findLeafByTerminalId(layout, draggedTerminalId)) {
        removeFromLayout(draggedTerminalId);
      }
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
      {/* Left zone */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[30%] transition-colors ${
          hoveredZone === 'left' ? 'bg-accent/20' : ''
        }`}
      />
      {/* Right zone */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-[30%] transition-colors ${
          hoveredZone === 'right' ? 'bg-accent/20' : ''
        }`}
      />
      {/* Top zone */}
      <div
        className={`absolute top-0 left-[30%] right-[30%] h-[30%] transition-colors ${
          hoveredZone === 'top' ? 'bg-accent/20' : ''
        }`}
      />
      {/* Bottom zone */}
      <div
        className={`absolute bottom-0 left-[30%] right-[30%] h-[30%] transition-colors ${
          hoveredZone === 'bottom' ? 'bg-accent/20' : ''
        }`}
      />
      {/* Center zone */}
      <div
        className={`absolute top-[30%] bottom-[30%] left-[30%] right-[30%] transition-colors ${
          hoveredZone === 'center' ? 'bg-accent/20' : ''
        }`}
      />
    </div>
  );
}
