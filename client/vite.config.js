import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Keep dev traffic same-origin so the session cookie just works.
      '/api': 'http://localhost:4000',
    },
  },
});
