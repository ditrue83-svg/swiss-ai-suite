// ============================================================================
// Documenti — il nucleo puro del Document Hub.
//
// Qui non si parla né con il database né con React: ci sono le regole che
// trasformano una riga in un elemento di dominio, i filtri in argomenti, i
// filtri nell'indirizzo e viceversa. Sono le uniche parti del Hub che si
// possono provare OFFLINE, e per questo ci stanno tutte
// (`npm run test:documents-unit`).
//
// Il resto — ricerca, isolamento fra aziende, conteggi — vive nel database e si
// prova contro il database vero (`npm run test:documents`): provarlo con un
// finto non direbbe niente, perché la cosa da dimostrare è proprio che le
// regole del database siano in vigore.
// ============================================================================
import type {
  DocumentCategory, DocumentHubFilters, DocumentHubItem, DocumentSort, DocumentSourceType,
  DocumentState, DocumentStatus, DocumentTag,
} from '@/types/models';
import type { AnalysisStatus } from '@/types/database';

/** Le categorie nell'ordine in cui compaiono nella barra laterale. */
export const CATEGORIES: DocumentCategory[] = [
  'administration', 'taxes', 'social_insurance', 'invoices', 'contracts',
  'insurance', 'banking', 'employees', 'clients', 'suppliers', 'subsidies', 'other',
];

export const SORTS: DocumentSort[] = ['recent', 'oldest', 'document_date', 'title', 'deadline'];
export const STATES: DocumentState[] = ['to_verify', 'analyzed', 'processing', 'failed', 'none'];
export const SOURCES: DocumentSourceType[] = ['upload', 'email', 'pasted_text'];

export const DOCUMENTS_PAGE_SIZE = 25;
/** §77 — una ricerca è una manciata di parole. Oltre, si taglia invece di rifiutare. */
export const MAX_QUERY_LENGTH = 120;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_DOCUMENT = 20;

const PROCESSING_STATUSES: DocumentStatus[] = ['extracting', 'analyzing', 'processing'];

/**
 * Lo stato che una persona legge.
 *
 * ⚠️ Un documento la cui analisi è FALLITA non è «analizzato»: non ha mittente,
 * non ha tipo, non ha scadenza, e mostrarlo come gli altri significherebbe
 * spacciare l'assenza di dati per un risultato. Allo stesso modo «non ancora
 * analizzato» e «in elaborazione» sono cose diverse: nel primo caso c'è
 * qualcosa da fare, nel secondo bisogna solo aspettare.
 */
export function stateOf(analysisStatus: AnalysisStatus | null, status: DocumentStatus): DocumentState {
  if (analysisStatus === 'failed') return 'failed';
  if (analysisStatus === 'needs_review') return 'to_verify';
  if (analysisStatus === 'completed') return 'analyzed';
  if (PROCESSING_STATUSES.includes(status)) return 'processing';
  if (analysisStatus === 'pending') return 'processing';
  return 'none';
}

/**
 * Un documento che richiede attenzione: la Home mostra SOLO questi (§61).
 * Una fattura archiviata correttamente non è un problema e non deve occupare
 * la schermata che risponde a «cosa devo guardare adesso».
 */
export function needsAttention(item: DocumentHubItem): boolean {
  return item.state === 'failed' || item.state === 'to_verify';
}

/** Un'etichetta ripulita. Stessa regola in creazione e in confronto. */
export function normalizeTagName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
}

/** Due etichette sono la stessa se differiscono solo per maiuscole o spazi. */
export function sameTagName(a: string, b: string): boolean {
  return normalizeTagName(a).toLocaleLowerCase() === normalizeTagName(b).toLocaleLowerCase();
}

export function findExistingTag(tags: DocumentTag[], name: string): DocumentTag | undefined {
  return tags.find((t) => sameTagName(t.name, name));
}

/**
 * L'estratto di ricerca arriva con i punti trovati fra `[[` e `]]`.
 *
 * Si spezza in segmenti e la schermata costruisce ELEMENTI: nessun HTML
 * proveniente da un documento viene mai interpretato. È la stessa scelta fatta
 * per il corpo delle email — non esiste il bug «mi sono dimenticato di
 * sanificare» se non esiste niente da sanificare.
 */
export interface SnippetPart { text: string; hit: boolean }

export function splitSnippet(snippet: string | null | undefined): SnippetPart[] {
  if (!snippet) return [];
  const parts: SnippetPart[] = [];
  let rest = snippet;
  for (;;) {
    const start = rest.indexOf('[[');
    if (start < 0) break;
    const end = rest.indexOf(']]', start + 2);
    if (end < 0) break;
    if (start > 0) parts.push({ text: rest.slice(0, start), hit: false });
    parts.push({ text: rest.slice(start + 2, end), hit: true });
    rest = rest.slice(end + 2);
  }
  if (rest) parts.push({ text: rest, hit: false });
  return parts.filter((p) => p.text.length > 0);
}

/** Argomenti della funzione `list_documents`. Un solo posto in cui si costruiscono. */
export interface ListDocumentsArgs {
  p_company_id: string;
  p_query: string | null;
  p_category: DocumentCategory | null;
  p_uncategorized: boolean;
  p_source: DocumentSourceType | null;
  p_state: DocumentState | null;
  p_tag_ids: string[] | null;
  p_date_from: string | null;
  p_date_to: string | null;
  p_has_deadline: boolean;
  p_archived: boolean;
  p_sort: DocumentSort;
  p_limit: number;
  p_offset: number;
}

export function toListArgs(companyId: string, f: DocumentHubFilters = {}): ListDocumentsArgs {
  const query = (f.query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  const tagIds = (f.tagIds ?? []).filter(Boolean);
  return {
    p_company_id: companyId,
    // Una ricerca vuota non è un errore e non è un filtro: è l'assenza di
    // filtro. Mandarla come stringa vuota farebbe cercare «niente» e non
    // troverebbe nulla.
    p_query: query || null,
    p_category: f.category ?? null,
    p_uncategorized: f.uncategorized === true,
    p_source: f.source ?? null,
    p_state: f.state ?? null,
    p_tag_ids: tagIds.length ? tagIds : null,
    p_date_from: f.dateFrom || null,
    p_date_to: f.dateTo || null,
    p_has_deadline: f.hasDeadline === true,
    p_archived: f.archived === true,
    p_sort: f.sort ?? 'recent',
    p_limit: Math.min(Math.max(f.limit ?? DOCUMENTS_PAGE_SIZE, 1), 100),
    p_offset: Math.max(f.offset ?? 0, 0),
  };
}

/** Un filtro è «attivo» se restringe qualcosa: serve a proporre «Rimuovi filtri» (§71). */
export function hasActiveFilters(f: DocumentHubFilters): boolean {
  return Boolean(
    (f.query ?? '').trim()
    || f.category
    || f.uncategorized
    || f.source
    || f.state
    || (f.tagIds ?? []).length
    || f.dateFrom
    || f.dateTo
    || f.hasDeadline
    || f.archived,
  );
}

// ---------------------------------------------------------------------------
// Filtri ↔ indirizzo (§104)
//
// Ricaricare la pagina non deve azzerare una ricerca, il tasto indietro deve
// funzionare e un collegamento a «imposte, da verificare» deve poter essere
// mandato a un collega. Le chiavi restano nella lingua dell'indirizzo (che qui
// è l'italiano, come `/attivita?vista=`), i VALORI restano chiavi tecniche.
// ---------------------------------------------------------------------------
const isOneOf = <T extends string>(all: readonly T[], v: string | null): T | null =>
  (v && (all as readonly string[]).includes(v) ? (v as T) : null);

export function filtersFromParams(params: URLSearchParams): DocumentHubFilters {
  const tag = params.getAll('tag').filter(Boolean);
  return {
    query: params.get('q') || null,
    category: isOneOf(CATEGORIES, params.get('categoria')),
    uncategorized: params.get('categoria') === 'nessuna',
    source: isOneOf(SOURCES, params.get('origine')),
    state: isOneOf(STATES, params.get('stato')),
    tagIds: tag.length ? tag : null,
    dateFrom: params.get('da') || null,
    dateTo: params.get('a') || null,
    hasDeadline: params.get('scadenza') === '1',
    archived: params.get('archiviati') === '1',
    sort: isOneOf(SORTS, params.get('ordine')) ?? 'recent',
  };
}

export function paramsFromFilters(f: DocumentHubFilters): URLSearchParams {
  const p = new URLSearchParams();
  const q = (f.query ?? '').trim();
  if (q) p.set('q', q.slice(0, MAX_QUERY_LENGTH));
  if (f.uncategorized) p.set('categoria', 'nessuna');
  else if (f.category) p.set('categoria', f.category);
  if (f.source) p.set('origine', f.source);
  if (f.state) p.set('stato', f.state);
  (f.tagIds ?? []).forEach((id) => p.append('tag', id));
  if (f.dateFrom) p.set('da', f.dateFrom);
  if (f.dateTo) p.set('a', f.dateTo);
  if (f.hasDeadline) p.set('scadenza', '1');
  if (f.archived) p.set('archiviati', '1');
  if (f.sort && f.sort !== 'recent') p.set('ordine', f.sort);
  return p;
}
