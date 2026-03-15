import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/Layout/MainLayout';
import { useTheme } from '@/hooks/useTheme';
import { useUpdater } from '@/hooks/useUpdater';
import { FileContextMenu } from '@/components/ContextMenu/FileContextMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useTerminalStore } from '@/stores/terminalStore';
import { isTerminalBusy, forceQuitApp, onWindowCloseRequested } from '@/lib/tauri';

function App() {
  useTheme();
  useUpdater();

  const [showQuitDialog, setShowQuitDialog] = useState(false);
  const [busyCount, setBusyCount] = useState(0);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onWindowCloseRequested(async () => {
      const tabs = useTerminalStore.getState().tabs;
      const busyResults = await Promise.all(tabs.map((t) => isTerminalBusy(t.id)));
      const count = busyResults.filter(Boolean).length;
      if (count > 0) {
        setBusyCount(count);
        setShowQuitDialog(true);
      } else {
        forceQuitApp();
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <>
      <MainLayout />
      <FileContextMenu />
      {showQuitDialog && (
        <ConfirmDialog
          title="Quit Amend?"
          message={`${busyCount} terminal${busyCount > 1 ? 's have' : ' has'} a running process. Quit anyway?`}
          confirmLabel="Quit"
          confirmClassName="bg-red-600 hover:bg-red-700"
          onConfirm={() => forceQuitApp()}
          onCancel={() => setShowQuitDialog(false)}
        />
      )}
    </>
  );
}

export default App;
