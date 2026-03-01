use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::RwLock;

const MAX_LINES: usize = 10_000;

pub struct TerminalOutputBuffer {
    lines: VecDeque<String>,
    partial: String,
}

impl TerminalOutputBuffer {
    pub fn new() -> Self {
        Self {
            lines: VecDeque::with_capacity(1024),
            partial: String::new(),
        }
    }

    /// Push raw PTY output into the buffer. Decodes as UTF-8 (lossy),
    /// strips ANSI escape sequences, and splits on newlines.
    pub fn push(&mut self, data: &[u8]) {
        let stripped = strip_ansi_escapes::strip(data);
        let text = String::from_utf8_lossy(&stripped);

        self.partial.push_str(&text);

        // Split on newlines — complete lines go into the ring buffer,
        // the trailing fragment stays in `partial`.
        while let Some(pos) = self.partial.find('\n') {
            let line = self.partial[..pos].to_string();
            self.partial = self.partial[pos + 1..].to_string();
            self.lines.push_back(line);
            if self.lines.len() > MAX_LINES {
                self.lines.pop_front();
            }
        }
    }

    /// Return the last `n` lines of output.
    pub fn last_lines(&self, n: usize) -> Vec<String> {
        let n = n.min(self.lines.len());
        self.lines
            .iter()
            .skip(self.lines.len() - n)
            .cloned()
            .collect()
    }

    /// Return the most recent complete line.
    pub fn last_line(&self) -> Option<String> {
        self.lines.back().cloned()
    }
}

pub struct OutputBufferRegistry {
    buffers: RwLock<HashMap<String, Arc<RwLock<TerminalOutputBuffer>>>>,
}

impl OutputBufferRegistry {
    pub fn new() -> Self {
        Self {
            buffers: RwLock::new(HashMap::new()),
        }
    }

    /// Get or create a buffer for the given terminal ID.
    pub async fn get_or_create(&self, id: &str) -> Arc<RwLock<TerminalOutputBuffer>> {
        // Fast path: read lock
        {
            let buffers = self.buffers.read().await;
            if let Some(buf) = buffers.get(id) {
                return Arc::clone(buf);
            }
        }
        // Slow path: write lock
        let mut buffers = self.buffers.write().await;
        buffers
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(RwLock::new(TerminalOutputBuffer::new())))
            .clone()
    }

    /// Remove a buffer when a terminal is closed.
    pub async fn remove(&self, id: &str) {
        self.buffers.write().await.remove(id);
    }

    /// Get a buffer if it exists.
    pub async fn get(&self, id: &str) -> Option<Arc<RwLock<TerminalOutputBuffer>>> {
        self.buffers.read().await.get(id).cloned()
    }
}
