import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = Number.parseInt(process.env.DIFF_VIEWER_PORT || '', 10) || 9462;
const clientPort = Number.parseInt(process.env.DIFF_VIEWER_CLIENT_PORT || '', 10) || (backendPort + 2);

export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist'
  }
});
