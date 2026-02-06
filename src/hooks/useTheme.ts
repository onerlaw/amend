import { useEffect } from 'react';
import { useUIStore, ThemeMode } from '@/stores/uiStore';

export function isDarkMode(themeMode: ThemeMode): boolean {
  return (
    themeMode === 'dark' ||
    (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  );
}

export function useTheme() {
  const { themeMode, setThemeMode } = useUIStore();

  // Apply theme class to document
  useEffect(() => {
    const updateTheme = () => {
      if (isDarkMode(themeMode)) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    updateTheme();

    // Listen for system preference changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (themeMode === 'system') {
        updateTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode]);

  const cycleTheme = () => {
    const modes: ThemeMode[] = ['light', 'dark', 'system'];
    const currentIndex = modes.indexOf(themeMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setThemeMode(modes[nextIndex]);
  };

  return {
    themeMode,
    setThemeMode,
    cycleTheme,
  };
}
