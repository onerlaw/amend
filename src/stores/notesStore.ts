import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotesState {
  isOpen: boolean;
  content: string;
  position: { x: number; y: number };
  size: { width: number; height: number };

  toggleNotes: () => void;
  setContent: (content: string) => void;
  setPosition: (position: { x: number; y: number }) => void;
  setSize: (size: { width: number; height: number }) => void;
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
      isOpen: false,
      content: '',
      position: { x: 400, y: 70 },
      size: { width: 400, height: 300 },

      toggleNotes: () => set((state) => ({ isOpen: !state.isOpen })),
      setContent: (content: string) => set({ content }),
      setPosition: (position: { x: number; y: number }) => set({ position }),
      setSize: (size: { width: number; height: number }) => set({ size }),
    }),
    {
      name: 'amend-notes',
      partialize: (state) => ({
        isOpen: state.isOpen,
        content: state.content,
        position: state.position,
        size: state.size,
      }),
    }
  )
);
