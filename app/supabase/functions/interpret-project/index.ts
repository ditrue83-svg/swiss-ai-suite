// ============================================================================
// Edge Function: interpret-project (Subsidy AI, §S2)
// Interpreta la descrizione libera del progetto server-side (chiave Anthropic
// come secret, mai nel browser) e restituisce l'interpretazione normalizzata.
// NON persiste: il risultato alimenta il matching lato client.
//
// Sicurezza: JWT valido; autorizza via membership (§49, legge la company col
// client autenticato COME l'utente: non membro → 403); rate limit per azienda
// (§50); la descrizione è DATO, non istruzioni (§21, nel prompt).
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildInterpretRequest, validateInterpretation, INTERPRET_MODEL,
  type AiInterpretation, type SubsidyContext,
} from '../_shared/subsidyInterpret.ts';
import { parseModelJson } from '../_shared/parse.ts';
import { logAiRequest, reserveAiSlot, finalizeAiRequest } from '../_shared/persist.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const RATE_LIMIT_PER_MINUTE = 12;   // §50
const MAX_CHARS = 4000;             // descrizione: testo breve
const MIN_CHARS = 15;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Autenticazione richiesta.' }, 401);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Sessione non valida.', code: 'PROVIDER_ERROR' }, 401);
  const userId = userData.user.id;

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Servizio AI non configurato.', code: 'AI_NOT_CONFIGURED' }, 503);

  const body = await req.json().catch(() => null);
  const companyId = body?.companyId;
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, MAX_CHARS) : '';
  // §42 — i testi generati seguono la lingua dell'interfaccia.
  const outputLanguage: 'it' | 'de' | 'fr' =
    body?.outputLanguage === 'de' ? 'de' : body?.outputLanguage === 'fr' ? 'fr' : 'it';
  if (typeof companyId !== 'string') return json({ error: 'Richiesta non valida.', code: 'UNKNOWN_ERROR' }, 400);
  if (description.length < MIN_CHARS) return json({ error: 'Descrivi il progetto con qualche frase in più.', code: 'EMPTY_DOCUMENT' }, 422);

  // §49 — membership via RLS: se non membro, la select non torna nulla → 403.
  const { data: company, error: cErr } = await sb.from('companies').select('canton').eq('id', companyId).maybeSingle();
  if (cErr) return json({ error: 'Errore di lettura.', code: 'UNKNOWN_ERROR' }, 500);
  if (!company) return json({ error: 'Azienda non trovata o accesso negato.', code: 'PROVIDER_ERROR' }, 403);

  // §50 — quota per azienda, verificata e consumata ATOMICAMENTE (0009):
  // richieste concorrenti non possono più passare tutte insieme.
  const slot = await reserveAiSlot(sb, {
    companyId, kind: 'interpret', limitPerMinute: RATE_LIMIT_PER_MINUTE,
    provider: 'anthropic', model: INTERPRET_MODEL,
  });
  if (!slot.allowed) return json({ error: 'Troppe richieste. Attendi un istante.', code: 'RATE_LIMITED' }, 429);

  const { data: cprofile } = await sb.from('company_profiles').select('sector, employee_count').eq('company_id', companyId).maybeSingle();
  const ctx: SubsidyContext = {
    canton: (company.canton as string | null) ?? null,
    sector: (cprofile?.sector as string | null) ?? null,
    employeeCount: (cprofile?.employee_count as number | null) ?? null,
  };

  const started = Date.now();
  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create(buildInterpretRequest(description, ctx, outputLanguage) as never) as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string };
    if (msg.stop_reason === 'refusal') return json({ error: 'Interpretazione rifiutata dal modello.', code: 'PROVIDER_ERROR' }, 422);
    const text = msg.content.find((b) => b.type === 'text' && b.text)?.text ?? '';
    const raw = parseModelJson(text) as AiInterpretation;
    const interpretation = validateInterpretation(raw, description);

    const done = await finalizeAiRequest(sb, slot.logId, {
      status: 'ok', durationMs: Date.now() - started,
      inputTokens: msg.usage?.input_tokens ?? null, outputTokens: msg.usage?.output_tokens ?? null,
    });
    if (!done) await logAiRequest(sb, {
      companyId, userId, documentId: null, kind: 'interpret', provider: 'anthropic', model: INTERPRET_MODEL,
      status: 'ok', durationMs: Date.now() - started, inputTokens: msg.usage?.input_tokens ?? null, outputTokens: msg.usage?.output_tokens ?? null,
    });
    return json({ interpretation });
  } catch (e) {
    const done = await finalizeAiRequest(sb, slot.logId, { status: 'error', errorCode: 'PROVIDER_ERROR' });
    if (!done) await logAiRequest(sb, { companyId, userId, documentId: null, kind: 'interpret', provider: 'anthropic', model: INTERPRET_MODEL, status: 'error', errorCode: 'PROVIDER_ERROR' });
    console.error('interpret error:', (e as Error)?.name);
    return json({ error: 'Interpretazione non riuscita. Riprova.', code: 'PROVIDER_ERROR' }, 502);
  }
});
