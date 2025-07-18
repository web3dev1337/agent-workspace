import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7656,
    proxy: {
      '/api': {
        target: 'http://localhost:7655',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist'
  }
});