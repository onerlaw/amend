import { useCallback } from 'react';
import { TerminalPane } from './TerminalPane';
import { DropZoneOverlay } from './DropZoneOverlay';
import { useTerminalLayoutStore } from '@/stores/terminalLayoutStore';
import { collectLeaves } from '@/lib/layoutTree';

interface TerminalLeafPaneProps {
  leafId: string;
  terminalId: string;
}

export function TerminalLeafPane({ leafId, terminalId }: TerminalLeafPaneProps) {
  const focusedPaneId = useTerminalLayoutStore((s) => s.focusedPaneId);
  const layout = useTerminalLayoutStore((s) => s.layout);
  const setFocusedPane = useTerminalLayoutStore((s) => s.setFocusedPane);

  const isFocused = focusedPaneId === leafId;
  const multipleVisible = layout ? collectLeaves(layout).length > 1 : false;

  const handleMouseDown = useCallback(() => {
    if (!isFocused) {
      setFocusedPane(leafId);
    }
  }, [isFocused, leafId, setFocusedPane]);

  return (
    <div
      className={`relative h-full w-full ${
        multipleVisible && isFocused ? 'ring-1 ring-inset ring-accent/50' : ''
      }`}
      onMouseDown={handleMouseDown}
    >
      <TerminalPane key={terminalId} id={terminalId} isActive={true} />
      <DropZoneOverlay leafId={leafId} />
    </div>
  );
}
