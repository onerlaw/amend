import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask } from '@tauri-apps/plugin-dialog';

export async function checkForUpdates(silent: boolean = true) {
  try {
    const update = await check();
    if (!update) return;

    const shouldUpdate = await ask(
      `Version ${update.version} is available. Would you like to download and install it?`,
      { title: 'Update Available', kind: 'info', okLabel: 'Download', cancelLabel: 'Skip' }
    );

    if (!shouldUpdate) return;

    await update.downloadAndInstall();

    const shouldRestart = await ask(
      'Update installed successfully. Restart now to apply the update?',
      { title: 'Restart Required', kind: 'info', okLabel: 'Restart', cancelLabel: 'Later' }
    );

    if (shouldRestart) {
      await relaunch();
    }
  } catch (e) {
    if (!silent) throw e;
  }
}

export function useUpdater() {
  useEffect(() => {
    checkForUpdates(true);
  }, []);
}
