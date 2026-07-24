// ============================================================================
// Edge Function: generate-reply (Fase 2)
// Genera una BOZZA di risposta con Claude, server-side, come chiamata separata
// dall'analisi (§35). Salva in document_replies. NON invia nulla (§39).
// Autorizza via RLS come analyze-document (§49).
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildReplyRequest, REPLY_LANGUAGES, REPLY_TONES, REPLY_PROMPT_VERSION,
  type ReplyLanguage, type ReplyTone,
} from '../_shared/replyPrompt.ts';
import { logAiRequest } from '../_shared/persist.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const RATE_LIMIT_PER_MINUTE = 12;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Autenticazione richiesta.' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Sessione non valida.' }, 401);
  const userId = userData.user.id;

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Servizio AI non configurato.', code: 'AI_NOT_CONFIGURED' }, 503);

  const body = await req.json().catch(() => null);
  const documentId = body?.documentId;
  const language: ReplyLanguage = REPLY_LANGUAGES.includes(body?.language) ? body.language : 'it';
  const tone: ReplyTone = REPLY_TONES.includes(body?.tone) ? body.tone : 'formale';
  const userNotes: string | null = typeof body?.userNotes === 'string' ? body.userNotes.slice(0, 2000) : null;
  if (typeof documentId !== 'string') return json({ error: 'Richiesta non valida.' }, 400);

  // §49 — autorizza via RLS.
  const { data: doc } = await sb.from('documents').select('id, company_id').eq('id', documentId).maybeSingle();
  if (!doc) return json({ error: 'Documento non trovato o accesso negato.' }, 403);
  const companyId = doc.company_id as string;

  // Rate limit condiviso col percorso di analisi.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await sb.from('ai_request_log').select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', since);
  if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) return json({ error: 'Troppe richieste. Attendi un istante.', code: 'RATE_LIMITED' }, 429);

  // Materiale: testo estratto + sintesi dell'analisi. Nessun dato inventato lato prompt.
  const { data: ext } = await sb.from('document_extractions').select('full_text').eq('document_id', documentId).maybeSingle();
  const { data: an } = await sb.from('document_analyses')
    .select('id, summary, sender, deadline, deadline_source_text').eq('document_id', documentId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const { data: company } = await sb.from('companies').select('legal_name').eq('id', companyId).maybeSingle();

  const documentText = (ext?.full_text as string | null) ?? '';
  if (documentText.trim().length < 20) return json({ error: 'Testo del documento non disponibile per la risposta.' }, 422);

  const started = Date.now();
  try {
    const anthropic = new Anthropic({ apiKey });
    const request = buildReplyRequest({
      documentText, language, tone, companyName: company?.legal_name ?? null,
      summary: (an?.summary as string | null) ?? null,
      senderName: (an?.sender as string | null) ?? null,
      deadlineText: (an?.deadline as string | null) ?? (an?.deadline_source_text as string | null) ?? null,
      userNotes,
    });
    const msg = await anthropic.messages.create(request as never) as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string };
    if (msg.stop_reason === 'refusal') return json({ error: 'Generazione rifiutata dal modello.', code: 'PROVIDER_ERROR' }, 422);
    const content = msg.content.find((b) => b.type === 'text' && b.text)?.text?.trim();
    if (!content) return json({ error: 'Bozza non generata.', code: 'AI_INVALID_OUTPUT' }, 502);

    const { data: reply, error: repErr } = await sb.from('document_replies').insert({
      document_id: documentId, company_id: companyId, analysis_id: an?.id ?? null, created_by: userId,
      language, tone, content, provider: 'anthropic', model: 'claude-opus-4-8', prompt_version: REPLY_PROMPT_VERSION,
    }).select('*').single();
    if (repErr) throw new Error(repErr.message);

    await logAiRequest(sb, {
      companyId, userId, documentId, kind: 'reply', provider: 'anthropic', model: 'claude-opus-4-8',
      status: 'ok', durationMs: Date.now() - started, inputTokens: msg.usage?.input_tokens ?? null, outputTokens: msg.usage?.output_tokens ?? null,
    });
    return json({ reply });
  } catch (e) {
    await logAiRequest(sb, { companyId, userId, documentId, kind: 'reply', provider: 'anthropic', model: 'claude-opus-4-8', status: 'error', errorCode: 'PROVIDER_ERROR' });
    console.error('reply error:', (e as Error)?.name);
    return json({ error: 'Generazione della bozza non riuscita. Riprova.', code: 'PROVIDER_ERROR' }, 502);
  }
});
