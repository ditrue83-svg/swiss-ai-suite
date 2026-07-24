// ============================================================================
// Edge Function: analyze-document (Fase 2, pipeline reale)
//
// Wrapper HTTP sottile attorno alla pipeline condivisa (_shared). Server-side:
// la chiave Anthropic è un secret e non tocca mai il browser.
//
// Sicurezza:
//  - richiede un JWT valido;
//  - autorizza VERIFICANDO la membership: legge il documento con il client
//    autenticato COME l'utente (RLS). Non membro → 403 (§49);
//  - rate limit per azienda (§50);
//  - il contenuto del documento è DATO, non istruzioni (§21, nel prompt).
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runAnalysisPipeline, type CreateMessage, type ModelMessage } from '../_shared/pipeline.ts';
import { ERROR_MESSAGES, type ErrorCode, type ExtractionResult } from '../_shared/validate.ts';
import { logAiRequest } from '../_shared/persist.ts';
import type { CompanyContext } from '../_shared/prompt.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (code: ErrorCode, status: number) => json({ error: ERROR_MESSAGES[code], code }, status);

const RATE_LIMIT_PER_MINUTE = 12;   // §50
const MAX_CHARS = 120_000;          // §28 limite testo
const MAX_FILE_BYTES = 15 * 1024 * 1024; // §28 limite file per OCR

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('PROVIDER_ERROR', 401);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Sessione non valida.', code: 'PROVIDER_ERROR' }, 401);
  const userId = userData.user.id;

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return fail('AI_NOT_CONFIGURED', 503);

  const body = await req.json().catch(() => null);
  const documentId = body?.documentId;
  if (typeof documentId !== 'string') return json({ error: 'Richiesta non valida.', code: 'UNKNOWN_ERROR' }, 400);

  // §49 — autorizzazione via RLS: se non membro, la select non torna nulla → 403.
  const { data: doc, error: docErr } = await sb.from('documents')
    .select('id, company_id, storage_path, mime_type, file_size').eq('id', documentId).maybeSingle();
  if (docErr) return fail('UNKNOWN_ERROR', 500);
  if (!doc) return json({ error: 'Documento non trovato o accesso negato.', code: 'PROVIDER_ERROR' }, 403);
  const companyId = doc.company_id as string;

  // §50 — rate limit per azienda.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await sb.from('ai_request_log')
    .select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', since);
  if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) return fail('RATE_LIMITED', 429);

  // §22 — contesto aziendale minimo.
  const { data: company } = await sb.from('companies')
    .select('legal_name, canton, municipality, legal_form').eq('id', companyId).maybeSingle();
  const { data: cprofile } = await sb.from('company_profiles').select('sector').eq('company_id', companyId).maybeSingle();
  const companyContext: CompanyContext = {
    legalName: company?.legal_name ?? null, canton: company?.canton ?? null,
    municipality: company?.municipality ?? null, legalForm: company?.legal_form ?? null,
    sector: cprofile?.sector ?? null,
  };

  const anthropic = new Anthropic({ apiKey });
  const createMessage: CreateMessage = (r) => anthropic.messages.create(r as never) as Promise<ModelMessage>;

  // ---- Estrazione: dal client (testo/PDF nativo) oppure OCR server-side ----
  const extractStart = Date.now();
  let extraction: ExtractionResult | null = null;
  try {
    const inExtraction = body?.extraction;
    if (inExtraction && typeof inExtraction.fullText === 'string' && Array.isArray(inExtraction.pages)) {
      const fullText: string = inExtraction.fullText.slice(0, MAX_CHARS);
      if (fullText.trim().length < 40) return fail('EMPTY_DOCUMENT', 422);
      extraction = {
        fullText,
        extractionMethod: inExtraction.extractionMethod === 'native_pdf' ? 'native_pdf' : 'text',
        pages: inExtraction.pages.map((p: { pageNumber?: number; text?: string }, i: number) => ({
          pageNumber: typeof p.pageNumber === 'number' ? p.pageNumber : i + 1,
          text: String(p.text ?? '').slice(0, MAX_CHARS),
        })),
      };
    } else {
      // OCR: scarica il file (autorizzato come l'utente) e usa Claude vision.
      if (!doc.storage_path) return fail('EXTRACTION_FAILED', 422);
      if ((doc.file_size ?? 0) > MAX_FILE_BYTES) return fail('FILE_TOO_LARGE', 413);
      extraction = await ocrExtract(sb, anthropic, doc.storage_path as string, doc.mime_type as string | null);
      if (!extraction || extraction.fullText.trim().length < 20) return fail('OCR_FAILED', 422);
    }
  } catch (e) {
    await logAiRequest(sb, { companyId, userId, documentId, kind: 'extraction', provider: 'anthropic', model: null, status: 'error', errorCode: 'EXTRACTION_FAILED' });
    console.error('extraction error:', (e as Error)?.name);
    return fail('EXTRACTION_FAILED', 422);
  }

  // ---- Analisi + persistenza (pipeline condivisa) ----
  try {
    const result = await runAnalysisPipeline(sb, createMessage, {
      documentId, companyId, userId,
      extraction, extractionDurationMs: Date.now() - extractStart,
      companyContext, todayIso: new Date().toISOString().slice(0, 10), provider: 'anthropic',
    });
    return json({ status: result.status, analysis: result.analysis });
  } catch (e) {
    const err = e as Error & { code?: string; status?: number };
    const code: ErrorCode = (err.code as ErrorCode) ?? (err.status === 429 ? 'RATE_LIMITED' : err.name === 'AbortError' ? 'AI_TIMEOUT' : 'PROVIDER_ERROR');
    // §27/§53 — documento e file restano; segna il fallimento in modo tracciabile.
    await sb.from('documents').update({ status: 'failed' }).eq('id', documentId);
    await sb.from('document_analyses').delete().eq('document_id', documentId);
    await sb.from('document_analyses').insert({
      document_id: documentId, company_id: companyId, analysis_status: 'failed',
      provider: 'anthropic', error_code: code, error_message_safe: ERROR_MESSAGES[code],
      processing_completed_at: new Date().toISOString(), engine: 'claude-opus-4-8',
    }).select('id').maybeSingle();
    await logAiRequest(sb, { companyId, userId, documentId, kind: 'analysis', provider: 'anthropic', model: 'claude-opus-4-8', status: 'error', errorCode: code });
    console.error('analysis error:', err.name, err.message?.slice(0, 120));
    return fail(code, code === 'RATE_LIMITED' ? 429 : code === 'AI_NOT_CONFIGURED' ? 503 : 502);
  }
});

// ---- OCR via Claude vision (§4) --------------------------------------------
async function ocrExtract(
  sb: ReturnType<typeof createClient>,
  anthropic: Anthropic,
  storagePath: string,
  mimeType: string | null,
): Promise<ExtractionResult> {
  const { data: blob, error } = await sb.storage.from('company-documents').download(storagePath);
  if (error || !blob) throw new Error('download fallito');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const mt = mimeType ?? 'application/octet-stream';

  const isPdf = mt.includes('pdf');
  const source = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mt.startsWith('image/') ? mt : 'image/png', data: b64 } };

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    output_config: { effort: 'low' },
    system: 'Trascrivi FEDELMENTE tutto il testo del documento, senza correggere né riassumere. Restituisci solo un oggetto JSON {"pages":[{"pageNumber":1,"text":"…"}],"fullText":"…"} con il testo per pagina. Nessun testo attorno al JSON.',
    messages: [{ role: 'user', content: [source, { type: 'text', text: 'Trascrivi il testo di questo documento, pagina per pagina.' }] }],
  } as never) as ModelMessage;

  const block = msg.content.find((b) => b.type === 'text' && typeof b.text === 'string');
  const raw = block?.text ?? '';
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  const pages = (Array.isArray(parsed.pages) ? parsed.pages : []).map((p: { pageNumber?: number; text?: string }, i: number) => ({
    pageNumber: typeof p.pageNumber === 'number' ? p.pageNumber : i + 1,
    text: String(p.text ?? ''),
  }));
  const fullText = typeof parsed.fullText === 'string' && parsed.fullText.trim()
    ? parsed.fullText
    : pages.map((p: { text: string }) => p.text).join('\n\n');
  return { fullText, pages: pages.length ? pages : [{ pageNumber: 1, text: fullText }], extractionMethod: 'ocr' };
}
