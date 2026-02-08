import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  createTerminal as createTerminalBackend,
  writeToTerminal,
  resizeTerminal,
  closeTerminal,
  onTerminalOutput,
  onTerminalExit,
} from '@/lib/tauri';
import { useTerminalStore } from '@/stores/terminalStore';
import { useUIStore } from '@/stores/uiStore';
import { isDarkMode } from '@/hooks/useTheme';

let initializationCounter = 0;

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

export function useTerminal(containerId: string | null) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const unlistenRef = useRef<(() => void)[]>([]);
  const decoderRef = useRef<TextDecoder | null>(null);
  const currentInitIdRef = useRef<number>(0);
  const isInitializedRef = useRef(false);

  const themeMode = useUIStore((state) => state.themeMode);

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
      } catch (e) {
        // Renderer may not be ready yet, ignore
      }
    }
  }, [containerId]);

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (!terminalRef.current || !isInitializedRef.current) return;

    terminalRef.current.options.theme = getTerminalTheme(isDarkMode(themeMode));
  }, [themeMode]);

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
        return true; // Already initialized
      }

      containerRef.current = container;

      // Create unique ID for this initialization to prevent stale listeners from processing events
      const initId = ++initializationCounter;
      currentInitIdRef.current = initId;

      // Determine initial theme
      const currentThemeMode = useUIStore.getState().themeMode;
      const isDark = isDarkMode(currentThemeMode);

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: getTerminalTheme(isDark),
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

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

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Set up input handler
      terminal.onData((data) => {
        writeToTerminal(containerId, data).catch(console.error);
      });

      // Set up streaming UTF-8 decoder
      decoderRef.current = new TextDecoder('utf-8', { fatal: false });

      // Set up output listener (per-terminal, base64-encoded)
      const listenerInitId = initId;
      const unlistenOutput = await onTerminalOutput(containerId, (base64Data) => {
        if (listenerInitId !== currentInitIdRef.current) return;
        if (!terminalRef.current || !decoderRef.current) return;
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const text = decoderRef.current.decode(bytes, { stream: true });
        terminalRef.current.write(text);
      });

      // Set up exit listener - close the tab when the process exits
      const unlistenExit = await onTerminalExit(containerId, () => {
        if (listenerInitId !== currentInitIdRef.current) return;
        closeTerminal(containerId).catch(console.error);
        useTerminalStore.getState().removeTab(containerId);
      });

      // Set up title change listener
      const titleDisposable = terminal.onTitleChange((title) => {
        useTerminalStore.getState().setTabTitle(containerId, title);
      });

      unlistenRef.current = [unlistenOutput, unlistenExit, () => titleDisposable.dispose()];

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

  const dispose = useCallback(() => {
    currentInitIdRef.current = 0; // Invalidate current init ID to stop event processing
    isInitializedRef.current = false;
    for (const unlisten of unlistenRef.current) {
      unlisten();
    }
    unlistenRef.current = [];
    decoderRef.current = null;
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
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

export function useCreateTerminal() {
  const addTab = useTerminalStore((state) => state.addTab);

  const create = useCallback(
    async (worktreePath: string, projectId: string | null = null, afterTabId?: string) => {
      try {
        const id = await createTerminalBackend(worktreePath);
        addTab(id, worktreePath, projectId, afterTabId);
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
      await closeTerminal(id);
      removeTab(id);
    },
    [removeTab]
  );

  return close;
}
