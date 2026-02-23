#!/usr/bin/env bash
set -euo pipefail

# Downloads platform-specific Node.js binary and installs language server
# npm packages for bundling with the Tauri app.
#
# Run this before `cargo tauri build` (or `cargo tauri dev`).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$ROOT_DIR/src-tauri"
BIN_DIR="$TAURI_DIR/bin"
LSP_DIR="$TAURI_DIR/resources/lsp-servers"

NODE_VERSION="v22.14.0"

# Determine host platform and Tauri target triple
detect_target() {
  local arch os
  arch="$(uname -m)"
  os="$(uname -s)"

  case "$arch" in
    x86_64)  arch="x86_64" ;;
    arm64|aarch64) arch="aarch64" ;;
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
  esac

  case "$os" in
    Darwin) os="apple-darwin" ;;
    Linux)  os="unknown-linux-gnu" ;;
    *) echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac

  echo "${arch}-${os}"
}

# Map Tauri target triple → Node.js download platform/arch
node_platform() {
  local target="$1"
  case "$target" in
    x86_64-apple-darwin)    echo "darwin-x64" ;;
    aarch64-apple-darwin)   echo "darwin-arm64" ;;
    x86_64-unknown-linux-gnu)  echo "linux-x64" ;;
    aarch64-unknown-linux-gnu) echo "linux-arm64" ;;
    *) echo "Unsupported target for Node.js: $target" >&2; exit 1 ;;
  esac
}

TARGET="$(detect_target)"
NODE_PLAT="$(node_platform "$TARGET")"

echo "==> Target: $TARGET"
echo "==> Node.js platform: $NODE_PLAT"

# --- Download Node.js binary ---
NODE_BIN="$BIN_DIR/node-${TARGET}"

if [ -f "$NODE_BIN" ]; then
  echo "==> Node.js binary already exists: $NODE_BIN"
else
  mkdir -p "$BIN_DIR"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_PLAT}.tar.gz"
  echo "==> Downloading Node.js from $NODE_URL"

  TMPDIR_DL="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_DL"' EXIT

  curl -fsSL "$NODE_URL" | tar -xz -C "$TMPDIR_DL"
  cp "$TMPDIR_DL/node-${NODE_VERSION}-${NODE_PLAT}/bin/node" "$NODE_BIN"
  chmod +x "$NODE_BIN"

  echo "==> Node.js binary installed: $NODE_BIN"
fi

# --- Install TypeScript language server ---
TS_LSP_DIR="$LSP_DIR/typescript"

if [ -d "$TS_LSP_DIR/node_modules/typescript-language-server" ]; then
  echo "==> typescript-language-server already installed"
else
  echo "==> Installing typescript-language-server + typescript"
  mkdir -p "$TS_LSP_DIR"
  npm install --prefix "$TS_LSP_DIR" typescript-language-server typescript --save
  echo "==> typescript-language-server installed"
fi

echo ""
echo "Done! LSP dependencies are ready for bundling."
echo "  Node.js binary: $NODE_BIN"
echo "  TS LSP server:  $TS_LSP_DIR/node_modules/.bin/typescript-language-server"
