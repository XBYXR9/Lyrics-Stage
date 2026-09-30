import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Spotify only accepts loopback IP addresses (not "localhost") as redirect
// URIs, so the dev server is pinned to 127.0.0.1:5173.
export default defineConfig({
  plugins: [react()],
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
