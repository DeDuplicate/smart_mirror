import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BACKEND_URL lets a second dev server talk to a second backend (see SMART_MIRROR_DB).
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/socket.io': {
        target: BACKEND,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  // `vite preview` is what the Pi serves on :3000. It refuses any hostname it was not told
  // about (IP addresses are always fine), which 403'd http://smartmirror.local:3000 from a
  // phone. `.local` covers the mDNS name without opening it to arbitrary hostnames (DNS rebinding).
  preview: {
    allowedHosts: ['.local'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
