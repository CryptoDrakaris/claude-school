import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// CSP – второй рубеж против вставки чужого кода (аудит C7). GitHub Pages заголовки не задаёт,
// поэтому политика – <meta> в index.html, и только в сборке: dev-сервер Vite использует встроенные скрипты.
function csp(supabaseUrl: string | undefined): Plugin {
  const connect = ["'self'", supabaseUrl].filter(Boolean).join(' ');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

// base = имя репозитория: сайт живёт по адресу cryptodrakaris.github.io/claude-school/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  return {
    base: '/claude-school/',
    plugins: [react(), csp(env.VITE_SUPABASE_URL)],
    server: { port: 5173, strictPort: true },
    // Основной вес – supabase-js (~145 КБ gzip вместе с React); для 5 пользователей приемлемо.
    build: { chunkSizeWarningLimit: 600 },
  };
});
