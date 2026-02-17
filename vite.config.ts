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
            '@codemirror/lang-cpp',
            '@codemirror/lang-css',
            '@codemirror/lang-go',
            '@codemirror/lang-html',
            '@codemirror/lang-java',
            '@codemirror/lang-javascript',
            '@codemirror/lang-json',
            '@codemirror/lang-less',
            '@codemirror/lang-liquid',
            '@codemirror/lang-markdown',
            '@codemirror/lang-php',
            '@codemirror/lang-python',
            '@codemirror/lang-rust',
            '@codemirror/lang-sql',
            '@codemirror/lang-vue',
            '@codemirror/lang-wast',
            '@codemirror/lang-xml',
            '@codemirror/lang-yaml',
            '@codemirror/language',
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
