// ============================================================================
// Provider di analisi — l'unico punto che sa DA DOVE arriva un'analisi.
// La UI e il resto del service layer vedono sempre e solo un EngineAnalysis.
//
//   ai            → Edge Function `analyze-document` (Claude, server-side)
//   deterministic → motore locale (nessun dato lascia Supabase)
//   auto          → prova l'AI, ricade sul motore locale se non disponibile
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { ANALYSIS_PROVIDER } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { analyzeText, type EngineAnalysis } from '@/features/admin-ai/engine';
import { aiPayloadToEngineAnalysis, type AiAnalysisPayload } from '@/features/admin-ai/aiMapping';

export const DETERMINISTIC_ENGINE = 'deterministic-v2';

export interface ProviderResult {
  engine: string;
  analysis: EngineAnalysis;
  /** true se l'AI era richiesta ma non disponibile e si è usato il motore locale. */
  usedFallback: boolean;
}

interface AiResponse {
  analysis?: AiAnalysisPayload;
  engine?: string;
  error?: string;
  code?: string;
}

async function readFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).json()) as AiResponse;
      if (body?.error) return body.error;
    } catch { /* corpo non JSON */ }
  }
  const msg = (error as { message?: string })?.message;
  return msg ? `Analisi AI non disponibile (${msg}).` : 'Analisi AI non disponibile.';
}

async function callAi(documentId: string, text: string): Promise<{ engine: string; payload: AiAnalysisPayload }> {
  const { data, error } = await requireSupabase().functions.invoke<AiResponse>('analyze-document', {
    body: { documentId, text },
  });
  if (error) throw new AppError(await readFunctionError(error), error);
  if (!data?.analysis) throw new AppError(data?.error ?? 'Risposta del servizio AI non valida.');
  return { engine: data.engine ?? 'claude', payload: data.analysis };
}

export async function runAnalysisProvider(input: {
  documentId: string;
  text: string;
  companyName: string | null;
}): Promise<ProviderResult> {
  const { documentId, text, companyName } = input;

  const deterministic = (usedFallback: boolean): ProviderResult => ({
    engine: DETERMINISTIC_ENGINE,
    analysis: analyzeText(text, { companyName }),
    usedFallback,
  });

  if (ANALYSIS_PROVIDER === 'deterministic') return deterministic(false);

  try {
    const { engine, payload } = await callAi(documentId, text);
    return { engine, analysis: aiPayloadToEngineAnalysis(payload, text), usedFallback: false };
  } catch (err) {
    // In modalità 'ai' l'errore è definitivo: non fingiamo un'analisi AI.
    if (ANALYSIS_PROVIDER === 'ai') throw err;
    return deterministic(true);
  }
}
