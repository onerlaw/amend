import { create } from 'zustand';

interface TerminalDragState {
  isDragging: boolean;
  draggedTerminalId: string | null;
  dragSourceLeafId: string | null;
  rootDropActive: boolean;

  startDrag: (terminalId: string, sourceLeafId?: string | null) => void;
  endDrag: () => void;
  setRootDropActive: (active: boolean) => void;
}

export const useTerminalDragStore = create<TerminalDragState>((set) => ({
  isDragging: false,
  draggedTerminalId: null,
  dragSourceLeafId: null,
  rootDropActive: false,

  startDrag: (terminalId, sourceLeafId = null) => {
    set({ isDragging: true, draggedTerminalId: terminalId, dragSourceLeafId: sourceLeafId });
  },

  endDrag: () => {
    set({
      isDragging: false,
      draggedTerminalId: null,
      dragSourceLeafId: null,
      rootDropActive: false,
    });
  },

  setRootDropActive: (active) => {
    set({ rootDropActive: active });
  },
}));
