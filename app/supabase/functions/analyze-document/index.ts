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
import { logAiRequest, reserveAiSlot, finalizeAiRequest } from '../_shared/persist.ts';
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

  // §50 — quota per azienda, verificata e consumata ATOMICAMENTE (0009): due
  // richieste concorrenti non possono più leggere lo stesso conteggio e passare
  // entrambe. La riga prenotata viene completata a fine lavoro.
  const slot = await reserveAiSlot(sb, {
    companyId, kind: 'analysis', limitPerMinute: RATE_LIMIT_PER_MINUTE,
    documentId, provider: 'anthropic', model: 'claude-opus-4-8',
  });
  if (!slot.allowed) return fail('RATE_LIMITED', 429);

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

  // ---- Validazione dell'input di estrazione (SEMPRE sincrona) --------------
  // Ciò che si può respingere subito viene respinto subito, anche in modalità
  // asincrona: il client non deve scoprire un 422 tramite polling.
  const inExtraction = body?.extraction;
  const hasClientExtraction = inExtraction && typeof inExtraction.fullText === 'string' && Array.isArray(inExtraction.pages);
  let clientExtraction: ExtractionResult | null = null;
  let truncated = false;   // §28 — il testo inviato al modello è stato tagliato?

  if (hasClientExtraction) {
    const original: string = inExtraction.fullText;
    const fullText: string = original.slice(0, MAX_CHARS);
    if (fullText.trim().length < 40) return fail('EMPTY_DOCUMENT', 422);
    // §28 — oltre il limite il modello vede solo l'inizio del documento: il
    // troncamento va DICHIARATO, altrimenti un'analisi parziale sembra completa
    // (una scadenza nell'ultima pagina sparirebbe senza lasciare traccia).
    truncated = original.length > MAX_CHARS;
    clientExtraction = {
      fullText,
      extractionMethod: inExtraction.extractionMethod === 'native_pdf' ? 'native_pdf' : 'text',
      // Le pagine seguono il testo troncato: si tengono finché rientrano nel
      // limite complessivo, così viewer e citazioni restano coerenti fra loro.
      pages: (() => {
        const out: { pageNumber: number; text: string }[] = [];
        let budget = MAX_CHARS;
        inExtraction.pages.forEach((p: { pageNumber?: number; text?: string }, i: number) => {
          if (budget <= 0) return;
          const t = String(p.text ?? '').slice(0, budget);
          budget -= t.length;
          out.push({ pageNumber: typeof p.pageNumber === 'number' ? p.pageNumber : i + 1, text: t });
        });
        if (out.length < inExtraction.pages.length) truncated = true;
        return out;
      })(),
    };
  } else {
    // Percorso OCR: quel che è verificabile senza lavoro AI lo si verifica ora.
    if (!doc.storage_path) return fail('EXTRACTION_FAILED', 422);
    if ((doc.file_size ?? 0) > MAX_FILE_BYTES) return fail('FILE_TOO_LARGE', 413);
  }

  /** Errore con fase e codice, per distinguere estrazione da analisi. */
  const phased = (code: ErrorCode, phase: 'extraction' | 'analysis') =>
    Object.assign(new Error(code), { code, phase });

  /** Il lavoro vero: estrazione (o OCR) + analisi + persistenza. */
  async function performWork() {
    const extractStart = Date.now();
    let extraction: ExtractionResult;
    try {
      extraction = clientExtraction ?? await ocrExtract(sb, anthropic, doc!.storage_path as string, doc!.mime_type as string | null);
      if (!extraction || extraction.fullText.trim().length < 20) throw phased('OCR_FAILED', 'extraction');
    } catch (e) {
      const code = ((e as { code?: ErrorCode }).code) ?? 'EXTRACTION_FAILED';
      const done = await finalizeAiRequest(sb, slot.logId, { status: 'error', errorCode: code });
      if (!done) await logAiRequest(sb, { companyId, userId, documentId, kind: 'extraction', provider: 'anthropic', model: null, status: 'error', errorCode: code });
      console.error('extraction error:', (e as Error)?.name);
      throw phased(code, 'extraction');
    }
    try {
      return await runAnalysisPipeline(sb, createMessage, {
        documentId, companyId, userId,
        extraction, extractionDurationMs: Date.now() - extractStart, truncated, logId: slot.logId,
        companyContext, todayIso: new Date().toISOString().slice(0, 10), provider: 'anthropic',
      });
    } catch (e) {
      const err = e as Error & { code?: string; status?: number };
      const code: ErrorCode = (err.code as ErrorCode) ?? (err.status === 429 ? 'RATE_LIMITED' : err.name === 'AbortError' ? 'AI_TIMEOUT' : 'PROVIDER_ERROR');
      console.error('analysis error:', err.name, err.message?.slice(0, 120));
      throw phased(code, 'analysis');
    }
  }

  /**
   * §27/§53 — documento e file restano; il fallimento è tracciabile e ri-tentabile.
   * IMPORTANTE: un tentativo fallito NON deve distruggere un'analisi valida
   * precedente. Si rimuovono solo gli esiti falliti già registrati (per non
   * accumularli) e si aggiunge il nuovo fallimento.
   */
  async function markFailed(code: ErrorCode) {
    await sb.from('documents').update({ status: 'failed' }).eq('id', documentId);
    await sb.from('document_analyses').delete().eq('document_id', documentId).eq('analysis_status', 'failed');
    await sb.from('document_analyses').insert({
      document_id: documentId, company_id: companyId, analysis_status: 'failed',
      provider: 'anthropic', error_code: code, error_message_safe: ERROR_MESSAGES[code],
      processing_completed_at: new Date().toISOString(), engine: 'claude-opus-4-8',
    }).select('id').maybeSingle();
    const done = await finalizeAiRequest(sb, slot.logId, { status: 'error', errorCode: code });
    if (!done) await logAiRequest(sb, { companyId, userId, documentId, kind: 'analysis', provider: 'anthropic', model: 'claude-opus-4-8', status: 'error', errorCode: code });
  }

  const httpStatusFor = (code: ErrorCode) =>
    code === 'RATE_LIMITED' ? 429 : code === 'AI_NOT_CONFIGURED' ? 503
      : code === 'FILE_TOO_LARGE' ? 413
        : code === 'EXTRACTION_FAILED' || code === 'OCR_FAILED' || code === 'EMPTY_DOCUMENT' ? 422 : 502;

  // ---- §26 · modalità ASINCRONA (opt-in) -----------------------------------
  // La risposta torna subito; il lavoro prosegue in background sul server e lo
  // stato viaggia nel DB (documents.status + document_analyses.analysis_status),
  // che il client osserva. Nessun finto background: se il runtime non offre
  // waitUntil si resta sul percorso sincrono.
  const waitUntil = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil;

  if (body?.async === true && typeof waitUntil === 'function') {
    await sb.from('documents').update({ status: clientExtraction ? 'analyzing' : 'extracting' }).eq('id', documentId);
    waitUntil((async () => {
      try { await performWork(); }
      catch (e) { await markFailed(((e as { code?: ErrorCode }).code) ?? 'UNKNOWN_ERROR'); }
    })());
    return json({ status: 'processing', documentId }, 202);
  }

  // ---- Modalità SINCRONA (comportamento storico, invariato) ----------------
  try {
    const result = await performWork();
    return json({ status: result.status, analysis: result.analysis });
  } catch (e) {
    const code = ((e as { code?: ErrorCode }).code) ?? 'UNKNOWN_ERROR';
    const phase = (e as { phase?: string }).phase;
    if (phase === 'analysis') await markFailed(code);
    return fail(code, httpStatusFor(code));
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

  // §28 — il limite si applica alla dimensione REALE dell'oggetto scaricato:
  // `documents.file_size` è scritto dal browser e non è una fonte attendibile.
  if (blob.size > MAX_FILE_BYTES) {
    const err = new Error('file troppo grande') as Error & { code?: string };
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Conversione a blocchi: concatenare carattere per carattere su file da MB
  // saturava la memoria dell'isolate.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
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
