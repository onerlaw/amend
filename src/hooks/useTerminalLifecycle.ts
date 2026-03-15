import { useCallback } from 'react';
import { createTerminal as createTerminalBackend, closeTerminal } from '@/lib/tauri';
import { useTerminalStore } from '@/stores/terminalStore';
import { destroyTerminalInstance } from '@/hooks/useTerminal';

export function useCreateTerminal() {
  const addTab = useTerminalStore((state) => state.addTab);

  const create = useCallback(
    async (cwd: string, afterTabId?: string) => {
      try {
        const id = await createTerminalBackend(cwd);
        addTab(id, cwd, afterTabId);
        return id;
      } catch (err) {
        console.error('Failed to create terminal:', err);
        throw err;
      }
    },
    [addTab]
  );

  return create;
}

export function useCloseTerminal() {
  const removeTab = useTerminalStore((state) => state.removeTab);

  const close = useCallback(
    async (id: string) => {
      // Destroy frontend instance first to unregister the exit listener
      // before killing the PTY (which would trigger the exit event and
      // call removeTab a second time).
      destroyTerminalInstance(id);
      removeTab(id);
      await closeTerminal(id).catch(console.error);
    },
    [removeTab]
  );

  return close;
}
