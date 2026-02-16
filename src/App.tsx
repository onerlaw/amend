import { useEffect } from 'react';
import { MainLayout } from '@/components/Layout/MainLayout';
import { useTheme } from '@/hooks/useTheme';
import { useUpdater } from '@/hooks/useUpdater';
import { FileContextMenu } from '@/components/ContextMenu/FileContextMenu';

function App() {
  useTheme();
  useUpdater();

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);
  // test

  return (
    <>
      <MainLayout />
      <FileContextMenu />
    </>
  );
}

export default App;
