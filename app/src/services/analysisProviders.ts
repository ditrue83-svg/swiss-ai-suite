// ============================================================================
// Percorso AI reale — invocazione della Edge Function `analyze-document`.
// La funzione ESTRAE (o fa OCR), ANALIZZA e PERSISTE server-side (§49): qui non
// si mappa né si persiste nulla, l'analisi si rilegge poi dal DB (fonte di verità).
// Il motore locale ESPLICITO (§60) vive in analysisService, non qui.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';
import type { ClientExtraction } from '@/features/admin-ai/pdf';

export const DETERMINISTIC_ENGINE = 'deterministic-v2';

interface AnalyzeResponse { status?: string; analysis?: unknown; documentId?: string; error?: string; code?: string }

async function readFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).json()) as AnalyzeResponse;
      if (body?.error) return body.error;
    } catch { /* corpo non JSON */ }
  }
  const msg = (error as { message?: string })?.message;
  return msg ? `Analisi AI non disponibile (${msg}).` : 'Analisi AI non disponibile.';
}

/**
 * Invoca `analyze-document`. `extraction === null` → il server scarica il file e
 * fa l'OCR (§4). Il contenuto va sempre riletto dal DB (fonte di verità) con
 * analysisService.getForDocument.
 *
 * Con `async: true` (§26) il server valida e autorizza in modo sincrono — quindi
 * 401/403/422/429 arrivano subito — poi prosegue in background e risponde
 * `status: 'processing'`: lo stato reale va osservato sul DB.
 */
export async function invokeAnalyze(
  documentId: string,
  extraction: ClientExtraction | null,
  options: { async?: boolean } = {},
): Promise<{ status: string }> {
  const body: Record<string, unknown> = extraction
    ? { documentId, extraction: { fullText: extraction.fullText, pages: extraction.pages, extractionMethod: extraction.extractionMethod } }
    : { documentId };
  if (options.async) body.async = true;

  const { data, error } = await requireSupabase().functions.invoke<AnalyzeResponse>('analyze-document', { body });
  if (error) throw new AppError(await readFunctionError(error), error);
  if (data?.status === 'processing') return { status: 'processing' };
  if (!data?.analysis) throw new AppError(data?.error ?? 'Risposta del servizio AI non valida.');
  return { status: data.status ?? 'completed' };
}
