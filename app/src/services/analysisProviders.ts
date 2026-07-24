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

interface AnalyzeResponse { status?: string; analysis?: unknown; error?: string; code?: string }

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
 * fa l'OCR (§4). Ritorna lo stato di analisi ('completed' | 'needs_review');
 * il contenuto va riletto dal DB con analysisService.getForDocument.
 */
export async function invokeAnalyze(
  documentId: string,
  extraction: ClientExtraction | null,
): Promise<{ status: string }> {
  const body = extraction
    ? { documentId, extraction: { fullText: extraction.fullText, pages: extraction.pages, extractionMethod: extraction.extractionMethod } }
    : { documentId };
  const { data, error } = await requireSupabase().functions.invoke<AnalyzeResponse>('analyze-document', { body });
  if (error) throw new AppError(await readFunctionError(error), error);
  if (!data?.analysis) throw new AppError(data?.error ?? 'Risposta del servizio AI non valida.');
  return { status: data.status ?? 'completed' };
}
