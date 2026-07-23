// Sonda di connessione: verifica chiavi + se le migrazioni sono applicate.
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket; // Node < 22

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

console.log('URL:', SUPABASE_URL);

// 1) La secret key funziona? (Auth admin API)
const { data: users, error: aErr } = await admin.auth.admin.listUsers({ perPage: 1 });
console.log('secret key valida (auth admin):', aErr ? `NO — ${aErr.message}` : `sì (${users.users.length >= 0 ? 'ok' : ''})`);

// 2) Le migrazioni sono applicate? (query companies con service role = bypassa RLS)
const { error: schemaErr } = await admin.from('companies').select('id').limit(1);
if (!schemaErr) {
  console.log('SCHEMA: applicato ✓ (tabella companies presente)');
} else if (/does not exist|schema cache|PGRST205|42P01/i.test(`${schemaErr.message} ${schemaErr.code ?? ''}`)) {
  console.log('SCHEMA: NON applicato ✗ — esegui supabase/full-setup.sql nel SQL Editor');
} else {
  console.log('SCHEMA: errore inatteso —', schemaErr.code, schemaErr.message);
}

// 3) La publishable key è correttamente bloccata da RLS quando non autenticata?
const { data: anonData, error: anonErr } = await anon.from('companies').select('id').limit(1);
console.log('anon su companies:', anonErr ? `bloccato (${anonErr.code ?? anonErr.message})` : `${(anonData ?? []).length} righe (RLS ok se 0)`);
