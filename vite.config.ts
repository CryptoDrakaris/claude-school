import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base = имя репозитория: сайт живёт по адресу cryptodrakaris.github.io/claude-school/
export default defineConfig({
  base: '/claude-school/',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Основной вес – supabase-js (~145 КБ gzip вместе с React); для 5 пользователей приемлемо.
  build: { chunkSizeWarningLimit: 600 },
});
