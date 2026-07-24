// ============================================================================
// SwissAI Suite — Test d'integrazione Fase 2 sulla Edge Function DEPLOYATA.
//
//   npm run test:phase2
//
// Richiede: migrazioni applicate (0006), Edge Function `analyze-document`
// deployata, secret ANTHROPIC_API_KEY impostato sul progetto Supabase, e
// .env.test valorizzato (SUPABASE_* + service_role).
//
// Due blocchi:
//  1) SICUREZZA / AUTORIZZAZIONE (§49/§50) — economici, non spendono AI:
//     no-auth → 401, documentId mancante → 400, cross-tenant → 403,
//     testo vuoto → 422, rate limit per azienda → 429.
//  2) END-TO-END REALE (§20) — una vera analisi via HTTP sulla funzione
//     deployata: campi estratti corretti, citazioni verbatim verificate,
//     persistenza rileggibile dopo il round-trip.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket; // Node < 22

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('Mancano SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.test');
  process.exit(2);
}
const FN_URL = `${URL.replace(/\/$/, '')}/functions/v1/analyze-document`;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const created = { users: [], companies: [] };
let pass = 0, fail = 0, skipped = 0;
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const skip = (name, why) => { skipped++; console.log(`  ${Y}~${X} ${name} ${DIM}(${why})${X}`); };

const PW = 'Test1234!';

// L'admin API di Supabase (service_role) restituisce a intermittenza (~10%) un
// transiente di propagazione delle chiavi di firma ES256 ("unrecognized JWT kid
// <nil>"). Colpisce SOLO gli script (service_role), mai il login utente reale
// (signInWithPassword). Ci riproviamo, ma solo su quello specifico errore.
const isJwtTransient = (msg = '') => /invalid JWT|unverifiable|unrecognized JWT kid/i.test(msg);
async function withRetry(label, fn, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await fn();
    if (!error) return data;
    last = error;
    if (!isJwtTransient(error.message)) break;            // errore reale → niente retry
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  throw new Error(`${label}: ${last?.message ?? 'errore'}`);
}

async function makeUser(tag) {
  const email = `phase2+${tag}.${Date.now()}@example.com`;
  const data = await withRetry('createUser', () => admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { first_name: 'Test', last_name: tag },
  }));
  created.users.push(data.user.id);
  const client = anonClient();
  await withRetry('signIn', () => client.auth.signInWithPassword({ email, password: PW }));
  return { client, id: data.user.id, email };
}

// Documento reale in francese: mittente, importo e scadenza espliciti.
const DOC_TEXT = `Administration fédérale des contributions AFC
Division principale de la TVA, 3003 Berne

Concerne: Rappel — décompte TVA 1er trimestre 2026

Madame, Monsieur,

Malgré notre courrier précédent, nous n'avons pas encore reçu votre décompte TVA pour le 1er trimestre 2026 ni le paiement correspondant.

Nous vous prions de nous faire parvenir le décompte et de verser le montant dû de CHF 8'450.00 au plus tard le 05.08.2026. À défaut, des intérêts moratoires seront perçus et une procédure de poursuite pourra être engagée.

Veuillez agréer, Madame, Monsieur, nos salutations distinguées.

Administration fédérale des contributions`;

const EXTRACTION = { fullText: DOC_TEXT, extractionMethod: 'text', pages: [{ pageNumber: 1, text: DOC_TEXT }] };

// Invoca la funzione con la sessione del client (JWT utente). Ritorna { status, data }.
async function invoke(client, body) {
  const { data, error } = await client.functions.invoke('analyze-document', { body });
  if (!error) return { status: 200, data };
  const ctx = error.context;
  let status = ctx?.status ?? 0;
  let payload = null;
  if (ctx && typeof ctx.json === 'function') { try { payload = await ctx.json(); } catch { /* non JSON */ } }
  return { status, data: payload, error };
}

async function main() {
  console.log(`\n${DIM}SwissAI Suite — Fase 2 · Edge Function analyze-document (deployata)${X}\n`);

  // ---- Setup: tre aziende isolate -----------------------------------------
  const A = await makeUser('A');
  const { data: companyA } = await A.client.rpc('create_company_with_owner', {
    p_legal_name: 'Azienda A SA', p_canton: 'Ticino', p_municipality: 'Lugano', p_legal_form: 'SA', p_sector: 'servizi',
  });
  created.companies.push(companyA);
  const { data: docA } = await A.client.from('documents').insert({
    company_id: companyA, uploaded_by: A.id, title: 'AFC — Rappel TVA',
    source_type: 'pasted_text', status: 'uploaded', mime_type: 'text/plain', file_hash: `phase2-${Date.now()}`,
  }).select('*').single();

  // ---- 0. Raggiungibilità (economico: documentId mancante → 400) ----------
  console.log(`${B}Raggiungibilità${X}`);
  const reach = await invoke(A.client, {});
  if (reach.status === 404 || /not found/i.test(reach.error?.message ?? '')) {
    console.log(`\n${R}La Edge Function 'analyze-document' non è deployata (404).${X}`);
    console.log(`${DIM}Deploy: npx supabase functions deploy analyze-document --project-ref <ref>${X}\n`);
    return;
  }
  const aiConfigured = reach.data?.code !== 'AI_NOT_CONFIGURED' && reach.status !== 503;
  check('funzione raggiungibile e autenticazione accettata', reach.status === 400 || reach.status === 503,
    `status ${reach.status}`);
  if (!aiConfigured) {
    console.log(`\n${Y}Secret ANTHROPIC_API_KEY non impostato sul progetto: i controlli a valle del check`);
    console.log(`chiave (400/403/429/422) e l'analisi reale non sono eseguibili.${X}`);
    console.log(`${DIM}npx supabase secrets set ANTHROPIC_API_KEY=... --project-ref <ref>${X}`);
    skip('blocco sicurezza (400/403/429/422)', 'secret AI assente');
    skip('analisi end-to-end (§20)', 'secret AI assente');
    return;
  }

  // ---- 1. Sicurezza / autorizzazione (§49/§50) ----------------------------
  console.log(`\n${B}Sicurezza / autorizzazione (§49/§50)${X}`);

  // 1a — documentId mancante → 400
  check('documentId mancante → 400', reach.status === 400 && reach.data?.code === 'UNKNOWN_ERROR',
    `status ${reach.status}, code ${reach.data?.code}`);

  // 1b — §49 cross-tenant: utente B non può toccare il documento di A → 403
  const Bu = await makeUser('B');
  const { data: companyB } = await Bu.client.rpc('create_company_with_owner', { p_legal_name: 'Azienda B Sagl', p_canton: 'Zurigo' });
  created.companies.push(companyB);
  const cross = await invoke(Bu.client, { documentId: docA.id, extraction: EXTRACTION });
  check('§49 · utente B NON può analizzare il documento di A → 403', cross.status === 403,
    `status ${cross.status} — atteso 403 (code ${cross.data?.code})`);

  // 1c — nessuna sessione utente → 401 (client anon, e fetch grezza senza header)
  const noSession = await invoke(anonClient(), { documentId: docA.id, extraction: EXTRACTION });
  check('sessione anon (nessun utente) → 401', noSession.status === 401, `status ${noSession.status}`);
  let rawStatus = 0;
  try {
    const r = await fetch(FN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: docA.id }) });
    rawStatus = r.status;
  } catch (e) { rawStatus = -1; }
  check('richiesta grezza senza Authorization → 401', rawStatus === 401, `status ${rawStatus}`);

  // 1d — testo troppo corto → 422 EMPTY_DOCUMENT (non spende AI)
  const empty = await invoke(A.client, { documentId: docA.id, extraction: { fullText: 'corto', extractionMethod: 'text', pages: [{ pageNumber: 1, text: 'corto' }] } });
  check('testo vuoto/troppo corto → 422 EMPTY_DOCUMENT', empty.status === 422 && empty.data?.code === 'EMPTY_DOCUMENT',
    `status ${empty.status}, code ${empty.data?.code}`);

  // 1e — §50 rate limit per azienda → 429 (pre-popolo il log via service_role)
  const C = await makeUser('C');
  const { data: companyC } = await C.client.rpc('create_company_with_owner', { p_legal_name: 'Azienda C Sagl', p_canton: 'Berna' });
  created.companies.push(companyC);
  const { data: docC } = await C.client.from('documents').insert({
    company_id: companyC, uploaded_by: C.id, title: 'Doc C', source_type: 'pasted_text', status: 'uploaded', mime_type: 'text/plain', file_hash: `phase2c-${Date.now()}`,
  }).select('id').single();
  const burst = Array.from({ length: 13 }, () => ({ company_id: companyC, user_id: C.id, document_id: docC.id, kind: 'analysis', provider: 'anthropic', model: 'claude-opus-4-8', status: 'ok' }));
  const { error: seedErr } = await admin.from('ai_request_log').insert(burst);
  if (seedErr) { skip('§50 · rate limit → 429', `seed log fallito: ${seedErr.message}`); }
  else {
    const limited = await invoke(C.client, { documentId: docC.id, extraction: EXTRACTION });
    check('§50 · oltre il limite/minuto per azienda → 429', limited.status === 429 && limited.data?.code === 'RATE_LIMITED',
      `status ${limited.status}, code ${limited.data?.code}`);
  }

  // ---- 2. End-to-end reale (§20) sulla funzione deployata ------------------
  console.log(`\n${B}Analisi end-to-end reale (§20)${X}`);
  const res = await invoke(A.client, { documentId: docA.id, extraction: EXTRACTION });
  const an = res.data?.analysis;
  check('analisi eseguita via HTTP → 200 + analysis', res.status === 200 && !!an,
    res.data?.error ?? res.data?.code ?? `status ${res.status}`);
  if (an) {
    check('lingua riconosciuta (fr)', an.language === 'fr', `ricevuto: ${an.language}`);
    check('scadenza esplicita 2026-08-05', an.deadline?.date === '2026-08-05' && an.deadline?.type === 'explicit',
      `date ${an.deadline?.date} · type ${an.deadline?.type}`);
    check('importo dovuto 8450 rilevato', Array.isArray(an.amounts) && an.amounts.some((m) => Math.round(m.amount) === 8450),
      `amounts: ${JSON.stringify(an.amounts?.map((m) => m.amount))}`);
    check('mittente identificato', typeof an.sender?.name === 'string' && an.sender.name.length > 0, an.sender?.name ?? '(nullo)');
    check('almeno un\'azione + primaryAction', Array.isArray(an.actions) && an.actions.length > 0 && !!an.primaryAction);

    // §20 — ogni citazione VERIFICATA deve esistere verbatim nel testo.
    const evList = [
      an.sender?.evidence, an.deadline?.evidence, an.documentType?.evidence,
      ...(an.amounts ?? []).map((m) => m.evidence),
      ...(an.actions ?? []).map((a) => a.evidence),
      ...(an.requestedDocuments ?? []).map((d) => d.evidence),
      ...(an.risks ?? []).map((r) => r.evidence),
      ...(an.referenceNumbers ?? []).map((r) => r.evidence),
      ...(an.legalReferences ?? []).map((l) => l.evidence),
    ].filter((e) => e && e.verified === true && typeof e.quote === 'string');
    const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const haystack = norm(DOC_TEXT);
    const bogus = evList.filter((e) => !haystack.includes(norm(e.quote)));
    check(`§20 · tutte le ${evList.length} citazioni verificate esistono nel documento`, bogus.length === 0,
      bogus.length ? `non trovate: ${bogus.slice(0, 2).map((e) => `«${e.quote.slice(0, 60)}…»`).join(' | ')}` : '');

    // ---- Persistenza rileggibile dopo il round-trip HTTP ----
    console.log(`\n${B}Persistenza dopo il round-trip${X}`);
    const A2 = anonClient(); await A2.auth.signInWithPassword({ email: A.email, password: PW });
    const { data: row } = await A2.from('document_analyses').select('*').eq('document_id', docA.id).maybeSingle();
    check('analisi persistita e leggibile dal membro', !!row);
    check('provenienza ricca: provider/model/prompt_version', !!row?.provider && !!row?.model && !!row?.prompt_version,
      `provider ${row?.provider} · model ${row?.model} · prompt ${row?.prompt_version}`);
    check('deadline_type persistito = explicit', row?.deadline_type === 'explicit', String(row?.deadline_type));
    check('amounts (JSONB) persistito', Array.isArray(row?.amounts) && row.amounts.length >= 1);
    check('overall_confidence numerico', typeof row?.overall_confidence === 'number', String(row?.overall_confidence));
    check('colonne legacy coerenti (language/deadline)', row?.language === 'fr' && row?.deadline === '2026-08-05');
    check('stato coerente (completed|needs_review)', ['completed', 'needs_review'].includes(row?.analysis_status), String(row?.analysis_status));

    const { data: ext } = await A2.from('document_extractions').select('extraction_method,char_count').eq('document_id', docA.id).maybeSingle();
    check('estrazione persistita separata dall\'originale', ext?.extraction_method === 'text' && (ext?.char_count ?? 0) > 100);
    const { count: logCount } = await A2.from('ai_request_log').select('id', { count: 'exact', head: true }).eq('company_id', companyA);
    check('log tecnico scritto (osservabilità §45)', (logCount ?? 0) >= 1, `righe: ${logCount}`);

    console.log(`\n${DIM}   ${(an.summary ?? '').slice(0, 120)}…  ·  conf ${an.overallConfidence} · ${an.meta?.droppedEvidence ?? 0} citazioni scartate${X}`);
  }
}

async function cleanup() {
  console.log(`\n${DIM}Pulizia dati di test…${X}`);
  for (const id of created.companies) { try { await admin.from('companies').delete().eq('id', id); } catch { /* ignore */ } }
  for (const id of created.users) { try { await admin.auth.admin.deleteUser(id); } catch { /* ignore */ } }
}

main()
  .catch((e) => { console.error(`${R}Errore fatale:${X}`, e?.message ?? e); fail++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n${pass} passati, ${fail} falliti${skipped ? `, ${skipped} saltati` : ''}\n`);
    process.exit(fail ? 1 : 0);
  });
