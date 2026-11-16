import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base = имя репозитория: сайт живёт по адресу cryptodrakaris.github.io/claude-school/
export default defineConfig({
  base: '/claude-school/',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
