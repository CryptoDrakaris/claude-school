import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Шрифты – свои файлы (@fontsource), без запросов к Google. Подмножества грузятся по unicode-range.
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/marck-script/400.css';
// Токены – единый источник в design/tokens (tokens-init, направление «Зачётка», см. design-intent.md).
import '../design/tokens/tokens.css';
import './styles.css';
import { App } from './App';
import { AuthProvider } from './lib/auth';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
