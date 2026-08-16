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
// ⚠️ La soglia e la regola arrivano dal modulo che le usa a schermo, non da una
// copia scritta qui: un diagnostico che si riscrive la regola misura sé stesso.
// È il motivo per cui questo file gira con `--import tsx`.
import { comprimibile, SOGLIA_COMPRESSIONE } from '../src/features/inbox/emphasis.ts';
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

// ---------------------------------------------------------------------------
// I FILTRI IN CIMA — quante di quelle cinque voci mostrano davvero cose diverse
//
// Cinque bottoni quasi equivalenti a colpo d'occhio non sono cinque strumenti:
// sono una barra da leggere ogni volta. La domanda non si risponde guardando il
// codice — i cinque predicati SONO diversi — ma guardando i dati: due filtri
// distinti che oggi pescano lo stesso insieme, o nessuno, sono decorazione.
//
// Si confrontano gli INSIEMI DI ID, non i conteggi: due filtri da 22 righe
// possono pescarne 22 diverse. Degli id non si stampa nulla.
// ---------------------------------------------------------------------------
console.log(`\n${B}FILTRI — quante viste sono davvero distinte${X}`);
const { data: righe, error: erroreRighe } = await sb.from('email_messages')
  .select('id, company_id, attention_status, relevance_confidence, analysis_deadline');
if (erroreRighe) {
  // Nessun fallback silenzioso: senza le righe non si dice «tutto a posto».
  console.log(`  ✗ non è stato possibile leggere i messaggi: ${erroreRighe.message}`);
} else {
  const limite = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const FILTRI = {
    'Tutte':                (r) => r.attention_status !== 'handled',
    'Da gestire':           (r) => r.attention_status === 'needs_attention',
    'Con scadenza vicina':  (r) => r.analysis_deadline != null && r.analysis_deadline <= limite
                                   && r.attention_status !== 'handled',
    'Da verificare':        (r) => r.attention_status === 'to_verify',
    'Messe via':            (r) => r.attention_status === 'handled',
  };
  const aziende = [...new Set((righe ?? []).map((r) => r.company_id))];
  for (const azienda of aziende) {
    const mie = righe.filter((r) => r.company_id === azienda);
    console.log(`  azienda …${azienda.slice(-6)}   ${mie.length} messaggi`);
    const insiemi = {};
    for (const [nome, f] of Object.entries(FILTRI)) {
      insiemi[nome] = JSON.stringify(mie.filter(f).map((r) => r.id).sort());
      const n = JSON.parse(insiemi[nome]).length;
      console.log(`    ${nome.padEnd(22)} ${String(n).padStart(4)}${n === 0 ? `   ${D}(schermata vuota)${X}` : ''}`);
    }
    const nomi = Object.keys(FILTRI);
    const coppie = [];
    for (let i = 0; i < nomi.length; i++) {
      for (let j = i + 1; j < nomi.length; j++) {
        if (insiemi[nomi[i]] === insiemi[nomi[j]]) coppie.push(`${nomi[i]} = ${nomi[j]}`);
      }
    }
    console.log(`    ${B}viste distinte${X}        ${new Set(Object.values(insiemi)).size} su ${nomi.length}`
      + (coppie.length ? `   ${D}coincidono: ${coppie.join(' · ')}${X}` : ''));

    // ---- La divisione di «Tutte»: in evidenza e compressi -----------------
    // ⚠️ L'INVARIANTE: le due metà devono ricomporre l'elenco intero. Se la
    // somma non torna, qualche messaggio non è in nessuna delle due viste — ed
    // è sparito dalla pagina senza che nulla lo dichiari.
    const nonMesseVia = mie.filter((r) => r.attention_status !== 'handled');
    const compressi = nonMesseVia.filter((r) => comprimibile({
      attentionStatus: r.attention_status, relevanceConfidence: r.relevance_confidence,
    }));
    const inEvidenza = nonMesseVia.length - compressi.length;
    const informative = nonMesseVia.filter((r) => r.attention_status === 'informational').length;
    console.log(`    ${B}«Tutte» divisa${X}        in evidenza ${inEvidenza} (di cui ${informative} informative,`
      + ` ${inEvidenza - informative} che chiedono un'azione)   compressi ${compressi.length}`);
    console.log(`    somma                 ${inEvidenza} + ${compressi.length} = ${inEvidenza + compressi.length}`
      + `   ${inEvidenza + compressi.length === nonMesseVia.length ? '✓ ricompone l\'elenco' : '✗ QUALCOSA È SPARITO'}`);
    const dubbi = compressi.filter((r) => r.relevance_confidence != null
      && r.relevance_confidence < SOGLIA_COMPRESSIONE).length;
    console.log(`    sotto la soglia ${SOGLIA_COMPRESSIONE}   ${dubbi} compressi con fiducia insufficiente`
      + `   ${dubbi === 0 ? '✓ nessuno' : '✗ non dovrebbe accadere'}`);
  }
}

console.log(`\n${B}ALLEGATI E DOCUMENTI${X}`);
const { data: att } = await sb.from('email_attachments').select('import_status');
const ma = {}; for (const r of att ?? []) ma[r.import_status]=(ma[r.import_status]??0)+1;
console.log(`  allegati          ${Object.entries(ma).map(([k,v])=>`${k}=${v}`).join('  ') || 'nessuno'}`);
const { count: docs } = await sb.from('documents').select('id',{count:'exact',head:true}).eq('source_type','email');
const { count: links } = await sb.from('email_message_documents').select('id',{count:'exact',head:true});
const { count: an } = await sb.from('ai_request_log').select('id',{count:'exact',head:true}).in('kind',['inbox_classification','inbox_analysis']);
console.log(`  documenti da email ${docs ?? 0}   collegamenti ${links ?? 0}   richieste AI Inbox ${an ?? 0}`);
