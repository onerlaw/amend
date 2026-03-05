# Always-On Automatic Session Recording

## Context

The timeline feature has all the infrastructure (backend persistence, event types, UI components) but nothing actually records events — `recordSessionEvent()` is never called. Additionally, the current design requires manual Record/Stop which is clunky. We're converting to an always-on system where sessions are automatically created and closed based on activity, so the timeline becomes a passive log of everything that happened.

## Approach

**Backend-driven auto-session management.** The frontend sends events, the backend decides whether to append to the current session or start a new one based on a 5-minute inactivity timeout. No manual start/stop.

## Changes

### 1. Backend: `src-tauri/src/session.rs`

- Add `active_session_id: RwLock<Option<String>>` and `last_event_time: RwLock<u64>` to `SessionCapture`
- Add `SESSION_TIMEOUT_MS` constant (5 minutes = 300,000ms)
- Add `record_auto_event(&self, event: SessionEvent) -> String` method:
  - If no active session → create one, append event
  - If active session and last event < 5min ago → append event
  - If active session and last event >= 5min ago → close old session (set `stopped_at`, save to disk), create new one, append event
  - Returns session ID
- Add `close_session(&self, id)` helper — sets `stopped_at`, saves to disk
- Add `restore_active_session(&self)` — called on startup, finds any open session, closes it if timed out or resumes it
- Add `event_timestamp(event)` helper to extract timestamp from any variant
- Change `Session.terminal_id` from `String` to `Option<String>` (with `#[serde(default)]` for backward compat)
- Same change on `SessionSummary.terminal_id`
- New Tauri command: `record_event(event, capture, app_handle) -> String` — calls `record_auto_event`, emits `session-event-recorded` Tauri event, saves to disk
- New Tauri command: `get_active_session_id(capture) -> Option<String>`
- Remove commands: `start_session_recording`, `stop_session_recording`, `record_session_event`
- Remove methods: `start_session`, `stop_session`, old `record_event(session_id, event)`

### 2. Backend: `src-tauri/src/lib.rs`

- Replace session command registrations:
  - Remove: `start_session_recording`, `stop_session_recording`, `record_session_event`
  - Add: `record_event`, `get_active_session_id`
  - Keep: `list_sessions`, `get_session`, `delete_session`
- After `load_sessions()` in setup hook, call `restore_active_session()`

### 3. Backend: `src-tauri/src/watcher.rs`

- During the debounce loop, collect changed file paths from `notify::Event.paths` into a `HashSet<PathBuf>`
- Emit `fs-changed` with `Vec<String>` payload (the collected paths) instead of `()`

### 4. Frontend: `src/lib/tauri.ts`

- Update `onFsChanged` signature: `callback: (paths: string[]) => void`, read from `event.payload`
- Add `recordEvent(event: SessionEvent): Promise<string>` — invokes `record_event` (no sessionId param)
- Add `getActiveSessionId(): Promise<string | null>` — invokes `get_active_session_id`
- Add `onSessionEventRecorded(callback: (sessionId: string) => void): Promise<UnlistenFn>`
- Remove: `startSessionRecording`, `stopSessionRecording`, `recordSessionEvent`
- Update `SessionSummary.terminalId` and `SessionData.terminalId` to `string | null`

### 5. Frontend: `src/components/Layout/MainLayout.tsx`

- Update `onFsChanged` callback to accept `(paths)` parameter (existing logic ignores it, just change signature)
- Add file change recording inside the `onFsChanged` callback:
  ```ts
  if (contextPath) {
    recordEvent({
      type: 'fileChanged',
      timestamp: Date.now(),
      path: paths.length > 0 ? paths[0] : contextPath,
      changeType: paths.length > 1 ? `${paths.length} files` : 'modified',
    }).catch(console.error);
  }
  ```
- Add a `useEffect` that watches `gitPolling.status` and records `GitStatusChanged` events when status actually changes (tracked via a ref to avoid recording the initial load)
- Import `recordEvent` from tauri.ts

### 6. Frontend: `src/hooks/useFileBrowserState.ts`

- Update `onFsChanged` callback signature to accept `(_paths)` (ignore the param)

### 7. Frontend: `src/stores/timelineStore.ts`

- Remove: `isRecording`, `playbackPosition`, `startRecording`, `stopRecording`, `setPlaybackPosition`
- Remove imports: `startSessionRecording`, `stopSessionRecording`
- Add: `liveSessionId: string | null` — tracks the backend's active session
- Add: `refreshActiveSession()` — re-fetches events for `activeSessionId` via `getSession()`
- Add: `setLiveSessionId(id)` — sets `liveSessionId`, auto-selects it

### 8. Frontend: `src/components/Timeline/SessionTimeline.tsx`

- Remove: Record/Stop button, `RecordingIndicator` component, all `isRecording` references
- Remove: `useTerminalStore` import (no longer need `activeTabId`)
- Remove: `playbackPosition` and `setPlaybackPosition` usage
- On mount: call `getActiveSessionId()` to auto-select the live session
- Subscribe to `session-event-recorded` Tauri event:
  - If viewing the active session → call `refreshActiveSession()`
  - Always refresh session list (a new session may have been created)
- Show a subtle green "Live" dot next to the active session in the list
- Update empty state text: "Sessions appear automatically as you work"
- Auto-scroll to bottom of event list when new events arrive for the live session

### 9. Frontend: `src/components/Timeline/TimelineEvent.tsx`

- Remove `isHighlighted` and `onClick` props (no more playback position)
- Simplify to a display-only component

## Files Modified

| File | Change |
|------|--------|
| `src-tauri/src/session.rs` | Auto-session management, new commands |
| `src-tauri/src/lib.rs` | Command registration, startup hook |
| `src-tauri/src/watcher.rs` | Collect & emit changed file paths |
| `src/lib/tauri.ts` | New bindings, remove old ones, update types |
| `src/components/Layout/MainLayout.tsx` | Wire up event recording |
| `src/hooks/useFileBrowserState.ts` | Update onFsChanged callback signature |
| `src/stores/timelineStore.ts` | Simplify store, remove manual recording |
| `src/components/Timeline/SessionTimeline.tsx` | Remove Record/Stop, add live updates |
| `src/components/Timeline/TimelineEvent.tsx` | Remove interactivity props |

## Verification

1. `cargo build` — ensure Rust compiles with the new session.rs and watcher.rs changes
2. `npm run build` — ensure TypeScript compiles with updated types/bindings
3. Manual testing:
   - Open the app, open the Timeline panel
   - Edit a file in the terminal (e.g., `touch test.txt`) — should see a FileChanged event appear
   - Stage/unstage a file — should see a GitStatusChanged event appear
   - Wait 5+ minutes with no activity, then make another change — should start a new session
   - Close and reopen the app — sessions should persist and load correctly
   - Delete a session — should remove from list and disk
