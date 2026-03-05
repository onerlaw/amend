import type { TimelineEvent as TimelineEventType } from '@/stores/timelineStore';

interface TimelineEventProps {
  event: TimelineEventType;
  isHighlighted: boolean;
  onClick: () => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function EventIcon({ type }: { type: string }) {
  switch (type) {
    case 'commandStart':
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 3.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 0-1 0v2A1.5 1.5 0 0 0 6.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-8A1.5 1.5 0 0 0 5 3.5v2a.5.5 0 0 0 1 0v-2z" />
          <path d="M11.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L10.293 7.5H1.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z" />
        </svg>
      );
    case 'commandEnd':
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z" />
        </svg>
      );
    case 'fileChanged':
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.85 4.44l-3.28-3.3-.35-.14H3.5l-.5.5v13l.5.5h10l.5-.5V4.8l-.15-.36zM10 1.94L12.06 4H10V1.94zM13 14H4V2h5v2.5l.5.5H13v9z" />
        </svg>
      );
    case 'gitStatusChanged':
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25z" />
        </svg>
      );
    case 'terminalOutput':
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm9.5 5.5h-3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1zm-6.354-.354a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2a.5.5 0 1 0-.708.708L4.793 6.5 3.146 8.146z" />
        </svg>
      );
    default:
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="4" />
        </svg>
      );
  }
}

function eventColor(type: string): string {
  switch (type) {
    case 'commandStart':
      return 'text-accent';
    case 'commandEnd':
      return 'text-diff-add-text';
    case 'fileChanged':
      return 'text-diff-remove-text';
    case 'gitStatusChanged':
      return 'text-warning';
    case 'terminalOutput':
      return 'text-secondary';
    default:
      return 'text-tertiary';
  }
}

function EventDetail({ event }: { event: TimelineEventType }) {
  switch (event.type) {
    case 'commandStart':
      return (
        <div>
          <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs text-primary">
            {event.command as string}
          </code>
          <div className="mt-0.5 text-[10px] text-tertiary">{event.cwd as string}</div>
        </div>
      );
    case 'commandEnd':
      return (
        <div className="text-xs text-secondary">
          Exit code: {(event.exitCode as number | null) ?? 'n/a'} | Duration:{' '}
          {formatDuration(event.durationMs as number)}
        </div>
      );
    case 'fileChanged':
      return (
        <div>
          <span className="text-xs text-primary">{shortenPath(event.path as string)}</span>
          <span className="ml-1.5 text-[10px] text-tertiary">{event.changeType as string}</span>
        </div>
      );
    case 'gitStatusChanged':
      return (
        <div className="text-xs text-secondary">
          Staged: {event.stagedCount as number} | Unstaged: {event.unstagedCount as number} |
          Untracked: {event.untrackedCount as number}
        </div>
      );
    case 'terminalOutput':
      return (
        <div>
          <span className="text-xs text-secondary">{event.summary as string}</span>
          <span className="ml-1.5 text-[10px] text-tertiary">
            ({event.lineCount as number} lines)
          </span>
        </div>
      );
    default:
      return <div className="text-xs text-tertiary">Unknown event</div>;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function shortenPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-2).join('/')}`;
}

export function TimelineEvent({ event, isHighlighted, onClick }: TimelineEventProps) {
  return (
    <button
      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        isHighlighted ? 'bg-accent/10' : 'hover:bg-surface-3'
      }`}
      onClick={onClick}
    >
      <div className={`mt-0.5 ${eventColor(event.type)}`}>
        <EventIcon type={event.type} />
      </div>
      <div className="min-w-0 flex-1">
        <EventDetail event={event} />
      </div>
      <span className="shrink-0 text-[10px] text-tertiary">{formatTime(event.timestamp)}</span>
    </button>
  );
}
