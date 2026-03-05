import { create } from 'zustand';
import {
  startSessionRecording,
  stopSessionRecording,
  listSessions as listSessionsCmd,
  getSession as getSessionCmd,
  deleteSession as deleteSessionCmd,
} from '@/lib/tauri';

export interface TimelineSession {
  id: string;
  terminalId: string;
  startedAt: number;
  stoppedAt: number | null;
  label: string;
  eventCount: number;
}

export interface TimelineEvent {
  type: 'commandStart' | 'commandEnd' | 'fileChanged' | 'gitStatusChanged' | 'terminalOutput';
  timestamp: number;
  [key: string]: unknown;
}

interface TimelineState {
  sessions: TimelineSession[];
  activeSessionId: string | null;
  events: TimelineEvent[];
  isRecording: boolean;
  playbackPosition: number | null;

  startRecording: (terminalId: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  setPlaybackPosition: (timestamp: number | null) => void;
}

export const useTimelineStore = create<TimelineState>()((set, get) => ({
  sessions: [],
  activeSessionId: null,
  events: [],
  isRecording: false,
  playbackPosition: null,

  startRecording: async (terminalId: string) => {
    const sessionId = await startSessionRecording(terminalId);
    set({ activeSessionId: sessionId, isRecording: true, events: [] });
    // Refresh session list
    await get().loadSessions();
  },

  stopRecording: async () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    await stopSessionRecording(activeSessionId);
    set({ isRecording: false });
    // Refresh session list
    await get().loadSessions();
  },

  loadSessions: async () => {
    const sessions = await listSessionsCmd();
    set({ sessions });
  },

  selectSession: async (id: string) => {
    const session = await getSessionCmd(id);
    set({
      activeSessionId: id,
      events: session.events as TimelineEvent[],
      playbackPosition: null,
    });
  },

  deleteSession: async (id: string) => {
    await deleteSessionCmd(id);
    const { activeSessionId } = get();
    if (activeSessionId === id) {
      set({ activeSessionId: null, events: [], playbackPosition: null });
    }
    await get().loadSessions();
  },

  setPlaybackPosition: (timestamp: number | null) => {
    set({ playbackPosition: timestamp });
  },
}));
