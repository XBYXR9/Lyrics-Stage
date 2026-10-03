import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Spotify only accepts loopback IP addresses (not "localhost") as redirect
// URIs, so the dev server is pinned to 127.0.0.1:5173.
export default defineConfig({
  plugins: [react()],
  // The app's own version, for the timing report.
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Relative asset paths, so the built page also loads from a file inside the desktop app.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    open: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
