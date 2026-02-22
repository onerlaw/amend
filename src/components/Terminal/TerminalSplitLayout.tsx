import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { LayoutNode } from '@/lib/layoutTree';
import { TerminalLeafPane } from './TerminalLeafPane';

interface TerminalSplitLayoutProps {
  node: LayoutNode;
}

export function TerminalSplitLayout({ node }: TerminalSplitLayoutProps) {
  if (node.type === 'leaf') {
    return (
      <TerminalLeafPane
        leafId={node.id}
        terminalIds={node.terminalIds}
        activeTerminalId={node.activeTerminalId}
      />
    );
  }

  return (
    <PanelGroup direction={node.direction} id={node.id}>
      <Panel id={`${node.id}-first`} defaultSize={node.ratio} minSize={10}>
        <TerminalSplitLayout node={node.first} />
      </Panel>
      <PanelResizeHandle className="data-[resize-handle-state=hover]:bg-accent/30 data-[resize-handle-state=drag]:bg-accent/50 transition-colors flex items-center justify-center">
        <div
          className={
            node.direction === 'horizontal' ? 'w-px h-8 bg-surface-3' : 'h-px w-8 bg-surface-3'
          }
        />
      </PanelResizeHandle>
      <Panel id={`${node.id}-second`} defaultSize={100 - node.ratio} minSize={10}>
        <TerminalSplitLayout node={node.second} />
      </Panel>
    </PanelGroup>
  );
}
