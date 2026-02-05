import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  addProject: (path: string, name?: string) => string;
  removeProject: (id: string) => void;
  setActiveProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  getActiveProject: () => Project | null;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,

      addProject: (path: string, name?: string) => {
        const id = crypto.randomUUID();
        const projectName = name ?? path.split('/').pop() ?? 'Unnamed Project';
        const newProject: Project = {
          id,
          name: projectName,
          path,
          addedAt: Date.now(),
        };
        set((state) => ({
          projects: [...state.projects, newProject],
          activeProjectId: id,
        }));
        return id;
      },

      removeProject: (id: string) => {
        set((state) => {
          const newProjects = state.projects.filter((p) => p.id !== id);
          const newActiveId =
            state.activeProjectId === id
              ? newProjects.length > 0
                ? newProjects[newProjects.length - 1].id
                : null
              : state.activeProjectId;
          return {
            projects: newProjects,
            activeProjectId: newActiveId,
          };
        });
      },

      setActiveProject: (id: string) => {
        const project = get().projects.find((p) => p.id === id);
        if (project) {
          set({ activeProjectId: id });
        }
      },

      renameProject: (id: string, name: string) => {
        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? { ...p, name } : p)),
        }));
      },

      getActiveProject: () => {
        const state = get();
        return state.projects.find((p) => p.id === state.activeProjectId) ?? null;
      },
    }),
    {
      name: 'amend-projects',
    }
  )
);
