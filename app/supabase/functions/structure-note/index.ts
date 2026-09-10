// ============================================================================
// Edge Function: structure-note (Fase 3.1, 2026-09-10)
// «Struttura con AI» della nota rapida: testo libero → { subject, notes }.
//
// A DIFFERENZA di generate-reply NON persiste nulla: la nota la salva il
// client (crm_interactions) dopo che la persona ha riletto i campi. Qui si
// spende solo la chiamata al modello — e infatti la quota AI si prenota e si
// chiude come ovunque (0009), con la membership verificata PRIMA di spendere:
// `try_consume_ai_quota` da sola cadrebbe nel ripiego non atomico se la RPC
// andasse in errore, e il ripiego la membership non la conosce.
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildNoteRequest, validateStructuredNote, NOTE_LANGUAGES, NOTE_MODEL,
  NOTE_TEXT_MAX, type NoteLanguage,
} from '../_shared/notePrompt.ts';
import { logAiRequest, reserveAiSlot, finalizeAiRequest } from '../_shared/persist.ts';
import { parseModelJson } from '../_shared/parse.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// La stessa misura della bozza di risposta: un gesto umano, non una catena.
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
  const companyId = typeof body?.companyId === 'string' ? body.companyId : null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const language: NoteLanguage = NOTE_LANGUAGES.includes(body?.lang) ? body.lang : 'it';
  if (!companyId) return json({ error: 'Richiesta non valida.' }, 400);
  if (text.length < 3) return json({ error: 'La nota è vuota.' }, 422);
  if (text.length > NOTE_TEXT_MAX) return json({ error: 'La nota supera la lunghezza ammessa.' }, 422);

  // La membership PRIMA di spendere: la RLS lascia leggere a ciascuno solo le
  // proprie righe, quindi «nessuna riga» e «non sei dei loro» coincidono.
  const { data: membership } = await sb.from('company_members')
    .select('company_id').eq('company_id', companyId).maybeSingle();
  if (!membership) return json({ error: 'Azienda non trovata o accesso negato.' }, 403);

  // Quota condivisa con gli altri percorsi AI, consumata ATOMICAMENTE (0009).
  const slot = await reserveAiSlot(sb, {
    companyId, kind: 'note', limitPerMinute: RATE_LIMIT_PER_MINUTE,
    documentId: null, provider: 'anthropic', model: NOTE_MODEL,
  });
  if (!slot.allowed) return json({ error: 'Troppe richieste. Attendi un istante.', code: 'RATE_LIMITED' }, 429);

  const started = Date.now();
  try {
    const anthropic = new Anthropic({ apiKey });
    const request = buildNoteRequest({ text, language });
    const msg = await anthropic.messages.create(request as never) as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string };
    if (msg.stop_reason === 'refusal') return json({ error: 'Struttura rifiutata dal modello.', code: 'PROVIDER_ERROR' }, 422);
    const content = msg.content.find((b) => b.type === 'text' && b.text)?.text?.trim();
    if (!content) return json({ error: 'Nota non strutturata.', code: 'AI_INVALID_OUTPUT' }, 502);

    // Il JSON si estrae col parser condiviso e si VALIDA col contratto: una
    // risposta ben formata ma senza i due campi è un guasto del modello, non
    // qualcosa da riparare qui.
    const note = validateStructuredNote(parseModelJson(content));
    if (!note) return json({ error: 'La risposta del modello non rispetta il formato atteso.', code: 'AI_INVALID_OUTPUT' }, 502);

    const done = await finalizeAiRequest(sb, slot.logId, {
      status: 'ok', durationMs: Date.now() - started,
      inputTokens: msg.usage?.input_tokens ?? null, outputTokens: msg.usage?.output_tokens ?? null,
    }, 'utente');
    if (!done) await logAiRequest(sb, {
      companyId, userId, documentId: null, kind: 'note', provider: 'anthropic', model: NOTE_MODEL,
      status: 'ok', durationMs: Date.now() - started, inputTokens: msg.usage?.input_tokens ?? null, outputTokens: msg.usage?.output_tokens ?? null,
    });
    return json({ subject: note.subject, notes: note.notes });
  } catch (e) {
    const done = await finalizeAiRequest(sb, slot.logId, { status: 'error', errorCode: 'PROVIDER_ERROR' }, 'utente');
    if (!done) await logAiRequest(sb, { companyId, userId, documentId: null, kind: 'note', provider: 'anthropic', model: NOTE_MODEL, status: 'error', errorCode: 'PROVIDER_ERROR' });
    console.error('structure-note error:', (e as Error)?.name);
    return json({ error: 'Struttura della nota non riuscita. Riprova.', code: 'PROVIDER_ERROR' }, 502);
  }
});
