import { createClient } from '@supabase/supabase-js';

// В клиенте только публичный anon-ключ. Ключ service role сюда не попадает никогда.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = supabaseConfigured ? createClient(url!, anonKey!) : null;
