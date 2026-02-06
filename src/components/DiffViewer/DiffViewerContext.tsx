import { createContext, useContext, ReactNode } from 'react';
import { useDiffViewerState } from '@/hooks/useDiffViewerState';
import { GitPollingResult } from '@/hooks/useGit';

type DiffViewerContextValue = ReturnType<typeof useDiffViewerState>;

const DiffViewerContext = createContext<DiffViewerContextValue | null>(null);

export function DiffViewerProvider({
  gitPolling,
  children,
}: {
  gitPolling: GitPollingResult;
  children: ReactNode;
}) {
  const state = useDiffViewerState(gitPolling);
  return <DiffViewerContext.Provider value={state}>{children}</DiffViewerContext.Provider>;
}

export function useDiffViewer() {
  const context = useContext(DiffViewerContext);
  if (!context) throw new Error('useDiffViewer must be used within DiffViewerProvider');
  return context;
}
