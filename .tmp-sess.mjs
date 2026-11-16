import { createClient } from '@supabase/supabase-js';
const opts = { auth: { persistSession: false } };
const a = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const { data: u } = await a.auth.admin.getUserById('50e36415-dac8-4977-a7ac-45c99ee19038');
const l = await a.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
const c = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, opts);
const v = await c.auth.verifyOtp({ token_hash: l.data.properties.hashed_token, type: 'magiclink' });
const s = v.data.session;
console.log(`http://localhost:5173/claude-school/#access_token=${s.access_token}&expires_at=${s.expires_at}&expires_in=${s.expires_in}&refresh_token=${s.refresh_token}&token_type=bearer&type=magiclink`);
