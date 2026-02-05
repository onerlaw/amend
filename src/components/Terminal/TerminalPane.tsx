import { useEffect, useRef, useCallback, useState } from 'react';
import { useTerminal } from '@/hooks/useTerminal';
import '@xterm/xterm/css/xterm.css';

interface TerminalPaneProps {
  id: string;
  isActive: boolean;
}

export function TerminalPane({ id, isActive }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { initTerminal, fit } = useTerminal(id);
  const initializedRef = useRef(false);
  const [status, setStatus] = useState<'pending' | 'initializing' | 'ready' | 'error'>('pending');

  const initialize = useCallback(async () => {
    if (containerRef.current && !initializedRef.current && id) {
      initializedRef.current = true;
      setStatus('initializing');
      try {
        const success = await initTerminal(containerRef.current);
        if (success) {
          setStatus('ready');
        } else {
          initializedRef.current = false;
          setStatus('error');
        }
      } catch (err) {
        console.error('Failed to initialize terminal:', err);
        initializedRef.current = false;
        setStatus('error');
      }
    }
  }, [id, initTerminal]);

  // Initialize terminal when container has dimensions
  // Use a small delay to let the layout settle (Panel library may adjust sizes)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || initializedRef.current) return;

    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout>;
    let observer: ResizeObserver | null = null;

    const tryInitialize = () => {
      if (!mounted || initializedRef.current) return;

      const width = container.offsetWidth;
      const height = container.offsetHeight;

      if (width > 0 && height > 0) {
        // Add a small delay to ensure layout has settled
        timeoutId = setTimeout(() => {
          if (mounted && !initializedRef.current) {
            initialize();
          }
        }, 50);
      }
    };

    // Set up ResizeObserver to detect when container gets dimensions
    observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        tryInitialize();
      }
    });

    observer.observe(container);

    // Also try immediately in case dimensions are already available
    tryInitialize();

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [initialize]);

  // Handle container resize after initialization
  useEffect(() => {
    const container = containerRef.current;
    if (!container || status !== 'ready') return;

    const observer = new ResizeObserver(() => {
      // Debounce fit calls
      fit();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [fit, status]);

  // Fit when becoming active (in case size changed while inactive)
  useEffect(() => {
    if (isActive && status === 'ready') {
      // Small delay to ensure visibility transition is complete
      const timer = setTimeout(() => fit(), 10);
      return () => clearTimeout(timer);
    }
  }, [isActive, status, fit]);

  // Handle window resize
  useEffect(() => {
    if (!isActive || status !== 'ready') return;

    const handleResize = () => fit();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isActive, status, fit]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 bg-terminal-bg ${isActive ? 'block' : 'hidden'}`}
    >
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm z-10 pointer-events-none">
          {status === 'pending' && 'Waiting to initialize...'}
          {status === 'initializing' && 'Initializing terminal...'}
          {status === 'error' && 'Failed to initialize terminal'}
        </div>
      )}
    </div>
  );
}
