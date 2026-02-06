import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTerminalStore } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore, Project } from '@/stores/projectStore';
import { useCreateTerminal, useCloseTerminal } from '@/hooks/useTerminal';
import { useWorktrees } from '@/hooks/useWorktrees';
import { TerminalPane } from './TerminalPane';
import { WorktreeSelector } from './WorktreeSelector';
import { GitWorktree } from '@/lib/tauri';
import { CloseIcon, FolderIcon, DuplicateIcon, PlusIcon } from '@/components/Icons';
import { getFileName } from '@/lib/fileUtils';

export interface TerminalTabsHandle {
  openNewTerminal: () => void;
}

export const TerminalTabs = forwardRef<TerminalTabsHandle>(function TerminalTabs(_, ref) {
  const { tabs, activeTabId, setActiveTab } = useTerminalStore();
  const { currentDirectory, setCurrentDirectory } = useFileStore();
  const { setFocusedPanel } = useUIStore();
  const { projects, addProject } = useProjectStore();
  const createTerminal = useCreateTerminal();
  const closeTerminal = useCloseTerminal();
  const initializedRef = useRef(false);
  const [showWorktreeSelector, setShowWorktreeSelector] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Use selected project's path for worktree listing, or fall back to currentDirectory
  const selectedProject = selectedProjectId ? projects.find(p => p.id === selectedProjectId) : null;
  const worktreeBasePath = selectedProject?.path ?? currentDirectory;
  const { worktrees, add: addWorktree, remove: removeWorktree } = useWorktrees(worktreeBasePath);

  useEffect(() => {
    // Create initial terminal if none exists (only once)
    if (tabs.length === 0 && !initializedRef.current && currentDirectory) {
      initializedRef.current = true;
      // Find the project matching currentDirectory to associate with the terminal
      const project = projects.find(p => p.path === currentDirectory);
      createTerminal(currentDirectory, project?.id ?? null).catch((err) => {
        console.error('Failed to create terminal:', err);
        initializedRef.current = false;
      });
    }
  }, [tabs.length, createTerminal, currentDirectory, projects]);

  const handleDuplicateTerminal = useCallback(() => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) return;
    createTerminal(activeTab.worktreePath, activeTab.projectId);
  }, [tabs, activeTabId, createTerminal]);

  const handleNewTerminal = useCallback(() => {
    if (projects.length === 0) {
      // No projects, show open folder dialog
      handleOpenFolder();
      return;
    } else {
      // Show project picker (includes "Open Folder..." option to add new projects)
      setShowProjectPicker(true);
    }
  }, [projects]);

  const handleOpenFolder = useCallback(async () => {
    setShowProjectPicker(false);
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Project Folder',
    });

    if (selected && typeof selected === 'string') {
      // Check if project already exists
      const existing = projects.find((p) => p.path === selected);
      if (existing) {
        setSelectedProjectId(existing.id);
        setShowWorktreeSelector(true);
      } else {
        const newProjectId = addProject(selected);
        setCurrentDirectory(selected);
        setSelectedProjectId(newProjectId);
        setShowWorktreeSelector(true);
      }
    }
  }, [projects, addProject, setCurrentDirectory]);

  // Expose openNewTerminal method to parent via ref
  useImperativeHandle(ref, () => ({
    openNewTerminal: handleNewTerminal,
  }), [handleNewTerminal]);

  const handleProjectSelect = (project: Project) => {
    setSelectedProjectId(project.id);
    setShowProjectPicker(false);
    setShowWorktreeSelector(true);
  };

  const handleProjectPickerCancel = () => {
    setShowProjectPicker(false);
    setSelectedProjectId(null);
  };

  const handleWorktreeSelect = (worktree: GitWorktree) => {
    setShowWorktreeSelector(false);
    createTerminal(worktree.path, selectedProjectId);
    setSelectedProjectId(null);
  };

  const handleWorktreeCreate = async (path: string, branch: string, isNewBranch: boolean) => {
    try {
      const newWorktree = await addWorktree(path, isNewBranch ? undefined : branch, isNewBranch ? branch : undefined);
      setShowWorktreeSelector(false);
      createTerminal(newWorktree.path, selectedProjectId);
      setSelectedProjectId(null);
    } catch (err) {
      console.error('Failed to create worktree:', err);
    }
  };

  const handleWorktreeDelete = async (worktree: GitWorktree) => {
    if (!confirm(`Delete worktree "${worktree.path}"?\n\nThis will remove the worktree directory.`)) {
      return;
    }
    try {
      await removeWorktree(worktree.path);
    } catch (err) {
      console.error('Failed to delete worktree:', err);
      alert(`Failed to delete worktree: ${err}`);
    }
  };

  const handleWorktreeSelectorCancel = () => {
    setShowWorktreeSelector(false);
    setSelectedProjectId(null);
  };

  const handleCloseTerminal = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    closeTerminal(id);
  };

  return (
    <div className="flex h-full flex-col bg-terminal-bg" onClick={() => setFocusedPanel('terminal')}>
      {/* Tab bar */}
      <div className="flex items-center bg-surface-2 px-1 pt-1 gap-0.5">
        <div className="flex flex-1 overflow-x-auto gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-1.5 px-2 py-1 text-xs rounded-t-md ${
                activeTabId === tab.id
                  ? 'bg-terminal-bg text-primary'
                  : 'text-secondary hover:bg-surface-1 rounded-md'
              }`}
              title={tab.worktreePath}
            >
              <span className="truncate max-w-[120px]">{getFileName(tab.worktreePath)}</span>
              <span
                onClick={(e) => handleCloseTerminal(e, tab.id)}
                className="ml-1 rounded-full p-0.5 opacity-0 hover:bg-surface-3 group-hover:opacity-100"
              >
                <CloseIcon />
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 px-1">
          {activeTabId && (
            <button
              onClick={handleDuplicateTerminal}
              className="flex items-center justify-center rounded-md p-1 text-secondary hover:bg-surface-3 hover:text-primary"
              title="Duplicate Terminal"
            >
              <DuplicateIcon />
            </button>
          )}
          <button
            onClick={handleNewTerminal}
            className="flex items-center justify-center rounded-md p-1 text-secondary hover:bg-surface-3 hover:text-primary"
            title="New Terminal"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden relative">
        {tabs.map((tab) => (
          <TerminalPane key={tab.id} id={tab.id} isActive={activeTabId === tab.id} />
        ))}
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center text-tertiary">
            Creating terminal...
          </div>
        )}
        {showProjectPicker && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
            <div className="w-64 rounded-lg bg-surface-2 p-4 shadow-xl">
              <h3 className="mb-3 text-sm font-medium text-primary">Select Project</h3>
              <div className="space-y-1">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleProjectSelect(project)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-primary hover:bg-surface-3"
                  >
                    <FolderIcon className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate" title={project.path}>{project.name}</span>
                  </button>
                ))}
                {/* Open Folder option */}
                <button
                  onClick={handleOpenFolder}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-primary hover:bg-surface-3 border-t border-surface-3 mt-2 pt-2"
                >
                  <FolderIcon className="h-4 w-4 flex-shrink-0" />
                  <span>Open Folder...</span>
                </button>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleProjectPickerCancel}
                  className="rounded-md px-3 py-1.5 text-xs text-secondary hover:bg-surface-3"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {showWorktreeSelector && worktreeBasePath && (
          <WorktreeSelector
            worktrees={worktrees}
            onSelect={handleWorktreeSelect}
            onCreate={handleWorktreeCreate}
            onDelete={handleWorktreeDelete}
            onCancel={handleWorktreeSelectorCancel}
            repoPath={worktreeBasePath}
          />
        )}
      </div>
    </div>
  );
});
