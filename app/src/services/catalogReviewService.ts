// ============================================================================
// La revisione del catalogo incentivi — accesso ai dati.
//
// ⚠️ TRE RPC E NESSUNA TABELLA. `subsidy_catalog_reviews` e
// `subsidy_catalog_editors` hanno `revoke all` e nessuna policy (0032, 0037):
// dal client non si leggono e non si scrivono. Si passa solo di qui, e il
// cancello — l'appartenenza a `subsidy_catalog_editors` — è dentro le funzioni,
// che sono `security definer`.
//
// ⚠️ NESSUN `p_company_id`, e non è una dimenticanza: il catalogo è GLOBALE.
// Legarlo a un'azienda avrebbe significato che il cliente di un tenant decide
// che cosa il prodotto racconta a tutti gli altri.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { toUserMessage } from '@/lib/errors';
import type { Decision } from '@/features/incentives/reviewModel';

function fail(error: unknown): never {
  throw new Error(toUserMessage(error));
}

/** Il codice che il database usa per «non sei un operatore del catalogo». */
export const NOT_EDITOR = 'NOT_CATALOG_EDITOR';

export interface CatalogReview {
  id: string;
  programId: string | null;
  programName: string | null;
  programAuthority: string | null;
  lastCheckedAt: string | null;
  dataStatus: string | null;
  changeType: string;
  riskLevel: string;
  status: string;
  previousValues: Record<string, unknown> | null;
  proposedValues: Record<string, unknown> | null;
  sourceUrl: string | null;
  createdAt: string;
  reviewedAt: string | null;
  notes: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : null;

function toReview(r: Record<string, unknown>): CatalogReview {
  return {
    id: String(r.id),
    programId: str(r.program_id),
    programName: str(r.program_name),
    programAuthority: str(r.program_authority),
    lastCheckedAt: str(r.last_checked_at),
    dataStatus: str(r.data_status),
    changeType: String(r.change_type ?? ''),
    riskLevel: String(r.risk_level ?? ''),
    status: String(r.status ?? ''),
    previousValues: obj(r.previous_values),
    proposedValues: obj(r.proposed_values),
    sourceUrl: str(r.source_url),
    createdAt: String(r.created_at ?? ''),
    reviewedAt: str(r.reviewed_at),
    notes: str(r.notes),
  };
}

/**
 * ⚠️ `isEditor` NON viene dedotto da un fallimento di `list`. Sono due domande
 * diverse — «posso guardare?» e «che cosa c'è?» — e dedurre la prima
 * dall'errore della seconda significherebbe scambiare una rete caduta per un
 * permesso negato.
 */
export const catalogReviewService = {
  async isEditor(): Promise<boolean> {
    const { data, error } = await requireSupabase().rpc('subsidy_is_catalog_editor', {});
    if (error) fail(error);
    return data === true;
  },

  async list(includeResolved = false): Promise<CatalogReview[]> {
    const { data, error } = await requireSupabase().rpc('list_subsidy_catalog_reviews', {
      p_include_resolved: includeResolved,
      p_limit: 100,
    });
    if (error) fail(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toReview);
  },

  /**
   * Chiude una revisione. Torna la data di ultima verifica del programma DOPO
   * la decisione, così la schermata mostra il risultato invece di supporlo.
   *
   * ⚠️ Il database rifiuta una seconda decisione sulla stessa scheda
   * (`REVIEW_ALREADY_RESOLVED`): due persone sulla stessa coda devono
   * accorgersi di essersi pestate i piedi, non sovrascriversi.
   */
  async resolve(id: string, decision: Decision, note: string): Promise<{ lastCheckedAt: string | null }> {
    const { data, error } = await requireSupabase().rpc('resolve_subsidy_catalog_review', {
      p_id: id,
      p_decision: decision,
      p_note: note.trim() === '' ? null : note.trim(),
    });
    if (error) fail(error);
    const row = ((data ?? []) as unknown as Record<string, unknown>[])[0];
    return { lastCheckedAt: row ? str(row.last_checked_at) : null };
  },
};
