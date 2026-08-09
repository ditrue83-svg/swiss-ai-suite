// ============================================================================
// auditService — lettura del Registro attività (0039).
//
// SOLO lettura, e non per disciplina: la tabella non ha alcun permesso di
// scrittura per il ruolo `authenticated`, e i tipi di `audit_logs` hanno
// `Insert`/`Update` vuoti apposta. Le righe le scrivono i trigger delle tabelle
// che possiedono il fatto, dentro la stessa transazione della scrittura che lo
// produce (vedi l'intestazione della migrazione).
//
// ⚠️ Il conteggio si chiede INSIEME alla pagina (`count: 'exact'`) e non si
// deduce dal numero di righe tornate: senza, la pagina direbbe «50 eventi»
// quando ce ne sono 900, cioè un troncamento silenzioso travestito da elenco
// completo — l'unica bugia che un registro non può permettersi.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import type { Database } from '@/types/database';
import type { AuditEntry } from '@/types/models';
import { AUDIT_PAGE_SIZE, periodStart, toChanges, type AuditFilters } from '@/features/audit/auditModel';

type Row = Database['public']['Tables']['audit_logs']['Row'];

function toEntry(row: Row): AuditEntry {
  return {
    id: row.id,
    companyId: row.company_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    changes: toChanges(row.changes),
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Quante righe soddisfano il filtro in tutto, non quante ne sono tornate. */
  total: number;
}

export const auditService = {
  /**
   * Una pagina di registro per l'azienda, dalla più recente.
   *
   * Chi non è titolare o amministratore riceve un elenco VUOTO, perché la
   * policy `audit_select_admin` non gli fa vedere niente — non un errore. Per
   * questo la schermata chiede prima il ruolo invece di dedurlo dal vuoto:
   * «non puoi guardare» e «non è successo niente» sono due frasi diverse.
   */
  async list(companyId: string, filters: AuditFilters, offset: number, now: Date = new Date()): Promise<AuditPage> {
    let query = requireSupabase()
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .eq('company_id', companyId);

    const since = periodStart(filters.period, now);
    if (since) query = query.gte('created_at', since);
    if (filters.action) query = query.eq('action', filters.action);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + AUDIT_PAGE_SIZE - 1);

    if (error) throw new AppError(toUserMessage(error), error);
    // ⚠️ `count` nullo non è zero: significa che il conteggio non è arrivato.
    // Dire «0 eventi» sarebbe inventare una risposta tranquillizzante a un
    // guasto; si solleva, e la schermata mostra un errore vero.
    // `tr()` DENTRO la funzione: a livello di modulo congelerebbe la lingua a
    // quella attiva al primo import.
    if (count === null || count === undefined) {
      throw new AppError(tr('audit.error.countMissing'));
    }
    return { entries: (data ?? []).map(toEntry), total: count };
  },
};
