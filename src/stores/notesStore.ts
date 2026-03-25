import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Note {
  id: string;
  title: string;
  content: string;
}

interface NotesState {
  isOpen: boolean;
  notes: Note[];
  activeNoteId: string;
  nextNoteNumber: number;
  position: { x: number; y: number };
  size: { width: number; height: number };

  toggleNotes: () => void;
  addNote: () => void;
  removeNote: (id: string) => void;
  setActiveNote: (id: string) => void;
  updateNoteContent: (id: string, content: string) => void;
  renameNote: (id: string, title: string) => void;
  reorderNotes: (fromIndex: number, toIndex: number) => void;
  setPosition: (position: { x: number; y: number }) => void;
  setSize: (size: { width: number; height: number }) => void;
}

function makeNote(nextNumber: number): Note {
  return {
    id: crypto.randomUUID(),
    title: `Note ${nextNumber}`,
    content: '',
  };
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      notes: [],
      activeNoteId: '',
      nextNoteNumber: 1,
      position: { x: 400, y: 70 },
      size: { width: 400, height: 300 },

      toggleNotes: () => set((state) => ({ isOpen: !state.isOpen })),

      addNote: () => {
        const { nextNoteNumber } = get();
        const note = makeNote(nextNoteNumber);
        set((state) => ({
          notes: [...state.notes, note],
          activeNoteId: note.id,
          nextNoteNumber: state.nextNoteNumber + 1,
        }));
      },

      removeNote: (id: string) => {
        const state = get();
        if (state.notes.length <= 1) return;
        const index = state.notes.findIndex((n) => n.id === id);
        const newNotes = state.notes.filter((n) => n.id !== id);
        let newActiveId = state.activeNoteId;
        if (state.activeNoteId === id) {
          newActiveId = newNotes[Math.min(index, newNotes.length - 1)].id;
        }
        set({ notes: newNotes, activeNoteId: newActiveId });
      },

      setActiveNote: (id: string) => set({ activeNoteId: id }),

      updateNoteContent: (id: string, content: string) => {
        set((state) => ({
          notes: state.notes.map((n) => (n.id === id ? { ...n, content } : n)),
        }));
      },

      renameNote: (id: string, title: string) => {
        set((state) => ({
          notes: state.notes.map((n) => (n.id === id ? { ...n, title } : n)),
        }));
      },

      reorderNotes: (fromIndex: number, toIndex: number) => {
        set((state) => {
          const newNotes = [...state.notes];
          const [moved] = newNotes.splice(fromIndex, 1);
          newNotes.splice(toIndex, 0, moved);
          return { notes: newNotes };
        });
      },

      setPosition: (position: { x: number; y: number }) => set({ position }),
      setSize: (size: { width: number; height: number }) => set({ size }),
    }),
    {
      name: 'amend-notes',
      partialize: (state) => ({
        isOpen: state.isOpen,
        notes: state.notes,
        activeNoteId: state.activeNoteId,
        nextNoteNumber: state.nextNoteNumber,
        position: state.position,
        size: state.size,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.notes.length === 0) {
          state.notes = [makeNote(state.nextNoteNumber)];
          state.nextNoteNumber += 1;
        }
        if (!state.activeNoteId && state.notes.length > 0) {
          state.activeNoteId = state.notes[0].id;
        }
        if (state.nextNoteNumber <= 1 && state.notes.length > 0) {
          let max = 0;
          for (const note of state.notes) {
            const match = note.title.match(/^Note (\d+)$/);
            if (match) max = Math.max(max, parseInt(match[1], 10));
          }
          state.nextNoteNumber = max + 1;
        }
      },
    }
  )
);
