use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

struct WatcherState {
    _watcher: RecommendedWatcher,
    shutdown_tx: mpsc::Sender<()>,
    debounce_thread: Option<thread::JoinHandle<()>>,
}

pub struct FileWatcher {
    state: Mutex<Option<WatcherState>>,
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(None),
        }
    }

    pub fn start_watching(&self, path: &str, app_handle: &AppHandle) {
        let mut state = self.state.lock().unwrap();

        // Stop existing watcher if any
        if let Some(old) = state.take() {
            drop(old._watcher);
            let _ = old.shutdown_tx.send(());
            if let Some(handle) = old.debounce_thread {
                let _ = handle.join();
            }
        }

        let (event_tx, event_rx) = mpsc::channel::<Event>();
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

        let mut watcher = match RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = event_tx.send(event);
                }
            },
            Config::default(),
        ) {
            Ok(w) => w,
            Err(err) => {
                eprintln!("[FileWatcher] Failed to create watcher: {}", err);
                return;
            }
        };

        if let Err(err) = watcher.watch(path.as_ref(), RecursiveMode::Recursive) {
            eprintln!("[FileWatcher] Failed to watch path {}: {}", path, err);
            return;
        }

        let app = app_handle.clone();
        let debounce_thread = thread::spawn(move || {
            loop {
                // Wait for an event or shutdown
                match event_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(_event) => {
                        // Got an event, start debounce: drain events for 500ms
                        let deadline = std::time::Instant::now() + Duration::from_millis(500);
                        loop {
                            let remaining =
                                deadline.saturating_duration_since(std::time::Instant::now());
                            if remaining.is_zero() {
                                break;
                            }
                            match event_rx.recv_timeout(remaining) {
                                Ok(_) => continue,
                                Err(mpsc::RecvTimeoutError::Timeout) => break,
                                Err(mpsc::RecvTimeoutError::Disconnected) => return,
                            }
                        }
                        let _ = app.emit("fs-changed", ());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // Check for shutdown
                        if shutdown_rx.try_recv().is_ok() {
                            return;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
        });

        *state = Some(WatcherState {
            _watcher: watcher,
            shutdown_tx,
            debounce_thread: Some(debounce_thread),
        });
    }

    pub fn stop_watching(&self) {
        let mut state = self.state.lock().unwrap();
        if let Some(old) = state.take() {
            drop(old._watcher);
            let _ = old.shutdown_tx.send(());
            if let Some(handle) = old.debounce_thread {
                let _ = handle.join();
            }
        }
    }
}

#[tauri::command]
pub fn start_watching_directory(
    path: String,
    app_handle: AppHandle,
    state: State<'_, FileWatcher>,
) {
    state.start_watching(&path, &app_handle);
}

#[tauri::command]
pub fn stop_watching_directory(state: State<'_, FileWatcher>) {
    state.stop_watching();
}
