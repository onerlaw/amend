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
  setActiveProject: (id: string) => void;
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

      setActiveProject: (id: string) => {
        const project = get().projects.find((p) => p.id === id);
        if (project) {
          set({ activeProjectId: id });
        }
      },
    }),
    {
      name: 'amend-projects',
    }
  )
);
