// ============================================================================
// interpretService — interpretazione AI della descrizione progetto (Subsidy §S2).
// Invoca la Edge Function `interpret-project` (Claude server-side, chiave come
// secret): il testo libero diventa tipi di progetto normalizzati + spiegazione
// della pertinenza con evidence verificata. NON dichiara idoneità (resta
// deterministica a valle) e NON persiste: il risultato alimenta il matching e le
// spiegazioni lato client. Modellato su analysisProviders/replyService.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';
import type { ProjectInterpretation } from '@/types/models';
import { translate as tr } from '@/i18n';

interface InterpretResponse { interpretation?: ProjectInterpretation; error?: string; code?: string }

async function readFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).json()) as InterpretResponse;
      if (body?.error) return body.error;
    } catch { /* corpo non JSON */ }
  }
  const msg = (error as { message?: string })?.message;
  return msg ? `${tr('errors.interpretUnavailable')} (${msg})` : tr('errors.interpretUnavailable');
}

export const interpretService = {
  /**
   * Interpreta la descrizione libera del progetto per l'azienda indicata.
   * Ritorna l'interpretazione normalizzata (§20: evidence verificata lato server).
   */
  async interpret(companyId: string, description: string, outputLanguage?: string): Promise<ProjectInterpretation> {
    const { data, error } = await requireSupabase()
      .functions.invoke<InterpretResponse>('interpret-project', { body: { companyId, description, outputLanguage } });
    if (error) throw new AppError(await readFunctionError(error), error);
    if (!data?.interpretation) throw new AppError(data?.error ?? tr('errors.interpretUnavailable'));
    return data.interpretation;
  },
};
