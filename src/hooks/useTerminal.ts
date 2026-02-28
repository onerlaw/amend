import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  writeToTerminal,
  resizeTerminal,
  closeTerminal,
  onTerminalOutput,
  onTerminalExit,
} from '@/lib/tauri';
import { useTerminalStore } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { FileLinkProvider } from '@/lib/terminalLinks';
import { isDarkMode } from '@/hooks/useTheme';

// Get the terminal theme based on the current app theme
function getTerminalTheme(isDark: boolean) {
  if (isDark) {
    return {
      background: '#0c0c0c',
      foreground: '#fafafa',
      cursor: '#fafafa',
      selectionBackground: '#3b82f6',
      black: '#0c0c0c',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#facc15',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#fafafa',
      brightBlack: '#737373',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde047',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#ffffff',
    };
  }

  // Light theme
  return {
    background: '#fafafa',
    foreground: '#171717',
    cursor: '#171717',
    selectionBackground: '#3b82f6',
    black: '#171717',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#ca8a04',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#fafafa',
    brightBlack: '#a3a3a3',
    brightRed: '#ef4444',
    brightGreen: '#22c55e',
    brightYellow: '#eab308',
    brightBlue: '#3b82f6',
    brightMagenta: '#a855f7',
    brightCyan: '#06b6d4',
    brightWhite: '#ffffff',
  };
}

// --- Terminal instance registry ---
// Stores xterm instances so they survive React component unmount/remount.
// Instances are only destroyed when the terminal is explicitly closed.
interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  decoder: TextDecoder;
  unlisteners: (() => void)[];
}

const terminalRegistry = new Map<string, TerminalEntry>();

/** Explicitly destroy a terminal instance (call when closing a terminal). */
export function destroyTerminalInstance(id: string) {
  const entry = terminalRegistry.get(id);
  if (!entry) return;
  for (const unlisten of entry.unlisteners) {
    unlisten();
  }
  entry.terminal.dispose();
  terminalRegistry.delete(id);
}

/** Get the SearchAddon for a terminal instance. */
export function getSearchAddon(id: string): SearchAddon | null {
  return terminalRegistry.get(id)?.searchAddon ?? null;
}

export function useTerminal(containerId: string | null) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isInitializedRef = useRef(false);

  const themeMode = useUIStore((state) => state.themeMode);
  const fontSize = useUIStore((state) => state.fontSize);

  const fit = useCallback(() => {
    if (fitAddonRef.current && terminalRef.current && containerId && isInitializedRef.current) {
      try {
        const terminal = terminalRef.current;
        // Preserve scroll position: check if user was at the bottom before fit
        const viewport = terminal.buffer.active;
        const wasAtBottom = viewport.baseY + terminal.rows >= viewport.length;

        fitAddonRef.current.fit();
        const { cols, rows } = terminal;
        resizeTerminal(containerId, cols, rows).catch(console.error);

        // Restore scroll position after fit
        if (wasAtBottom) {
          terminal.scrollToBottom();
        } else {
          // Keep the same scroll offset from the top
          terminal.scrollToLine(viewport.viewportY);
        }
      } catch (_e) {
        // Renderer may not be ready yet, ignore
      }
    }
  }, [containerId]);

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (!terminalRef.current || !isInitializedRef.current) return;

    terminalRef.current.options.theme = getTerminalTheme(isDarkMode(themeMode));
  }, [themeMode]);

  // Update terminal font size when it changes
  useEffect(() => {
    if (!terminalRef.current || !isInitializedRef.current) return;
    terminalRef.current.options.fontSize = fontSize;
    fit();
  }, [fontSize, fit]);

  // Also listen for system preference changes when in system mode
  useEffect(() => {
    if (!terminalRef.current || !isInitializedRef.current || themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (terminalRef.current) {
        terminalRef.current.options.theme = getTerminalTheme(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode]);

  const initTerminal = useCallback(
    async (container: HTMLDivElement): Promise<boolean> => {
      if (!containerId) {
        console.error('No container ID provided for terminal');
        return false;
      }
      if (terminalRef.current) {
        return true; // Already initialized in this hook instance
      }

      containerRef.current = container;

      // Check registry for an existing instance (surviving a React remount)
      const existing = terminalRegistry.get(containerId);
      if (existing) {
        // Reattach: move the xterm DOM element into the new container
        const xtermEl = existing.terminal.element;
        if (xtermEl) {
          container.appendChild(xtermEl);
        }
        terminalRef.current = existing.terminal;
        fitAddonRef.current = existing.fitAddon;
        isInitializedRef.current = true;

        // Fit to new container size
        try {
          existing.fitAddon.fit();
          const { cols, rows } = existing.terminal;
          await resizeTerminal(containerId, cols, rows);
        } catch (e) {
          console.warn('Reattach fit failed:', e);
        }

        return true;
      }

      // --- Create a brand new terminal instance ---

      // Determine initial theme
      const currentThemeMode = useUIStore.getState().themeMode;
      const isDark = isDarkMode(currentThemeMode);

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: useUIStore.getState().fontSize,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: getTerminalTheme(isDark),
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      const searchAddon = new SearchAddon();
      terminal.loadAddon(searchAddon);

      terminal.open(container);

      // Try to load WebGL addon with proper error handling
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        terminal.loadAddon(webglAddon);
      } catch (e) {
        console.warn('WebGL addon failed to load, using canvas renderer:', e);
      }

      // Load web links addon for Cmd+Click URL opening
      const webLinksAddon = new WebLinksAddon((_event, uri) => {
        openUrl(uri).catch(console.error);
      });
      terminal.loadAddon(webLinksAddon);

      // Register file link provider for Cmd+Click file opening
      terminal.registerLinkProvider(
        new FileLinkProvider(terminal, () => {
          const tab = useTerminalStore.getState().tabs.find((t) => t.id === containerId);
          return tab?.cwd ?? useFileStore.getState().contextPath;
        })
      );

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Handle Cmd/Ctrl+K to clear terminal; let Cmd/Ctrl+F bubble for search
      terminal.attachCustomKeyEventHandler((e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k' && e.type === 'keydown') {
          terminal.clear();
          return false;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'f' && e.type === 'keydown') {
          return false;
        }
        return true;
      });

      // Set up input handler
      terminal.onData((data) => {
        writeToTerminal(containerId, data).catch(console.error);
      });

      // Set up streaming UTF-8 decoder
      const decoder = new TextDecoder('utf-8', { fatal: false });

      // Set up output listener — references the registry so it works even when
      // the React component is unmounted (terminal backgrounded).
      const unlistenOutput = await onTerminalOutput(containerId, (base64Data) => {
        const entry = terminalRegistry.get(containerId);
        if (!entry) return;
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const text = entry.decoder.decode(bytes, { stream: true });
        entry.terminal.write(text);
      });

      // Set up exit listener - close the tab when the process exits
      const unlistenExit = await onTerminalExit(containerId, () => {
        if (!terminalRegistry.has(containerId)) return;
        closeTerminal(containerId).catch(console.error);
        useTerminalStore.getState().removeTab(containerId);
      });

      // Set up OSC 7 handler for cwd detection (shells emit this after each command)
      const oscDisposable = terminal.parser.registerOscHandler(7, (data) => {
        try {
          const url = new URL(data);
          const cwd = decodeURIComponent(url.pathname);
          if (import.meta.env.DEV)
            console.log('[CWD] OSC 7 received:', { raw: data, parsed: cwd, tabId: containerId });
          if (cwd) {
            useTerminalStore.getState().updateTabCwd(containerId, cwd);
          }
        } catch (e) {
          console.warn('[CWD] OSC 7 parse failed:', { raw: data, error: e });
        }
        return true;
      });

      // Set up title change listener
      const titleDisposable = terminal.onTitleChange((title) => {
        useTerminalStore.getState().setTabTitle(containerId, title);
      });

      // Store in registry BEFORE the first fit so listeners can reference it
      terminalRegistry.set(containerId, {
        terminal,
        fitAddon,
        searchAddon,
        decoder,
        unlisteners: [
          unlistenOutput,
          unlistenExit,
          () => oscDisposable.dispose(),
          () => titleDisposable.dispose(),
        ],
      });

      // Mark as initialized before fitting
      isInitializedRef.current = true;

      // Fit and resize - do this synchronously now that everything is set up
      try {
        fitAddon.fit();
        const { cols, rows } = terminal;
        await resizeTerminal(containerId, cols, rows);
      } catch (e) {
        console.warn('Initial fit failed:', e);
      }

      return true;
    },
    [containerId]
  );

  // On unmount: clear local refs but do NOT destroy the terminal instance.
  // The instance lives in the registry and will be reattached on remount.
  const dispose = useCallback(() => {
    isInitializedRef.current = false;
    terminalRef.current = null;
    fitAddonRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      dispose();
    };
  }, [dispose]);

  return {
    initTerminal,
    fit,
    dispose,
    terminal: terminalRef.current,
    isInitialized: isInitializedRef.current,
  };
}

// Re-export lifecycle hooks that don't depend on xterm
export { useCreateTerminal, useCloseTerminal } from './useTerminalLifecycle';
