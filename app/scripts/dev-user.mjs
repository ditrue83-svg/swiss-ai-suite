// Utility di sviluppo: crea/elimina un utente CONFERMATO via service_role.
// Uso:  node --env-file=.env.test scripts/dev-user.mjs create <email>
//       node --env-file=.env.test scripts/dev-user.mjs delete <email>
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket; // Node < 22

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [, , action, email] = process.argv;

if (!action || !email) { console.error('Uso: dev-user.mjs create|delete <email>'); process.exit(2); }

if (action === 'create') {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'Test1234!', email_confirm: true,
    user_metadata: { first_name: 'Andrea', last_name: 'Pilota' },
  });
  if (error) { console.error('ERRORE:', error.message); process.exit(1); }
  console.log('Utente confermato creato:', data.user.email);
} else if (action === 'delete') {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const u = list.users.find((x) => x.email === email);
  if (!u) { console.log('Utente non trovato:', email); process.exit(0); }
  const { data: mems } = await admin.from('company_members').select('company_id').eq('user_id', u.id);
  for (const m of mems ?? []) await admin.from('companies').delete().eq('id', m.company_id); // cascade
  await admin.auth.admin.deleteUser(u.id);
  console.log('Eliminato utente + aziende:', email);
} else {
  console.error('Azione sconosciuta:', action); process.exit(2);
}
