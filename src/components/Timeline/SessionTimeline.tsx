import { useEffect, useMemo } from 'react';
import { useTimelineStore } from '@/stores/timelineStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { TimelineEvent } from './TimelineEvent';
import type { TimelineEvent as TimelineEventType } from '@/stores/timelineStore';
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

function RecordingIndicator() {
  return (
    <span className="flex items-center gap-1 text-xs text-diff-remove-text">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-diff-remove-text" />
      Recording
    </span>
  );
}

export function SessionTimeline() {
  const {
    sessions,
    activeSessionId,
    events,
    isRecording,
    playbackPosition,
    startRecording,
    stopRecording,
    loadSessions,
    selectSession,
    deleteSession,
    setPlaybackPosition,
  } = useTimelineStore();

  const { activeTabId } = useTerminalStore();

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const eventGroups = useMemo(() => groupEvents(events), [events]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex h-full flex-col bg-surface-1 text-primary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-3 px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-secondary">Timeline</h2>
          {isRecording && <RecordingIndicator />}
        </div>
        <div className="flex items-center gap-1">
          {isRecording ? (
            <button
              onClick={() => stopRecording()}
              className="rounded-md bg-diff-remove-text px-2 py-1 text-xs text-white hover:opacity-90"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => activeTabId && startRecording(activeTabId)}
              disabled={!activeTabId}
              className="rounded-md bg-accent px-2 py-1 text-xs text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Record
            </button>
          )}
        </div>
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
                No sessions yet. Click Record to start capturing events.
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
                    <div className="truncate text-xs">{session.label}</div>
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
              <div className="flex-1 overflow-y-auto px-1 py-1">
                {eventGroups.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-tertiary">
                    {isRecording
                      ? 'Waiting for events...'
                      : 'No events recorded in this session.'}
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
                        <TimelineEvent
                          key={`${gi}-${ei}`}
                          event={event}
                          isHighlighted={playbackPosition === event.timestamp}
                          onClick={() => setPlaybackPosition(event.timestamp)}
                        />
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
                : 'Start recording to capture agent session events'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
