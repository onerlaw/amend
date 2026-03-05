import { useEffect, useMemo, useRef } from 'react';
import { useTimelineStore, initLiveSession } from '@/stores/timelineStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { TimelineEvent } from './TimelineEvent';
import type { TimelineEvent as TimelineEventType } from '@/stores/timelineStore';
import { onSessionEventRecorded } from '@/lib/tauri';
import { TrashIcon } from '@/components/Icons';

interface EventGroup {
  timestamp: number;
  events: TimelineEventType[];
}

function groupEvents(events: TimelineEventType[]): EventGroup[] {
  if (events.length === 0) return [];

  const groups: EventGroup[] = [];
  let currentGroup: EventGroup = { timestamp: events[0].timestamp, events: [events[0]] };

  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    // Group events within 1 second of the group's first event
    if (event.timestamp - currentGroup.timestamp <= 1000) {
      currentGroup.events.push(event);
    } else {
      groups.push(currentGroup);
      currentGroup = { timestamp: event.timestamp, events: [event] };
    }
  }
  groups.push(currentGroup);
  return groups;
}

function formatSessionDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(startMs: number, endMs: number | null): string {
  if (!endMs) return 'In progress';
  const diff = endMs - startMs;
  if (diff < 1000) return '<1s';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
  const mins = Math.floor(diff / 60_000);
  const secs = Math.round((diff % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function SessionTimeline() {
  const {
    sessions,
    activeSessionId,
    events,
    liveSessionId,
    loadSessions,
    selectSession,
    deleteSession,
    setLiveSessionId,
    setCurrentTerminalId,
    refreshActiveSession,
  } = useTimelineStore();

  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const activeTab = useTerminalStore((s) => s.tabs.find((t) => t.id === s.activeTabId));

  const eventListRef = useRef<HTMLDivElement>(null);

  // Sync timeline to active terminal
  useEffect(() => {
    setCurrentTerminalId(activeTabId);
  }, [activeTabId, setCurrentTerminalId]);

  // Load sessions and auto-select live session on mount
  useEffect(() => {
    if (!activeTabId) {
      loadSessions();
    }
    initLiveSession();
  }, [loadSessions]);

  // Subscribe to session-event-recorded from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onSessionEventRecorded((payload) => {
      const { currentTerminalId: currentTid } = useTimelineStore.getState();

      // Only process events for the currently viewed terminal
      if (currentTid && payload.terminalId !== currentTid) return;

      const { activeSessionId: currentActive, liveSessionId: currentLive } =
        useTimelineStore.getState();

      // Update live session ID if a new session was created
      if (currentLive !== payload.sessionId) {
        setLiveSessionId(payload.sessionId);
      }

      // Refresh events if viewing the active session
      if (currentActive === payload.sessionId) {
        refreshActiveSession();
      }

      // Refresh the session list
      loadSessions(currentTid ?? undefined);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [loadSessions, setLiveSessionId, refreshActiveSession]);

  // Auto-scroll to bottom when new events arrive for the live session
  useEffect(() => {
    if (activeSessionId === liveSessionId && eventListRef.current) {
      eventListRef.current.scrollTop = eventListRef.current.scrollHeight;
    }
  }, [events, activeSessionId, liveSessionId]);

  const eventGroups = useMemo(() => groupEvents(events), [events]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex h-full flex-col bg-surface-1 text-primary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-3 px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-secondary">
          Timeline
          {activeTab?.title && (
            <span className="ml-1.5 normal-case text-tertiary">— {activeTab.title}</span>
          )}
        </h2>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Session list */}
        <div className="flex w-48 shrink-0 flex-col border-r border-surface-3">
          <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-tertiary">
            Sessions
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="px-3 py-4 text-xs text-tertiary">
                Sessions appear automatically as you work.
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex cursor-pointer items-start gap-1 px-2 py-1.5 ${
                    activeSessionId === session.id
                      ? 'bg-accent/10 text-primary'
                      : 'text-secondary hover:bg-surface-2'
                  }`}
                  onClick={() => selectSession(session.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-xs">
                      {session.label}
                      {liveSessionId === session.id && (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-diff-add-text" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-tertiary">
                      <span>{formatSessionDate(session.startedAt)}</span>
                      <span>|</span>
                      <span>{formatDuration(session.startedAt, session.stoppedAt)}</span>
                    </div>
                    <div className="text-[10px] text-tertiary">
                      {session.eventCount} event{session.eventCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(session.id);
                    }}
                    className="mt-0.5 rounded p-0.5 text-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-diff-remove-text group-hover:opacity-100"
                    title="Delete session"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Event timeline */}
        <div className="flex min-w-0 flex-1 flex-col">
          {activeSession ? (
            <>
              <div className="flex items-center justify-between border-b border-surface-3 px-3 py-1.5">
                <div className="text-xs text-secondary">
                  {activeSession.label} - {events.length} event{events.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div ref={eventListRef} className="flex-1 overflow-y-auto px-1 py-1">
                {eventGroups.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-tertiary">
                    No events recorded in this session.
                  </div>
                ) : (
                  eventGroups.map((group, gi) => (
                    <div key={gi} className="mb-1">
                      {group.events.length > 1 && (
                        <div className="mb-0.5 ml-2 text-[9px] text-tertiary">
                          {group.events.length} events
                        </div>
                      )}
                      {group.events.map((event, ei) => (
                        <TimelineEvent key={`${gi}-${ei}`} event={event} />
                      ))}
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-tertiary">
              {sessions.length > 0
                ? 'Select a session to view its timeline'
                : 'Sessions appear automatically as you work'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
