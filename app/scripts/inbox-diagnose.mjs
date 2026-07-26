// ============================================================================
// Diagnostica dell'Inbox: «perché questa casella non si aggiorna?».
//   npm run inbox:diagnose
//
// Mostra SOLO metadati tecnici — stati, conteggi, codici di errore, tempi.
// Mai oggetti, mittenti o contenuti: è la stessa disciplina di
// `email_sync_runs`, che esiste per poter diagnosticare senza leggere la posta.
// La parte locale degli indirizzi viene oscurata anche qui.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;   // Node < 22
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

const B='\x1b[1m', X='\x1b[0m', D='\x1b[2m';

const { data: conns } = await sb.from('email_connections').select(
  'id, provider, status, sync_enabled, email_address, initial_sync_completed_at, last_sync_at, ' +
  'last_successful_sync_at, last_error_code, watch_resource_id, watch_expires_at, watch_last_error_code, ' +
  'sync_cursor, history_floor_at, sync_lease_until, created_at');

console.log(`${B}CONNESSIONI${X}  (${conns?.length ?? 0})`);
for (const c of conns ?? []) {
  const dominio = c.email_address.split('@')[1];
  console.log(`  provider          ${c.provider}`);
  console.log(`  indirizzo         …@${dominio}   ${D}(locale oscurato)${X}`);
  console.log(`  stato             ${c.status}   sync_enabled=${c.sync_enabled}`);
  console.log(`  import iniziale   ${c.initial_sync_completed_at ?? '— non completato'}`);
  console.log(`  ultima sync       ${c.last_sync_at ?? '—'}`);
  console.log(`  ultima riuscita   ${c.last_successful_sync_at ?? '—'}`);
  console.log(`  errore conness.   ${c.last_error_code ?? 'nessuno'}`);
  console.log(`  cursore           ${c.sync_cursor ? 'presente' : '— assente'}`);
  console.log(`  watch (push)      ${c.watch_resource_id ?? '—'}   errore=${c.watch_last_error_code ?? 'nessuno'}`);
  console.log(`  lease attivo      ${c.sync_lease_until ?? 'no'}`);

  const { data: sec } = await sb.from('email_connection_secrets')
    .select('access_token_ct, refresh_token_ct, webhook_state_ct, access_token_expires_at').eq('connection_id', c.id).maybeSingle();
  console.log(`  segreti           access=${sec?.access_token_ct?'cifrato':'ASSENTE'} refresh=${sec?.refresh_token_ct?'cifrato':'ASSENTE'} webhookState=${sec?.webhook_state_ct?'cifrato':'ASSENTE'}`);
  console.log(`  access scade      ${sec?.access_token_expires_at ?? '—'}`);
}

console.log(`\n${B}ESECUZIONI DI SINCRONIZZAZIONE${X}`);
const { data: runs } = await sb.from('email_sync_runs')
  .select('sync_type, status, triggered_by, started_at, duration_ms, messages_seen, messages_new, attachments_imported, documents_created, analyses_started, error_code, error_detail_safe')
  .order('started_at', { ascending: false }).limit(6);
if (!runs?.length) console.log('  nessuna');
for (const r of runs ?? []) {
  console.log(`  ${r.started_at.slice(11,19)}  ${r.sync_type.padEnd(14)} ${String(r.status).padEnd(8)} da=${(r.triggered_by??'-').padEnd(15)} ` +
    `viste=${r.messages_seen} nuove=${r.messages_new} alleg=${r.attachments_imported} doc=${r.documents_created} analisi=${r.analyses_started} ` +
    `${r.duration_ms ?? '?'}ms  ${r.error_code ?? ''} ${r.error_detail_safe ?? ''}`);
}

console.log(`\n${B}MESSAGGI — solo conteggi${X}`);
const { count: tot } = await sb.from('email_messages').select('id', { count:'exact', head:true });
console.log(`  totale acquisiti  ${tot ?? 0}`);
for (const col of ['processing_status','attention_status','relevance']) {
  const { data } = await sb.from('email_messages').select(col);
  const m = {};
  for (const r of data ?? []) { const k = r[col] ?? 'null'; m[k] = (m[k]??0)+1; }
  console.log(`  ${col.padEnd(18)} ${Object.entries(m).map(([k,v])=>`${k}=${v}`).join('  ') || '—'}`);
}
const { data: err } = await sb.from('email_messages').select('error_code').not('error_code','is',null);
const me = {}; for (const r of err ?? []) me[r.error_code]=(me[r.error_code]??0)+1;
console.log(`  errori            ${Object.entries(me).map(([k,v])=>`${k}=${v}`).join('  ') || 'nessuno'}`);

console.log(`\n${B}ALLEGATI E DOCUMENTI${X}`);
const { data: att } = await sb.from('email_attachments').select('import_status');
const ma = {}; for (const r of att ?? []) ma[r.import_status]=(ma[r.import_status]??0)+1;
console.log(`  allegati          ${Object.entries(ma).map(([k,v])=>`${k}=${v}`).join('  ') || 'nessuno'}`);
const { count: docs } = await sb.from('documents').select('id',{count:'exact',head:true}).eq('source_type','email');
const { count: links } = await sb.from('email_message_documents').select('id',{count:'exact',head:true});
const { count: an } = await sb.from('ai_request_log').select('id',{count:'exact',head:true}).in('kind',['inbox_classification','inbox_analysis']);
console.log(`  documenti da email ${docs ?? 0}   collegamenti ${links ?? 0}   richieste AI Inbox ${an ?? 0}`);
