import { create } from 'zustand';
import {
  listSessionsForTerminal,
  getSession as getSessionCmd,
  deleteSession as deleteSessionCmd,
  getActiveSessionIdForTerminal,
} from '@/lib/tauri';
import { useTerminalStore } from '@/stores/terminalStore';

export interface TimelineSession {
  id: string;
  terminalId: string | null;
  startedAt: number;
  stoppedAt: number | null;
  label: string;
  eventCount: number;
}

export interface TimelineEvent {
  type: 'commandStart' | 'commandEnd' | 'fileChanged' | 'gitStatusChanged' | 'terminalOutput' | 'agentActivity';
  timestamp: number;
  [key: string]: unknown;
}

interface TimelineState {
  sessions: TimelineSession[];
  activeSessionId: string | null;
  events: TimelineEvent[];
  liveSessionId: string | null;
  currentTerminalId: string | null;

  setCurrentTerminalId: (id: string | null) => void;
  loadSessions: (terminalId?: string) => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  setLiveSessionId: (id: string | null) => void;
  refreshActiveSession: () => Promise<void>;
  initLiveSessionForTerminal: (terminalId: string) => Promise<void>;
}

export const useTimelineStore = create<TimelineState>()((set, get) => ({
  sessions: [],
  activeSessionId: null,
  events: [],
  liveSessionId: null,
  currentTerminalId: null,

  setCurrentTerminalId: (id: string | null) => {
    set({ currentTerminalId: id });
    if (id) {
      get().loadSessions(id);
      get().initLiveSessionForTerminal(id);
    } else {
      get().loadSessions();
    }
  },

  loadSessions: async (terminalId?: string) => {
    const sessions = await listSessionsForTerminal(terminalId);
    set({ sessions });
  },

  selectSession: async (id: string) => {
    const session = await getSessionCmd(id);
    set({
      activeSessionId: id,
      events: session.events as TimelineEvent[],
    });
  },

  deleteSession: async (id: string) => {
    await deleteSessionCmd(id);
    const { activeSessionId, liveSessionId, currentTerminalId } = get();
    if (activeSessionId === id) {
      set({ activeSessionId: null, events: [] });
    }
    if (liveSessionId === id) {
      set({ liveSessionId: null });
    }
    await get().loadSessions(currentTerminalId ?? undefined);
  },

  setLiveSessionId: (id: string | null) => {
    set({ liveSessionId: id, activeSessionId: id, events: [] });
    if (id) {
      get().selectSession(id);
    }
  },

  refreshActiveSession: async () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    const session = await getSessionCmd(activeSessionId);
    set({ events: session.events as TimelineEvent[] });
  },

  initLiveSessionForTerminal: async (terminalId: string) => {
    const id = await getActiveSessionIdForTerminal(terminalId);
    if (id) {
      get().setLiveSessionId(id);
    } else {
      set({ liveSessionId: null, activeSessionId: null, events: [] });
    }
  },
}));

// Helper to initialize the live session from the active terminal
export async function initLiveSession() {
  const terminalId = useTerminalStore.getState().activeTabId;
  if (terminalId) {
    await useTimelineStore.getState().initLiveSessionForTerminal(terminalId);
  }
}
