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
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
