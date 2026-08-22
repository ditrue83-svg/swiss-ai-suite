// ============================================================================
// SwissAI Suite — Test pipeline Admin AI end-to-end (§58 percorso dati).
//   npm run test:pipeline
//
// API Anthropic REALE + database Supabase REALE, con la STESSA logica della
// Edge Function (moduli _shared). Prova: analisi → validazione → persistenza →
// recupero dopo "re-login" → creazione task → generazione e salvataggio bozza.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket; // Node < 22 (polyfill deliberato: il WebSocket di 'ws' non implementa l'intera interfaccia DOM)

import { runAnalysisPipeline, type CreateMessage } from '../supabase/functions/_shared/pipeline.ts';
import { buildReplyRequest } from '../supabase/functions/_shared/replyPrompt.ts';
import { parseModelJson } from '../supabase/functions/_shared/parse.ts';
import type { ExtractionResult } from '../supabase/functions/_shared/validate.ts';
import type { CompanyContext } from '../supabase/functions/_shared/prompt.ts';

const { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, ANTHROPIC_API_KEY: AI_KEY } = process.env as Record<string, string>;
if (!URL || !ANON || !SERVICE || !AI_KEY) { console.error('Mancano variabili in .env.test (SUPABASE_* + ANTHROPIC_API_KEY)'); process.exit(2); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const anthropic = new Anthropic({ apiKey: AI_KEY });
const createMessage: CreateMessage = (req) =>
  // @ts-expect-error output_config è il parametro canonico
  anthropic.messages.create(req);

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  ${G}✓${X} ${n}`); } else { fail++; console.log(`  ${R}✗ ${n}${X}${d ? ` ${DIM}${d}${X}` : ''}`); } };

const created = { users: [] as string[], companies: [] as string[] };
const PW = 'Test1234!';
async function makeUser(tag: string) {
  const email = `pipeline+${tag}.${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { first_name: 'Test', last_name: tag } });
  if (error) throw error;
  created.users.push(data.user.id);
  const client = anonClient();
  await client.auth.signInWithPassword({ email, password: PW });
  return { client, id: data.user.id, email };
}

const AFC = `Administration fédérale des contributions AFC
Division principale de la TVA, 3003 Berne

Concerne: Rappel — décompte TVA 1er trimestre 2026

Madame, Monsieur,

Nous n'avons pas encore reçu votre décompte TVA pour le 1er trimestre 2026. Nous vous prions de verser le montant dû de CHF 8'450.00 au plus tard le 05.08.2026. À défaut, des intérêts moratoires seront perçus.

Veuillez agréer nos salutations distinguées.
Administration fédérale des contributions`;

const CTX: CompanyContext = { legalName: 'Rossi Impianti Sagl', canton: 'Ticino', municipality: 'Lugano', legalForm: 'Sagl', sector: 'costruzioni' };

async function main() {
  console.log(`\n${DIM}Pipeline Admin AI end-to-end · API + DB reali${X}\n`);

  const A = await makeUser('A');
  const { data: companyId } = await A.client.rpc('create_company_with_owner', { p_legal_name: CTX.legalName, p_canton: 'Ticino', p_municipality: 'Lugano', p_legal_form: 'Sagl', p_sector: 'costruzioni' });
  created.companies.push(companyId as string);

  const { data: doc } = await A.client.from('documents').insert({
    company_id: companyId, uploaded_by: A.id, title: 'AFC — Rappel TVA',
    source_type: 'pasted_text', status: 'uploaded', mime_type: 'text/plain', file_hash: 'test-hash-afc',
  }).select('*').single();

  const extraction: ExtractionResult = { fullText: AFC, extractionMethod: 'text', pages: [{ pageNumber: 1, text: AFC }] };

  console.log(`${B}Analisi (pipeline reale)${X}`);
  // 0010 — la pipeline scrive con il SERVICE ROLE, come fa la Edge Function: dal
  // client autenticato quelle scritture sono ora vietate (snapshot immutabile,
  // testo estratto in sola lettura). L'autorizzazione dell'utente resta
  // verificata a monte dalla funzione, e più sotto si rilegge con `A2`, cioè
  // come membro, per provare che la RLS in lettura continua a funzionare.
  const result = await runAnalysisPipeline(admin as any, createMessage, {
    documentId: doc.id, companyId: companyId as string, userId: A.id,
    extraction, extractionDurationMs: 5, companyContext: CTX, todayIso: '2026-07-24', provider: 'anthropic',
    // Questa prova gira col service role e senza slot prenotato: si dichiara
    // 'sistema', che è ciò che quel client può davvero fare.
    logSb: admin as never, logComeChi: 'sistema',
  });
  check('lingua = fr', result.analysis.language === 'fr', result.analysis.language);
  check('importo 8450 rilevato', result.analysis.amounts.some((m) => Math.round(m.amount) === 8450));
  check('scadenza 2026-08-05', result.analysis.deadline.date === '2026-08-05', String(result.analysis.deadline.date));
  check('status = completed', result.status === 'completed', result.status);

  // ---- Recupero dopo "re-login" (client fresco) ----
  console.log(`${B}Persistenza dopo re-login${X}`);
  const A2 = anonClient(); await A2.auth.signInWithPassword({ email: A.email, password: PW });

  // ⚠️ `.order().limit(1)` e non `.maybeSingle()` nudo: le analisi si accumulano
  // (saveAnalysis non cancella più le precedenti, per non portarsi via le
  // correzioni umane in cascata). Su più righe `maybeSingle()` non torna la più
  // recente: torna un errore, e il test fallirebbe per il motivo sbagliato.
  const { data: an } = await A2.from('document_analyses').select('*').eq('document_id', doc.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  check('analisi persistita e leggibile', !!an);
  check('colonne ricche: provider/model/prompt_version', !!an?.provider && !!an?.model && !!an?.prompt_version);
  check('deadline_type persistito', an?.deadline_type === 'explicit', String(an?.deadline_type));
  check('amounts (JSONB) persistito', Array.isArray(an?.amounts) && an.amounts.length >= 1);
  check('colonne legacy: language/deadline coerenti', an?.language === 'fr' && an?.deadline === '2026-08-05');
  check('overall_confidence numerico', typeof an?.overall_confidence === 'number');

  const { data: ext } = await A2.from('document_extractions').select('extraction_method,char_count').eq('document_id', doc.id).maybeSingle();
  check('estrazione persistita (separata dall\'originale)', ext?.extraction_method === 'text' && (ext?.char_count ?? 0) > 100);

  const { count: logCount } = await A2.from('ai_request_log').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  check('log tecnico scritto (senza contenuto)', (logCount ?? 0) >= 1);

  // ---- Task da un'azione ----
  console.log(`${B}Task dallo scadenziario${X}`);
  const primary = result.analysis.primaryAction;
  const { data: task, error: taskErr } = await A2.from('tasks').insert({
    company_id: companyId, created_by: A.id, document_id: doc.id,
    title: primary?.title ?? 'Azione', authority: result.analysis.sender.name, due_date: result.analysis.deadline.date,
    priority: 'high', source: 'admin_ai',
  }).select('id').single();
  check('task creato dall\'analisi', !taskErr && !!task);
  const { data: tasksAfter } = await A2.from('tasks').select('id').eq('document_id', doc.id);
  check('task presente dopo re-login', (tasksAfter ?? []).length === 1);

  // ---- Bozza di risposta (chiamata AI separata) ----
  console.log(`${B}Bozza di risposta (§35–38)${X}`);
  const replyReq = buildReplyRequest({
    documentText: AFC, language: 'fr', tone: 'formale', companyName: CTX.legalName,
    summary: result.analysis.summary, senderName: result.analysis.sender.name,
    deadlineText: result.analysis.deadline.date, userNotes: null,
  });
  // @ts-expect-error output_config canonico
  const replyMsg = await anthropic.messages.create(replyReq);
  const replyText = (replyMsg.content.find((b: any) => b.type === 'text') as any)?.text ?? '';
  check('bozza generata (testo non vuoto)', replyText.trim().length > 40);
  // §36: senza conferma dell'utente, non deve dichiarare il pagamento come già effettuato
  check('non dichiara pagamenti già effettuati (§36)', !/(a été (effectué|payé|versé)|est effectué)/i.test(replyText),
    replyText.slice(0, 60));

  const { error: repErr } = await A2.from('document_replies').insert({
    document_id: doc.id, company_id: companyId, analysis_id: an?.id, created_by: A.id,
    language: 'fr', tone: 'formale', content: replyText, provider: 'anthropic', model: 'claude-opus-4-8',
  });
  check('bozza salvata in document_replies', !repErr);
  const { data: reps } = await A2.from('document_replies').select('id,content').eq('document_id', doc.id);
  check('bozza presente dopo re-login', (reps ?? []).length === 1 && (reps![0].content?.length ?? 0) > 40);

  console.log(`\n${DIM}   ${result.analysis.summary.slice(0, 120)}…${X}`);
}

async function cleanup() {
  console.log(`\n${DIM}Pulizia…${X}`);
  for (const id of created.companies) { try { await admin.from('companies').delete().eq('id', id); } catch { /* */ } }
  for (const id of created.users) { try { await admin.auth.admin.deleteUser(id); } catch { /* */ } }
}

main().catch((e) => { console.error(`${R}Errore fatale:${X}`, (e as Error)?.message ?? e); fail++; })
  .finally(async () => { await cleanup(); console.log(`\n${pass} passati, ${fail} falliti\n`); process.exit(fail ? 1 : 0); });
