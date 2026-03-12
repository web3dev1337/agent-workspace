import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 9462,
    proxy: {
      '/api': {
        target: 'http://localhost:9462',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist'
  }
});