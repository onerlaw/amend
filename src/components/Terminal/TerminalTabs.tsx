import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTerminalStore, TerminalTab } from '@/stores/terminalStore';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore, Project } from '@/stores/projectStore';
import { useCreateTerminal, useCloseTerminal } from '@/hooks/useTerminal';
import { useWorktrees } from '@/hooks/useWorktrees';
import { TerminalPane } from './TerminalPane';
import { WorktreeSelector } from './WorktreeSelector';
import { GitWorktree } from '@/lib/tauri';
import { CloseIcon, FolderIcon, DuplicateIcon, PlusIcon, SpinnerIcon } from '@/components/Icons';
import { getFileName } from '@/lib/fileUtils';
import { useDraggableTabs } from '@/hooks/useDraggableTabs';

function TerminalTabLabel({ tab, projects }: { tab: TerminalTab; projects: Project[] }) {
  const project = tab.projectId ? projects.find((p) => p.id === tab.projectId) : null;
  const worktreeName = getFileName(tab.worktreePath);
  const mainText = tab.title || project?.name || worktreeName;
  const showSubtitle = mainText !== worktreeName;

  return (
    <span className="flex flex-col max-w-[200px] min-w-0">
      <span className="truncate leading-tight">{mainText}</span>
      {showSubtitle && (
        <span className="truncate text-[10px] leading-tight text-tertiary">
          {worktreeName}
        </span>
      )}
    </span>
  );
}

export interface TerminalTabsHandle {
  openNewTerminal: () => void;
  duplicateTerminal: () => void;
}

export const TerminalTabs = forwardRef<TerminalTabsHandle>(function TerminalTabs(_, ref) {
  const { tabs, activeTabId, setActiveTab, reorderTabs } = useTerminalStore();
  const { currentDirectory, setCurrentDirectory } = useFileStore();
  const { setFocusedPanel } = useUIStore();
  const { projects, addProject } = useProjectStore();
  const createTerminal = useCreateTerminal();
  const closeTerminal = useCloseTerminal();
  const initializedRef = useRef(false);
  const { getTabDragProps, containerRef, dropIndicatorIndex, dragFromIndex } = useDraggableTabs({
    itemCount: tabs.length,
    onReorder: reorderTabs,
  });
  const [showWorktreeSelector, setShowWorktreeSelector] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Use selected project's path for worktree listing, or fall back to currentDirectory
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : null;
  const worktreeBasePath = selectedProject?.path ?? currentDirectory;
  const { worktrees, add: addWorktree, remove: removeWorktree } = useWorktrees(worktreeBasePath);

  const autoOpenRef = useRef(false);

  useEffect(() => {
    // Auto-create a terminal when none exist and a project is open
    if (tabs.length === 0 && !initializedRef.current && currentDirectory) {
      initializedRef.current = true;
      const project = projects.find((p) => p.path === currentDirectory);
      createTerminal(currentDirectory, project?.id ?? null).catch((err) => {
        console.error('Failed to create terminal:', err);
        initializedRef.current = false;
      });
    }
    // Reset so a new terminal is auto-created if all tabs are closed later
    if (tabs.length > 0) {
      initializedRef.current = false;
    }
  }, [tabs.length, createTerminal, currentDirectory, projects]);

  const handleDuplicateTerminal = useCallback(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
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

  useEffect(() => {
    // Auto-open folder picker on first launch (no projects, no terminals)
    if (projects.length === 0 && tabs.length === 0 && !autoOpenRef.current) {
      autoOpenRef.current = true;
      handleOpenFolder();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose methods to parent via ref
  useImperativeHandle(
    ref,
    () => ({
      openNewTerminal: handleNewTerminal,
      duplicateTerminal: handleDuplicateTerminal,
    }),
    [handleNewTerminal, handleDuplicateTerminal]
  );

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
      const newWorktree = await addWorktree(
        path,
        isNewBranch ? undefined : branch,
        isNewBranch ? branch : undefined
      );
      setShowWorktreeSelector(false);
      createTerminal(newWorktree.path, selectedProjectId);
      setSelectedProjectId(null);
    } catch (err) {
      console.error('Failed to create worktree:', err);
    }
  };

  const handleWorktreeDelete = async (worktree: GitWorktree) => {
    if (
      !confirm(`Delete worktree "${worktree.path}"?\n\nThis will remove the worktree directory.`)
    ) {
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
    <div
      className="flex h-full flex-col bg-terminal-bg"
      onClick={() => setFocusedPanel('terminal')}
    >
      {/* Tab bar */}
      <div className="flex items-center bg-surface-2 px-1 pt-1 gap-0.5">
        <div ref={containerRef} className="flex flex-1 overflow-x-auto gap-0.5">
          {tabs.map((tab, index) => (
            <div key={tab.id} className="relative flex">
              {dropIndicatorIndex === index && (
                <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
              )}
              <button
                {...getTabDragProps(index)}
                onClick={() => setActiveTab(tab.id)}
                className={`group flex items-center gap-1.5 px-2 py-1 text-xs rounded-t-md ${
                  activeTabId === tab.id
                    ? 'bg-terminal-bg text-primary'
                    : 'text-secondary hover:bg-surface-1 rounded-md'
                } ${dragFromIndex === index ? 'opacity-50' : ''}`}
                title={tab.worktreePath}
              >
                <TerminalTabLabel tab={tab} projects={projects} />
                <span
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleCloseTerminal(e, tab.id)}
                  className="ml-1 rounded-full p-0.5 opacity-0 hover:bg-surface-3 group-hover:opacity-100"
                >
                  <CloseIcon />
                </span>
              </button>
            </div>
          ))}
          {dropIndicatorIndex === tabs.length && (
            <div className="relative flex">
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full z-10 pointer-events-none" />
            </div>
          )}
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
        {tabs.length === 0 && !currentDirectory && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <FolderIcon className="h-12 w-12 text-tertiary" />
            <div>
              <h3 className="text-lg font-medium text-primary mb-1">Open a Project</h3>
              <p className="text-sm text-tertiary">Get started by opening a project folder</p>
            </div>
            <button
              onClick={handleOpenFolder}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              Open Folder
            </button>
            <kbd className="text-xs text-tertiary">⌘O</kbd>
          </div>
        )}
        {tabs.length === 0 && currentDirectory && (
          <div className="flex h-full items-center justify-center gap-2 text-tertiary">
            <SpinnerIcon className="h-4 w-4 animate-spin" />
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
                    <span className="truncate" title={project.path}>
                      {project.name}
                    </span>
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
