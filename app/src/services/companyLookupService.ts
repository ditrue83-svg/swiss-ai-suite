// ============================================================================
// companyLookupService — ricerca azienda nel Registro IDI (Zefix) per l'onboarding.
// Invoca la Edge Function `lookup-company` (proxy server-side di Zefix): il testo
// digitato (nome o numero IDI/CHE) → candidati normalizzati per pre-compilare i
// dati. NON persiste. Se la ricerca non è configurata (secret Zefix mancante) la
// funzione risponde 503 e qui si segnala con `notConfigured` (onboarding resta manuale).
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';

export interface CompanyCandidate {
  uid: string | null;
  name: string | null;
  canton: string | null;        // già mappato alle etichette dell'app (CANTONI)
  municipality: string | null;
  status: string | null;
  legalFormId: number | null;
}

interface LookupResponse { companies?: CompanyCandidate[]; error?: string; code?: string }

/** Errore che porta il `code` della Edge Function (per distinguere "non configurata"). */
export class LookupError extends AppError {
  code: string | null;
  constructor(message: string, code: string | null, cause?: unknown) {
    super(message, cause);
    this.name = 'LookupError';
    this.code = code;
  }
}

async function readError(error: unknown): Promise<{ message: string; code: string | null }> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).json()) as LookupResponse;
      if (body?.error) return { message: body.error, code: body.code ?? null };
    } catch { /* corpo non JSON */ }
  }
  return { message: 'Ricerca nel Registro IDI non disponibile.', code: null };
}

export const companyLookupService = {
  /** Cerca aziende per nome o numero IDI/CHE. Ritorna i candidati (max ~15). */
  async search(query: string): Promise<CompanyCandidate[]> {
    const { data, error } = await requireSupabase()
      .functions.invoke<LookupResponse>('lookup-company', { body: { query } });
    if (error) {
      const { message, code } = await readError(error);
      throw new LookupError(message, code, error);
    }
    if (data?.error) throw new LookupError(data.error, data.code ?? null);
    return data?.companies ?? [];
  },
};
