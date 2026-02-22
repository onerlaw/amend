import { useState, useCallback, type ReactNode } from 'react';
import { useTerminalDragStore } from '@/stores/terminalDragStore';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves } from '@/lib/layoutTree';

type RootEdge = 'left' | 'right' | 'top' | 'bottom';

interface RootDropZoneProps {
  children: ReactNode;
}

function RootEdgeStrip({ edge, onDrop }: { edge: RootEdge; onDrop: (edge: RootEdge) => void }) {
  const [hovered, setHovered] = useState(false);
  const setRootDropActive = useTerminalDragStore((s) => s.setRootDropActive);

  const handleMouseEnter = useCallback(() => {
    setHovered(true);
    setRootDropActive(true);
  }, [setRootDropActive]);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    setRootDropActive(false);
  }, [setRootDropActive]);

  const handleMouseUp = useCallback(() => {
    onDrop(edge);
    setHovered(false);
    setRootDropActive(false);
  }, [edge, onDrop, setRootDropActive]);

  const stripClass: Record<RootEdge, string> = {
    left: 'left-0 top-0 bottom-0 w-12',
    right: 'right-0 top-0 bottom-0 w-12',
    top: 'left-0 top-0 right-0 h-12',
    bottom: 'left-0 bottom-0 right-0 h-12',
  };

  const previewClass: Record<RootEdge, string> = {
    left: 'left-0 top-0 bottom-0 w-1/3',
    right: 'right-0 top-0 bottom-0 w-1/3',
    top: 'left-0 top-0 right-0 h-1/3',
    bottom: 'left-0 bottom-0 right-0 h-1/3',
  };

  return (
    <>
      <div
        className={`absolute ${stripClass[edge]} z-30`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
      />
      {hovered && (
        <div
          className={`absolute ${previewClass[edge]} z-[25] rounded-md bg-accent/25 border-2 border-accent/60 pointer-events-none`}
        />
      )}
    </>
  );
}

export function RootDropZone({ children }: RootDropZoneProps) {
  const isDragging = useTerminalDragStore((s) => s.isDragging);
  const draggedTerminalId = useTerminalDragStore((s) => s.draggedTerminalId);
  const endDrag = useTerminalDragStore((s) => s.endDrag);
  const layout = useTerminalLayoutStore((s) => s.layout);
  const splitAtRoot = useTerminalLayoutStore((s) => s.splitAtRoot);

  const leafCount = layout ? collectLeaves(layout).length : 0;
  const showRootDropZones = isDragging && leafCount > 1;

  const handleDrop = useCallback(
    (edge: RootEdge) => {
      if (!draggedTerminalId) {
        endDrag();
        return;
      }

      const direction: 'horizontal' | 'vertical' =
        edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';
      const side: 'first' | 'second' =
        edge === 'left' || edge === 'top' ? 'first' : 'second';

      splitAtRoot(direction, side, draggedTerminalId);
      endDrag();
    },
    [draggedTerminalId, splitAtRoot, endDrag]
  );

  return (
    <div className="relative w-full h-full">
      {children}
      {showRootDropZones && (
        <>
          <RootEdgeStrip edge="left" onDrop={handleDrop} />
          <RootEdgeStrip edge="right" onDrop={handleDrop} />
          <RootEdgeStrip edge="top" onDrop={handleDrop} />
          <RootEdgeStrip edge="bottom" onDrop={handleDrop} />
        </>
      )}
    </div>
  );
}
