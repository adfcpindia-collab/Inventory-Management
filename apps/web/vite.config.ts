import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // host: true lets other devices on the LAN (e.g. a tablet) reach the dev server by IP;
    // allowedHosts admits GitHub Codespaces' forwarded-port domain.
    host: true,
    allowedHosts: ['.app.github.dev'],
    proxy: { '/api': 'http://localhost:4000' },
  },
});
