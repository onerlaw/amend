import { useEffect } from 'react';
import { useTerminalStore } from '@/stores/terminalStore';
import { getGitRepoInfo } from '@/lib/tauri';

/**
 * Resolves git repo info for all terminal tabs that haven't been resolved yet.
 * Watches the tabs array and triggers resolution when gitRoot is undefined.
 */
export function useTabGitRoots() {
  const tabs = useTerminalStore((s) => s.tabs);
  const setTabRepoInfo = useTerminalStore((s) => s.setTabRepoInfo);

  useEffect(() => {
    let cancelled = false;

    const unresolvedTabs = tabs.filter((t) => t.gitRoot === undefined);
    for (const tab of unresolvedTabs) {
      getGitRepoInfo(tab.cwd).then((info) => {
        if (!cancelled) {
          setTabRepoInfo(tab.id, {
            gitRoot: info?.gitRoot ?? null,
            repoName: info?.repoName ?? null,
            mainRepoRoot: info?.mainRepoRoot ?? null,
            worktreeName: info?.worktreeName ?? null,
          });
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [tabs, setTabRepoInfo]);
}
