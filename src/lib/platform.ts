export const isMac = navigator.platform.toUpperCase().includes('MAC');
export const isWindows = navigator.platform.toUpperCase().includes('WIN');
export const modifierKey = isMac ? '⌘' : 'Ctrl';
export const revealLabel = isMac
  ? 'Reveal in Finder'
  : isWindows
    ? 'Reveal in File Explorer'
    : 'Open Containing Folder';
