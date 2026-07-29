// ============================================================================
// La logica PURA dei Contratti: stati, derivazioni, filtri, confronto.
//
// Sta qui e non nei componenti perché ciò che si può sbagliare in silenzio —
// dire «scade fra 12 giorni» su una data che nessuno ha verificato, mostrare un
// preavviso senza dire che non se ne ricava una scadenza — deve poter essere
// provato offline, senza rete e senza database.
//
// ⚠️ NESSUNA FUNZIONE DI QUESTO FILE CALCOLA UNA DATA CONTRATTUALE. Le date le
// deriva il database (`contract_notice_deadline`, 0024) e arrivano già fatte:
// qui si decide solo come MOSTRARLE e se dichiarare che non esistono.
// ============================================================================
import type {
  ContractDetail, ContractListItem, ContractMilestone, ContractTermVersion,
} from '@/types/models';
import {
  COMPARED_TERM_FIELDS, type ComparedTermField,
} from '../../../supabase/functions/_shared/contracts/contract.ts';
import {
  noticeBlockReason, type NoticeBlockReason,
} from '../../../supabase/functions/_shared/contracts/periods.ts';

export { COMPARED_TERM_FIELDS };
export type { ComparedTermField, NoticeBlockReason };

export const CONTRACT_PAGE_SIZE = 25;
export const MAX_QUERY_LENGTH = 120;

/** §66 — la finestra delle viste «prossimi». Novanta giorni. */
export const DEFAULT_WINDOW_DAYS = 90;

/**
 * Lo stato che la riga mostra. Uno solo, il più importante: una riga con quattro
 * pastiglie non si legge.
 *
 * ⚠️ L'ORDINE È LA PRIORITÀ, e non è arbitrario: prima ciò che richiede una
 * decisione con una scadenza (un preavviso che si avvicina), poi ciò che
 * richiede una decisione senza scadenza (una modifica da verificare), poi lo
 * stato normale.
 */
export type ContractState =
  | 'archived' | 'failed' | 'processing' | 'notice_soon' | 'renewal_soon'
  | 'amendment' | 'to_verify' | 'verified';

export function contractState(
  c: Pick<ContractListItem, 'archivedAt' | 'reviewStatus' | 'processingPendingCount'
    | 'processingFailedCount' | 'nextNoticeDate' | 'nextRenewalDate'>,
  today: Date = new Date(),
): ContractState {
  if (c.archivedAt) return 'archived';
  if (c.processingFailedCount > 0) return 'failed';
  if (c.processingPendingCount > 0) return 'processing';
  const noticeDays = daysUntil(c.nextNoticeDate, today);
  if (noticeDays !== null && noticeDays <= 30) return 'notice_soon';
  const renewalDays = daysUntil(c.nextRenewalDate, today);
  if (renewalDays !== null && renewalDays <= 30) return 'renewal_soon';
  if (c.reviewStatus === 'review_required_again') return 'amendment';
  if (c.reviewStatus === 'needs_review') return 'to_verify';
  return 'verified';
}

/**
 * Giorni di CALENDARIO fino a una data, non millisecondi diviso 86400.
 * ⚠️ È la lezione delle Attività: alle 23:30 «domani» non deve diventare «oggi».
 */
export function daysUntil(iso: string | null | undefined, today: Date = new Date()): number | null {
  if (!iso) return null;
  const target = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Perché una scadenza di disdetta non si può ricavare — oppure `null` se si può.
 *
 * ⚠️ SI CHIEDE ALLA STESSA FUNZIONE CHE USA IL SERVER (`periods.ts`), non a una
 * copia scritta per l'interfaccia: due risposte diverse alla stessa domanda
 * produrrebbero una schermata che promette una data che nessuno calcolerà.
 */
export function noticeUnavailableReason(
  terms: Pick<ContractTermVersion,
    'noticePeriodValue' | 'noticePeriodUnit' | 'noticeAnchor' | 'endDate' | 'endDateKind'> | null,
): NoticeBlockReason | null {
  if (!terms) return 'no_notice_period';
  return noticeBlockReason({
    noticeValue: terms.noticePeriodValue,
    noticeUnit: terms.noticePeriodUnit,
    anchor: terms.noticeAnchor,
    hasExplicitEndDate: terms.endDateKind === 'explicit' && !!terms.endDate,
  });
}

/**
 * Una data si può trasformare in lavoro?
 * ⚠️ §87 — SOLO se verificata. Una proposta del sistema non genera attività, e
 * l'interfaccia non deve nemmeno offrirlo: un pulsante che porta a un rifiuto è
 * un difetto, non una protezione.
 */
export function canCreateTask(m: Pick<ContractMilestone, 'status' | 'taskCount'>): boolean {
  return m.status === 'verified' && m.taskCount === 0;
}

/** Le date ancora in gioco, in ordine. Scartate e superate restano fuori. */
export function openMilestones(all: readonly ContractMilestone[]): ContractMilestone[] {
  return all
    .filter((m) => m.status === 'candidate' || m.status === 'verified')
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// ---------------------------------------------------------------------------
// Il confronto fra due versioni dei termini (§27)
// ---------------------------------------------------------------------------

export interface TermChange {
  field: ComparedTermField;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

/**
 * Che cosa cambierebbe passando dai termini in vigore alla bozza.
 *
 * ⚠️ SOLO I CAMPI CHE CONTANO (§27), e solo quelli DIVERSI. Un confronto che
 * elencasse venti righe uguali seppellirebbe le due che sono cambiate — ed è
 * proprio su quelle due che una persona deve decidere.
 *
 * ⚠️ `null → null` non è un cambiamento, e nemmeno `undefined → null`: un campo
 * che nessuno dei due documenti nomina non è una modifica.
 */
export function compareTerms(
  before: ContractTermVersion | null,
  after: ContractTermVersion | null,
): TermChange[] {
  if (!before || !after) return [];
  const out: TermChange[] = [];
  for (const field of COMPARED_TERM_FIELDS) {
    const a = (before as unknown as Record<string, unknown>)[toCamel(field)] ?? null;
    const b = (after as unknown as Record<string, unknown>)[toCamel(field)] ?? null;
    if (a === b) continue;
    // Gli importi arrivano come numeri e possono differire solo nel tipo.
    if (typeof a === 'number' && typeof b === 'number' && a === b) continue;
    out.push({
      field,
      before: a as TermChange['before'],
      after: b as TermChange['after'],
    });
  }
  return out;
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** C'è una modifica in attesa di essere guardata? */
export function hasPendingChanges(detail: Pick<ContractDetail, 'terms' | 'draft'>): boolean {
  return !!detail.draft && compareTerms(detail.terms, detail.draft).length > 0;
}

// ---------------------------------------------------------------------------
// Filtri e URL
// ---------------------------------------------------------------------------

import type { ContractFilters, ContractSort, ContractView } from '@/types/models';

export const VIEWS: ContractView[] =
  ['all', 'needs_review', 'active', 'renewals', 'notices', 'archived'];
export const SORTS: ContractSort[] = ['default', 'renewal', 'notice', 'name', 'recent'];

export function hasActiveFilters(f: ContractFilters): boolean {
  return !!(f.query?.trim() || f.type || f.lifecycle || f.review || f.owner
    || f.autoRenewal || f.withoutOwner);
}

export function filtersFromParams(params: URLSearchParams): ContractFilters {
  const view = params.get('vista');
  const sort = params.get('ordina');
  return {
    view: VIEWS.includes(view as ContractView) ? (view as ContractView) : 'all',
    query: params.get('q')?.slice(0, MAX_QUERY_LENGTH) || null,
    type: (params.get('tipo') as ContractFilters['type']) || null,
    lifecycle: (params.get('stato') as ContractFilters['lifecycle']) || null,
    review: (params.get('verifica') as ContractFilters['review']) || null,
    owner: params.get('responsabile') || null,
    autoRenewal: (params.get('rinnovo') as ContractFilters['autoRenewal']) || null,
    withoutOwner: params.get('senzaResponsabile') === '1',
    sort: SORTS.includes(sort as ContractSort) ? (sort as ContractSort) : 'default',
    offset: Number(params.get('da') ?? 0) || 0,
  };
}

export function paramsFromFilters(f: ContractFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.view && f.view !== 'all') p.set('vista', f.view);
  if (f.query?.trim()) p.set('q', f.query.trim());
  if (f.type) p.set('tipo', f.type);
  if (f.lifecycle) p.set('stato', f.lifecycle);
  if (f.review) p.set('verifica', f.review);
  if (f.owner) p.set('responsabile', f.owner);
  if (f.autoRenewal) p.set('rinnovo', f.autoRenewal);
  if (f.withoutOwner) p.set('senzaResponsabile', '1');
  if (f.sort && f.sort !== 'default') p.set('ordina', f.sort);
  if (f.offset) p.set('da', String(f.offset));
  return p;
}
