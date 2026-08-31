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
import { urgencyFromType } from '@/features/admin-ai/engine';
// ⚠️ Il conto dei giorni NON viene più dal motore di lettura: quella copia era
// sbagliata (ms/86400) ed è stata tolta il 2026-08-24. Una risposta sola.
import { calendarDaysUntil } from '@/lib/calendarDays';
import type {
  DocumentCategory, DocumentHubFilters, DocumentHubItem, DocumentSort, DocumentSourceType,
  DocumentState, DocumentStatsRow, DocumentStatus, DocumentTag,
} from '@/types/models';
import type { AnalysisStatus } from '@/types/database';

/** Le categorie nell'ordine in cui compaiono nella barra laterale. */
export const CATEGORIES: DocumentCategory[] = [
  'administration', 'taxes', 'social_insurance', 'invoices', 'contracts',
  'insurance', 'banking', 'employees', 'clients', 'suppliers', 'subsidies', 'other',
];

export const SORTS: DocumentSort[] = ['recent', 'oldest', 'document_date', 'title', 'deadline'];
export const STATES: DocumentState[] = ['to_verify', 'analyzed', 'processing', 'failed', 'none'];
export const SOURCES: DocumentSourceType[] = ['upload', 'email', 'pasted_text', 'generated'];

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

// ---------------------------------------------------------------------------
// I MARCATORI DELLA RIGA — l'erede di «un solo colore forte per riga».
//
// LA STORIA, perché spiega la forma. Fino al 2026-08-11 le due pastiglie della
// riga sceglievano il tono da sole e un «da verificare» con scadenza mostrava
// DUE ambre affiancate: da lì `rowBadgeTones`, una precedenza che demoteva il
// perdente a neutro. Quella precedenza era il RIMEDIO a un vocabolario in cui
// «Da verificare» (uno stato di fiducia) e «Scadenza 10.09» (un termine) erano
// la stessa identica pastiglia: due colori uguali non dicevano due cose,
// dicevano «guarda qui» due volte. Dal 2026-08-12 il vocabolario distingue le
// famiglie per FORMA (marcature tipografiche: cifre per il termine, filetto
// puntinato per il «da verificare»), e il rimedio può andare in pensione.
//
// LA REGOLA NUOVA, che questa funzione decide per tutta la riga:
//   1. La sola PASTIGLIA PIENA rimasta è il GUASTO (rosso) e gli stati
//      funzionali neutri (in elaborazione, non analizzato). «Analizzato» resta
//      non-notizia: nessun marcatore.
//   2. Su un GUASTO la scadenza NON si mostra: se l'analisi non è riuscita,
//      niente nella riga è affidabile — nemmeno una data che per qualche
//      ragione fosse rimasta lì. (Prima scendeva a neutro; era comunque un
//      numero non affidabile, mostrato.)
//   3. «Da verificare» è il marcatore epistemico della famiglia provenienza
//      (filetto puntinato), il termine è la marcatura a cifre: possono
//      convivere perché non si somigliano più — è il testo a dire la cosa,
//      la forma la classifica, e nessuna delle due è un riempimento pieno.
// ---------------------------------------------------------------------------
export interface RowMarks {
  /** La pastiglia PIENA di stato: guasto rosso o stati funzionali neutri. */
  state: 'failed' | 'processing' | 'none' | null;
  /** Il marcatore epistemico «da verificare» della lettura. */
  toVerify: boolean;
  /** La scadenza si mostra? Su un guasto no. */
  deadline: boolean;
}

export function rowMarks(
  item: Pick<DocumentHubItem, 'state' | 'deadline' | 'deadlineRequiresVerification'>,
): RowMarks {
  const failed = item.state === 'failed';
  return {
    state: failed ? 'failed'
      : item.state === 'processing' ? 'processing'
        : item.state === 'none' ? 'none' : null,
    toVerify: item.state === 'to_verify',
    deadline: item.deadline !== null && !failed,
  };
}

// ---------------------------------------------------------------------------
// LE STATISTICHE DELL'ARCHIVIO (§37, 2026-08-15)
//
// Stavano in Panoramica, che è una schermata d'AZIONE: «quanti documenti per
// tipo» non risponde a «cosa richiede la mia attenzione oggi», ed erano la sola
// ragione per cui la Panoramica interrogava `document_analyses` senza sapere
// nulla di `archived_at` — da lì i due numeri che si contraddicevano, 19 e 2.
//
// Qui invece l'insieme lo SCEGLIE chi guarda, con l'interruttore
// Attivi/Archiviati che la pagina ha già: quando sceglie «Archiviati», il 19
// diventa un numero vero perché è la risposta alla domanda che ha posto.
//
// ⚠️ UN SOLO DENOMINATORE PER TUTTI E TRE I GRAFICI. Un documento caricato e mai
// analizzato non ha urgenza, non ha tipo e non ha lingua: invece di sparire da
// un grafico e comparire in un altro — tre totali diversi nella stessa sezione —
// occupa in tutti e tre una riga «senza analisi». Così ogni grafico somma
// esattamente ai documenti dell'insieme dichiarato in testa.
// ---------------------------------------------------------------------------

/** Le fasce di urgenza più l'assenza di analisi, che non è una fascia. */
export interface UrgencyBuckets { alta: number; media: number; bassa: number; none: number }

/** `key: null` è «senza analisi»: un'assenza dichiarata, non una categoria. */
export interface StatsBucket { key: string | null; n: number }

export interface DocumentStatsBuckets {
  urgency: UrgencyBuckets;
  types: StatsBucket[];
  languages: StatsBucket[];
  withoutAnalysis: number;
  /** Quante righe sono state contate davvero. Non è per forza il totale. */
  counted: number;
}

/**
 * I conteggi, da righe che partono da `documents`.
 *
 * ⚠️ L'urgenza NON viene ricalcolata con una regola scritta qui: si chiama
 * `urgencyFromType`, la stessa funzione che decide l'urgenza nel dettaglio del
 * documento e nell'analisi. Due copie della stessa soglia divergono, e a
 * divergere sarebbe proprio il numero che questa sezione mostra.
 *
 * `days` è un parametro per poter provare le soglie senza dipendere dal giorno
 * in cui gira la prova; in produzione è sempre la `daysUntil` del motore.
 */
export function buildDocumentStats(
  rows: DocumentStatsRow[],
  days: (iso: string | null) => number | null = calendarDaysUntil,
): DocumentStatsBuckets {
  const urgency: UrgencyBuckets = { alta: 0, media: 0, bassa: 0, none: 0 };
  const types = new Map<string | null, number>();
  const languages = new Map<string | null, number>();
  const bump = (m: Map<string | null, number>, k: string | null) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const r of rows) {
    if (!r.hasAnalysis) {
      urgency.none++;
      bump(types, null);
      bump(languages, null);
      continue;
    }
    // Un'analisi senza tipo esiste: `urgencyFromType` la tratta come le altre,
    // e il tipo resta l'assenza che è — non si inventa «altro».
    urgency[urgencyFromType(r.documentType ?? '', days(r.deadline))]++;
    bump(types, r.documentType);
    bump(languages, r.language);
  }

  return {
    urgency,
    types: sortBuckets(types),
    languages: sortBuckets(languages),
    withoutAnalysis: urgency.none,
    counted: rows.length,
  };
}

/**
 * Dal più frequente al meno. ⚠️ Il gruppo «senza analisi» va SEMPRE in fondo
 * anche quando è il più numeroso: è un'assenza di dato, e un'assenza in cima a
 * un grafico si legge come la categoria dominante.
 */
function sortBuckets(m: Map<string | null, number>): StatsBucket[] {
  return [...m.entries()]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : 0) || b.n - a.n);
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
    || f.archived
    || f.ownership,
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
    ownership: params.get('appartenenza') === '1',
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
  if (f.ownership) p.set('appartenenza', '1');
  if (f.sort && f.sort !== 'recent') p.set('ordine', f.sort);
  return p;
}

/**
 * IL PASSO DEI SEGNALI DI APPARTENENZA quando l'insieme delle righe cambia.
 *
 * ⚠️⚠️ «PIÙ RIGHE» NON È «ALTRE RIGHE». L'effetto che carica i marcatori
 * azzerava la mappa a ogni cambio dell'elenco, e «Mostra altri» ACCODA: le
 * pastiglie «appartenenza da confermare» delle righe già a schermo sparivano e
 * tornavano un istante dopo, senza che nulla su quelle righe fosse cambiato.
 *
 * ⚠️⚠️ MA UN VERDETTO NON È DI UN DOCUMENTO: è di un documento SOTTO UNA
 * REGOLA. `analysisTrust` confronta il destinatario con la ragione sociale e
 * con i cognomi della rubrica, quindi azienda, nome e rubrica fanno parte del
 * calcolo. Se cambia uno solo di quei tre, ciò che è in mappa è stato calcolato
 * con la regola di qualcun altro e va buttato — non fuso. Perciò la regola
 * arriva qui come CONTENUTO e non come identità: `surnames` è un array nuovo a
 * ogni render finché la rubrica non ha risposto, e un confronto per riferimento
 * azzererebbe di continuo.
 */
export interface PassoSegnali {
  /** true = la mappa in mano vale per un'altra regola: si butta prima di tutto. */
  azzera: boolean;
  /** Gli id da chiedere davvero: mai quelli il cui verdetto è già in mano. */
  daInterrogare: string[];
}

export function passoSegnali(
  regolaPrecedente: string | null,
  regola: string,
  ids: readonly string[],
  giaChiesti: ReadonlySet<string>,
): PassoSegnali {
  if (regolaPrecedente !== regola) return { azzera: true, daInterrogare: [...ids] };
  return { azzera: false, daInterrogare: ids.filter((id) => !giaChiesti.has(id)) };
}
