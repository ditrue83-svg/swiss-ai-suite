// ============================================================================
// SwissAI Suite — Test d'integrazione Fase 2 (analisi AI via Edge Function).
//
//   npm run test:phase2
//
// Richiede: migrazioni applicate, Edge Function `analyze-document` deployata,
// secret ANTHROPIC_API_KEY impostato su Supabase, e .env.test valorizzato.
//
// Verifica: autenticazione, isolamento cross-tenant sulla funzione, e la
// regola di prodotto più importante — le citazioni devono esistere DAVVERO
// nel documento (nessuna evidenza inventata).
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

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const created = { users: [], companies: [] };
let pass = 0, fail = 0, skipped = 0;
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', X = '\x1b[0m';
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`${G}✓${X} ${name}`); }
  else { fail++; console.log(`${R}✗ ${name}${X}${detail ? `\n   ${DIM}${detail}${X}` : ''}`); }
};
const skip = (name, why) => { skipped++; console.log(`${Y}~${X} ${name} ${DIM}(${why})${X}`); };

const PW = 'Test1234!';
async function makeUser(tag) {
  const email = `phase2+${tag}.${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { first_name: 'Test', last_name: tag },
  });
  if (error) throw error;
  created.users.push(data.user.id);
  const client = anonClient();
  const { error: sErr } = await client.auth.signInWithPassword({ email, password: PW });
  if (sErr) throw sErr;
  return { client, id: data.user.id };
}

// Documento reale in francese: contiene mittente, importo e scadenza espliciti.
const DOC_TEXT = `Administration fédérale des contributions AFC
Division principale de la TVA, 3003 Berne

Concerne: Rappel — décompte TVA 1er trimestre 2026

Madame, Monsieur,

Malgré notre courrier précédent, nous n'avons pas encore reçu votre décompte TVA pour le 1er trimestre 2026 ni le paiement correspondant.

Nous vous prions de nous faire parvenir le décompte et de verser le montant dû de CHF 8'450.00 au plus tard le 05.08.2026. À défaut, des intérêts moratoires seront perçus et une procédure de poursuite pourra être engagée.

Veuillez agréer, Madame, Monsieur, nos salutations distinguées.

Administration fédérale des contributions`;

async function invokeAnalyze(client, body) {
  const { data, error } = await client.functions.invoke('analyze-document', { body });
  if (!error) return { status: 200, data };
  const ctx = error.context;
  let status = ctx?.status ?? 0;
  let payload = null;
  if (ctx && typeof ctx.json === 'function') { try { payload = await ctx.json(); } catch { /* non JSON */ } }
  return { status, data: payload, error };
}

async function main() {
  console.log(`\n${DIM}SwissAI Suite — Fase 2 · analisi AI${X}\n`);

  const A = await makeUser('A');
  const { data: companyIdA } = await A.client.rpc('create_company_with_owner', {
    p_legal_name: 'Azienda A SA', p_canton: 'Ticino', p_sector: 'servizi', p_employee_count: 12,
  });
  created.companies.push(companyIdA);

  const { data: docA } = await A.client.from('documents').insert({
    company_id: companyIdA, uploaded_by: A.id, title: 'AFC — Rappel TVA',
    source_type: 'pasted_text', status: 'uploaded', mime_type: 'text/plain',
  }).select('*').single();

  // ---- Raggiungibilità della funzione ----
  const probe = await invokeAnalyze(A.client, { documentId: docA.id, text: DOC_TEXT });
  if (probe.status === 404 || probe.error?.message?.includes('Function not found')) {
    console.log(`${R}La Edge Function 'analyze-document' non è deployata.${X}`);
    console.log(`${DIM}Deploy: npx supabase functions deploy analyze-document${X}\n`);
    return;
  }
  if (probe.status === 503 || probe.data?.code === 'ai_not_configured') {
    check('Funzione raggiungibile e autenticazione OK', true);
    skip('Analisi AI end-to-end', 'ANTHROPIC_API_KEY non impostato come secret Supabase');
    skip('Verifica citazioni verbatim', 'analisi non eseguita');
  } else {
    check('TEST A · analisi AI eseguita', probe.status === 200 && !!probe.data?.analysis,
      probe.data?.error ?? `status ${probe.status}`);

    const an = probe.data?.analysis;
    if (an) {
      check('TEST A · lingua riconosciuta (fr)', an.language === 'fr', `ricevuto: ${an.language}`);
      check('TEST A · scadenza estratta (2026-08-05)', an.deadline === '2026-08-05', `ricevuto: ${an.deadline}`);
      check('TEST A · importo estratto (8450)', Number(an.amount) === 8450, `ricevuto: ${an.amount}`);
      check('TEST A · mittente identificato', typeof an.sender === 'string' && an.sender.length > 0);
      check('TEST A · almeno un\'azione proposta', Array.isArray(an.actions) && an.actions.length > 0);

      // La regola chiave: ogni citazione deve esistere nel documento.
      const quotes = [
        an.senderEvidence, an.deadlineEvidence, an.amountEvidence, an.risk?.evidence,
        ...(an.actions ?? []).map((a) => a.evidence),
        ...(an.requestedDocuments ?? []).map((d) => d.evidence),
      ].filter(Boolean);
      const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const haystack = norm(DOC_TEXT);
      const bogus = quotes.filter((q) => !haystack.includes(norm(q)));
      check(`TEST A · tutte le ${quotes.length} citazioni esistono nel documento`, bogus.length === 0,
        bogus.length ? `non trovate: ${bogus.slice(0, 2).map((q) => `«${q.slice(0, 60)}…»`).join(' | ')}` : '');

      console.log(`${DIM}   riepilogo: ${an.sender} · ${an.documentType} · conf. ${an.confidence} · ` +
        `${an.actions?.length ?? 0} azioni · ${quotes.length} citazioni · ${an.uncertainties?.length ?? 0} incertezze${X}`);
    }
  }

  // ---- Autorizzazione ----
  const B = await makeUser('B');
  const { data: companyIdB } = await B.client.rpc('create_company_with_owner', { p_legal_name: 'Azienda B Sagl', p_canton: 'Zurigo' });
  created.companies.push(companyIdB);

  const cross = await invokeAnalyze(B.client, { documentId: docA.id, text: DOC_TEXT });
  check('TEST B · utente B NON può analizzare il documento di A', cross.status === 403,
    `status ${cross.status} — atteso 403`);

  const noAuth = await invokeAnalyze(anonClient(), { documentId: docA.id, text: DOC_TEXT });
  check('TEST C · chiamata senza sessione rifiutata', noAuth.status === 401 || noAuth.status === 403,
    `status ${noAuth.status}`);

  const badInput = await invokeAnalyze(A.client, { documentId: docA.id, text: 'corto' });
  check('TEST D · input non valido rifiutato', badInput.status === 400, `status ${badInput.status}`);
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
