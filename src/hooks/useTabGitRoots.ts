import { useEffect } from 'react';
import { useTerminalStore } from '@/stores/terminalStore';
import { getGitRoot } from '@/lib/tauri';

/**
 * Resolves git roots for all terminal tabs that haven't been resolved yet.
 * Watches the tabs array and triggers resolution when gitRoot is undefined.
 */
export function useTabGitRoots() {
  const tabs = useTerminalStore((s) => s.tabs);
  const setTabGitRoot = useTerminalStore((s) => s.setTabGitRoot);

  useEffect(() => {
    let cancelled = false;

    const unresolvedTabs = tabs.filter((t) => t.gitRoot === undefined);
    for (const tab of unresolvedTabs) {
      getGitRoot(tab.cwd).then((root) => {
        if (!cancelled) {
          setTabGitRoot(tab.id, root);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [tabs, setTabGitRoot]);
}
