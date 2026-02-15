import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          codemirror: [
            '@codemirror/commands',
            '@codemirror/lang-css',
            '@codemirror/lang-html',
            '@codemirror/lang-java',
            '@codemirror/lang-javascript',
            '@codemirror/lang-json',
            '@codemirror/lang-markdown',
            '@codemirror/lang-python',
            '@codemirror/lang-rust',
            '@codemirror/language',
            '@codemirror/legacy-modes/mode/clike',
            '@codemirror/search',
            '@codemirror/state',
            '@codemirror/view',
            '@lezer/highlight',
          ],
          xterm: [
            '@xterm/xterm',
            '@xterm/addon-fit',
            '@xterm/addon-web-links',
            '@xterm/addon-webgl',
          ],
          highlightjs: ['highlight.js'],
          diff: ['diff'],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}));
