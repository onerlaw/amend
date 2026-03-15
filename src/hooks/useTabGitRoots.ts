import { useEffect, useRef } from 'react';
import { useTerminalStore } from '@/stores/terminalStore';
import { getGitRepoInfo } from '@/lib/tauri';

/**
 * Resolves git repo info for all terminal tabs that haven't been resolved yet.
 * Watches the tabs array and triggers resolution when gitRoot is undefined.
 * Also periodically re-checks tabs where gitRoot is null (no repo detected)
 * so that running `git init` in an existing tab is picked up automatically.
 */
export function useTabGitRoots() {
  const tabs = useTerminalStore((s) => s.tabs);
  const setTabRepoInfo = useTerminalStore((s) => s.setTabRepoInfo);

  // Keep a ref so the polling interval can read current tabs without re-mounting
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

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
            branchName: info?.currentBranch ?? null,
          });
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [tabs, setTabRepoInfo]);

  // Periodically re-check tabs where gitRoot is null (not a repo yet).
  // This detects `git init` in an existing terminal tab.
  useEffect(() => {
    let cancelled = false;

    const interval = setInterval(() => {
      const currentTabs = tabsRef.current;
      const nonGitTabs = currentTabs.filter((t) => t.gitRoot === null);
      for (const tab of nonGitTabs) {
        getGitRepoInfo(tab.cwd).then((info) => {
          if (cancelled) return;
          if (info) {
            setTabRepoInfo(tab.id, {
              gitRoot: info.gitRoot,
              repoName: info.repoName,
              mainRepoRoot: info.mainRepoRoot ?? null,
              worktreeName: info.worktreeName ?? null,
              branchName: info.currentBranch ?? null,
            });
          }
        });
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setTabRepoInfo]);
}
