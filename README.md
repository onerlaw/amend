# Amend

A desktop IDE built for developers who live in the terminal and work alongside AI agents. Amend pairs a fully integrated terminal with a real-time diff viewer, code editor, and deep git integration — everything you need to supervise, review, and steer agentic coding workflows without switching windows.

Built with Rust and React. Fast, native, cross-platform.

## Why Amend?

If you use Claude Code, Cursor Agent, Aider, Codex, or similar agentic CLI tools, you already know the loop: the agent writes code, you review diffs, you run commands, you course-correct. That loop is split across your terminal, your editor, and your git client.

Amend puts it all in one place.

- **Watch diffs in real time** as your agent writes code — staged, unstaged, and untracked changes update automatically
- **Keep your terminal front and center** with multi-tab, multi-worktree terminal support
- **Browse and edit files** without leaving the window — CodeMirror-powered editor with syntax highlighting
- **Search across your entire project** by filename and content with a single shortcut
- **Manage git worktrees** to run multiple agent sessions on different branches simultaneously

## Features

### Integrated Terminal
Multi-tab terminal with full shell support. Each tab is linked to a git worktree, so you can run separate agent sessions on different branches side by side. Native PTY via Rust — not a web shell.

- `Cmd+T` / `Cmd+O` to open new terminals
- `` Cmd+` `` to cycle between tabs
- `Cmd+W` to close the current tab
- Theme-aware ANSI colors, WebGL-accelerated rendering

### Real-Time Diff Viewer
Git status polls every 2 seconds. Staged, unstaged, and untracked files are grouped and displayed with syntax-highlighted, inline diffs. Collapse unchanged sections, expand on demand, and click through to edit files directly.

- Addition/deletion counts at a glance
- Per-file collapse/expand
- Context menu to restore or unstage individual files
- Virtual scrolling for large changesets

### Code Editor
CodeMirror 6 editor with language support for TypeScript, JavaScript, Rust, Python, HTML, CSS, JSON, Markdown, and more. Tabs, unsaved-change indicators, and auto-save.

### File Browser
Gitignore-aware file tree with expand/collapse directories, context menus for rename/delete/copy/move, and reveal-in-file-manager support.

### Global Search
`Cmd+P` opens a unified search across filenames and file contents. Results show match type, line numbers, and content previews. Arrow keys to navigate, Enter to open.

### Symbol Navigation
Tree-sitter powered symbol indexing for JavaScript and TypeScript. Cmd+Click to jump to definitions. Hover tooltips show symbol kind, signature, and location.

### Git Worktrees
First-class worktree support. Create, switch, and delete worktrees from the UI. Each terminal tab tracks its own worktree path — ideal for running parallel agent sessions on separate branches.

### Multi-Project Support
Open and switch between multiple repositories. Project state is persisted across sessions.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Runtime | Tauri 2 |
| Frontend | React 19, TypeScript, Zustand, Tailwind CSS |
| Editor | CodeMirror 6 |
| Terminal | xterm.js with WebGL addon |
| Backend | Rust |
| Git | git2 crate + CLI fallback |
| Parsing | tree-sitter (TypeScript, JavaScript) |
| PTY | portable-pty |

## Download

Grab the latest release for your platform from [GitHub Releases](https://github.com/onerlaw/amend/releases/latest).

| Platform | Format |
|---|---|
| macOS (Apple Silicon) | `.dmg` (aarch64) |
| macOS (Intel) | `.dmg` (x64) |
| Windows | `.exe` installer or `.msi` |
| Linux | `.deb`, `.rpm`, or `.AppImage` |

### Building from Source

If you'd prefer to build from source:

```sh
# Prerequisites: Rust (stable), Node.js (v18+), Tauri CLI
npm install
npx tauri build
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+T` / `Cmd+O` | New terminal tab |
| `` Cmd+` `` | Cycle terminals |
| `Cmd+W` | Close current tab |
| `Cmd+P` | Search files |
| `Cmd+Shift+F` | Search files (alt) |
| `Cmd+Click` | Go to definition |
| `Esc` | Close search / dialog |
