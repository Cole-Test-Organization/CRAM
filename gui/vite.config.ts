import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [tailwindcss(), solid()],
  server: {
    port: 3201,
    allowedHosts: ['notes.homelab'],
    proxy: {
      '/api': 'http://localhost:3200',
      '/docs': 'http://localhost:3200',
    },
  },
  build: {
    outDir: '../api/public',
    emptyOutDir: true,
  },
});
