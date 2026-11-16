import { createClient } from '@supabase/supabase-js';

// В клиенте только публичный ключ. Ключ service role сюда не попадает никогда.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

// Ошибку из ссылки входа (например, ссылка устарела) Supabase кладёт в хэш адреса.
// Запоминаем её до того, как клиент очистит адрес.
function readLinkError(): string | null {
  const hash = window.location.hash;
  if (!hash.includes('error')) return null;
  const params = new URLSearchParams(hash.replace(/^#\/?/, ''));
  const code = params.get('error_code');
  if (!code && !params.get('error')) return null;
  if (code === 'otp_expired') return 'Ссылка для входа устарела или уже использована. Запросите новую.';
  return 'Войти по этой ссылке не получилось. Запросите новую.';
}

export const linkError = readLinkError();

export const supabase = supabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // implicit: ссылка из письма работает, даже если открыта в другом браузере, чем запрошена
        flowType: 'implicit',
      },
    })
  : null;

// Адрес, куда ведёт ссылка из письма: корень сайта (локально – http://localhost:5173/claude-school/).
export const redirectUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;
