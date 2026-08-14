// ============================================================================
// Finance Operations — il nucleo PURO.
//
// Qui non si parla né con il database né con React: ci sono le regole che
// trasformano i filtri in argomenti, i filtri nell'indirizzo e viceversa, e le
// decisioni di prodotto che si possono sbagliare in silenzio — che cosa
// significa «scaduta», che cosa manca perché una fattura sia verificabile, come
// si scrive un importo senza inventargli una valuta.
//
// Sta in un file separato dal servizio per una ragione operativa: i test
// offline importano QUESTO, e importare il servizio trascinerebbe dentro il
// client Supabase. È la stessa divisione di `documentModel` / `documentHubService`.
//
// ⚠️ COSA NON C'È, E NON PER DIMENTICANZA. Nessuna funzione che prepari un
// pagamento, che componga un file di pagamento o che trasformi un IBAN in
// un'azione. Il modulo COMPRENDE e PREPARA il denaro: non lo muove. Un IBAN qui
// è un testo da mostrare accanto alla sua provenienza, niente altro.
// ============================================================================
// ⚠️ IMPORT RELATIVO, non `@/features/...`: i test offline girano con `tsx` e
// senza il risolutore di alias di Vite. Un alias qui renderebbe questo file
// impossibile da eseguire fuori dal browser, che è l'unica ragione per cui
// esiste separato dal servizio. (Gli `import type` possono usare l'alias: il
// compilatore li cancella, e a runtime non resta niente da risolvere.)
import { SOURCES } from '../documents/documentModel';
import type {
  DocumentSourceType, FinanceExpenseCategory, FinanceFilters, FinanceItem,
  FinanceProcessingStatus, FinanceReviewStatus, FinanceSort, FinanceTotal,
} from '@/types/models';

// ⚠️ NON È UNA COPIA DEL CONTRATTO: È LO STESSO FILE.
// `_shared/finance/contract.ts` non ha alcun import — né Deno, né npm, né il
// resto del progetto — e può quindi entrare nel bundle del browser così com'è.
// È la stessa scelta di `features/automations/registry.ts`, e per la stessa
// ragione: due elenchi «tenuti allineati a mano» divergono al primo campo
// aggiunto da una parte sola, e qui la divergenza si vedrebbe come una fattura
// che si può dichiarare verificata e che il database rifiuta.
// (Se un domani qualcuno aggiungesse un `import` a quel file, `npm run build`
// fallirebbe QUI, ed è il posto giusto per accorgersene.)
import {
  FINANCE_CORRECTABLE_FIELDS, FINANCE_READY_REQUIREMENTS,
} from '../../../supabase/functions/_shared/finance/contract.ts';

export {
  FINANCE_READY_REQUIREMENTS, FINANCE_CORRECTABLE_FIELDS, FINANCE_HIGH_RISK_FIELDS,
  FINANCE_COMMON_CURRENCIES, FINANCE_QUALITY_FLAGS, FINANCE_MIN_CONFIDENCE,
} from '../../../supabase/functions/_shared/finance/contract.ts';
export type { FinanceCorrectableField } from '../../../supabase/functions/_shared/finance/contract.ts';

// ---------------------------------------------------------------------------
// Gli elenchi chiusi
//
// Ognuno rispecchia un enum della 0021 o un valore che `list_finance_items`
// accetta. Servono ai filtri e — soprattutto — a `isOneOf`, che scarta ciò che
// arriva dall'indirizzo e non è previsto.
// ---------------------------------------------------------------------------

/** Le due sezioni della schermata: fatture (e note di credito) oppure spese. */
export const TABS = ['invoices', 'expenses'] as const;
export type FinanceTab = (typeof TABS)[number];

export const SORTS: FinanceSort[] = ['default', 'due_date', 'amount', 'recent', 'supplier'];
export const REVIEWS: FinanceReviewStatus[] = ['needs_review', 'ready'];
export const PROCESSINGS: FinanceProcessingStatus[] = ['pending', 'processing', 'completed', 'failed'];
export const EXPENSE_CATEGORIES: FinanceExpenseCategory[] =
  ['travel', 'meals', 'office', 'software', 'vehicle', 'other'];

/** L'origine del documento. Una lista sola per tutto il prodotto, non una copia. */
export const DOCUMENT_SOURCES: DocumentSourceType[] = SOURCES;

export const FINANCE_PAGE_SIZE = 25;
/** Il taglio è quello che `list_finance_items` applica con `left(…, 120)`. */
export const MAX_QUERY_LENGTH = 120;
/** Quanti giorni guarda avanti il cruscotto, salvo diversa richiesta. */
export const DEFAULT_DUE_DAYS = 7;

// ---------------------------------------------------------------------------
// Lo stato, come lo legge una persona
// ---------------------------------------------------------------------------

/**
 * Lo stato leggibile di un elemento finanziario.
 *
 * ⚠️ NON è una colonna del database, ed è deliberato: la 0021 tiene separati lo
 * stato della MACCHINA (`processing_status`) e il lavoro della PERSONA
 * (`review_status`), perché «l'estrazione è fallita» e «i dati vanno
 * verificati» sono due cose diverse. Questa funzione le compone in UNA parola
 * per la riga di lista, e lo fa in un posto solo: due schermate che
 * componessero da sé finirebbero per dire due cose diverse sulla stessa fattura.
 */
export type FinanceState = 'archived' | 'failed' | 'processing' | 'ready' | 'to_verify';

/**
 * ⚠️ L'ORDINE DELLE PRECEDENZE È UNA DECISIONE, non un caso.
 *
 *  1. ARCHIVIATA vince su tutto: dice DOVE si trova, ed è l'unica cosa che
 *     spiega perché quella riga non compare nelle viste normali. Non cancella
 *     nulla — `reviewStatus` e `reviewedAt` restano leggibili nel dettaglio, e
 *     infatti la 0021 si è rifiutata di fare di «archiviata» uno stato di
 *     verifica proprio per non perdere l'informazione che era stata verificata.
 *  2. NON RIUSCITA prima di PRONTA: un tentativo di lettura fallito è un fatto
 *     che nessun altro riporta, e tacerlo perché qualcuno aveva già verificato
 *     la fattura significherebbe nascondere che la ri-lettura richiesta non è
 *     avvenuta. È la stessa precedenza di `stateOf` nel Document Hub.
 *  3. IN ELABORAZIONE: c'è solo da aspettare, non c'è niente da fare.
 */
export function financeState(
  item: Pick<FinanceItem, 'archivedAt' | 'processingStatus' | 'reviewStatus'>,
): FinanceState {
  if (item.archivedAt) return 'archived';
  if (item.processingStatus === 'failed') return 'failed';
  if (item.processingStatus === 'pending' || item.processingStatus === 'processing') return 'processing';
  return item.reviewStatus === 'ready' ? 'ready' : 'to_verify';
}

// ---------------------------------------------------------------------------
// Le scadenze — GIORNI DI CALENDARIO
// ---------------------------------------------------------------------------

/** `AAAA-MM-GG`: è la forma con cui una colonna `date` arriva dal database. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Quanti giorni di CALENDARIO mancano alla scadenza. Negativo se è passata.
 *
 * ⚠️ NON SI DIVIDONO I MILLISECONDI. `daysUntil` in `lib/format` fa la
 * differenza fra due istanti: alle 23:30 una scadenza di domani dista «0
 * giorni» e la schermata scrive «oggi». Qui si confrontano due DATE, cioè due
 * caselle di calendario, che è ciò che una persona intende quando legge
 * «scade domani».
 *
 * La data non passa da `new Date(...)`: su una stringa `AAAA-MM-GG` quel
 * costruttore produce la mezzanotte UTC, e a ovest di Greenwich il giorno
 * locale che ne esce è quello PRIMA. Si leggono le tre componenti e basta.
 */
export function daysToDue(dueDate: string | null | undefined, today: Date = new Date()): number | null {
  const m = DATE_ONLY.exec(String(dueDate ?? ''));
  if (!m) return null;
  const due = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // «Oggi» è il giorno del calendario di chi guarda, non un istante UTC.
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - now) / 86_400_000);
}

/**
 * Scaduta = LA DATA DI SCADENZA È PASSATA.
 *
 * ⚠️ NON significa «non pagata» (§114). Senza dati bancari il prodotto non sa
 * se una fattura è stata pagata, e dirlo sarebbe la prima affermazione falsa di
 * questo modulo.
 *
 * ⚠️ Solo le FATTURE FORNITORI, e non archiviate: sono gli stessi due confini
 * che `finance_summary` applica al totale «scadute». Se la pastiglia sulla riga
 * e il numero del cruscotto seguissero regole diverse, una delle due sarebbe
 * sbagliata e nessuno saprebbe quale. Una nota di credito non si paga, una
 * ricevuta è una spesa già sostenuta.
 */
export function isOverdue(
  item: Pick<FinanceItem, 'dueDate' | 'type' | 'archivedAt'>,
  today: Date = new Date(),
): boolean {
  if (item.archivedAt) return false;
  if (item.type !== 'supplier_invoice') return false;
  const d = daysToDue(item.dueDate, today);
  return d != null && d < 0;
}

/** In scadenza entro N giorni, estremi compresi. Ciò che è già scaduto non lo è. */
export function isDueSoon(
  item: Pick<FinanceItem, 'dueDate' | 'type' | 'archivedAt'>,
  days: number = DEFAULT_DUE_DAYS,
  today: Date = new Date(),
): boolean {
  if (item.archivedAt) return false;
  if (item.type !== 'supplier_invoice') return false;
  const d = daysToDue(item.dueDate, today);
  return d != null && d >= 0 && d <= days;
}

// ---------------------------------------------------------------------------
// Che cosa manca per poter dichiarare verificata una fattura
// ---------------------------------------------------------------------------

/**
 * ⚠️ TRE CHIAVI VENGONO DAL CONTRATTO, LA QUARTA DAL VINCOLO.
 * `supplier`, `gross` e `currency` sono `FINANCE_READY_REQUIREMENTS`.
 * `extraction` è il vincolo `finance_ready_needs_extraction` della 0021: una
 * fattura «pronta» senza estrazione è una dichiarazione a vuoto, e il database
 * la rifiuta. Ometterla qui vorrebbe dire mostrare un pulsante che sembra
 * disponibile e produce un errore — cioè far applicare un limite in un posto e
 * prometterne un altro nell'interfaccia.
 */
export type FinanceReadyBlocker = (typeof FINANCE_READY_REQUIREMENTS)[number] | 'extraction';

/**
 * Che cosa manca perché questa fattura possa essere dichiarata verificata.
 * Restituisce CHIAVI: la frase la scrive l'interfaccia nella lingua di chi
 * legge. Elenco vuoto = si può verificare.
 */
export function readyBlockers(
  item: Pick<FinanceItem, 'supplierName' | 'merchant' | 'grossAmount' | 'currency' | 'extractionId'>,
): FinanceReadyBlocker[] {
  const missing: FinanceReadyBlocker[] = [];
  // Un nome di fornitore OPPURE di esercente: su una ricevuta il secondo è
  // l'unico che esiste, e pretendere il primo bloccherebbe un documento in ordine.
  if (!item.supplierName && !item.merchant) missing.push('supplier');
  if (item.grossAmount === null || item.grossAmount === undefined) missing.push('gross');
  if (!item.currency) missing.push('currency');
  if (!item.extractionId) missing.push('extraction');
  return missing;
}

/** Un campo è correggibile solo se sta nell'elenco chiuso del contratto (§152). */
export function isCorrectableField(field: string): boolean {
  return (FINANCE_CORRECTABLE_FIELDS as readonly string[]).includes(field);
}

/** Questo valore l'ha scritto una persona, non l'ha letto la macchina (§11). */
export function isCorrected(item: Pick<FinanceItem, 'correctedFields'>, field: string): boolean {
  return item.correctedFields.includes(field);
}

// ---------------------------------------------------------------------------
// Gli importi
// ---------------------------------------------------------------------------

/**
 * ⚠️ PERCHÉ ESISTE UNA SECONDA FUNZIONE DI FORMATTAZIONE, accanto a
 * `formatCurrency` di `src/lib/format.ts`.
 *
 * Quella fa due cose che qui sarebbero sbagliate:
 *   1. `currency || 'CHF'` — quando la valuta non è nota, la INVENTA. Su una
 *      fattura è un dato inventato nel punto peggiore: «1'240.00 CHF» su un
 *      documento in euro è credibile, si mostra come un fatto e nessuno lo
 *      verifica. §49 dice esplicitamente di non presumere i franchi perché il
 *      prodotto è svizzero; la 0021 conta quelle fatture e lascia il loro
 *      totale a `null`. Qui la mancanza si mostra: il numero si scrive senza
 *      valuta, e la frase «valuta mancante» la aggiunge l'interfaccia.
 *   2. accetta un `number` e basta. Gli importi del modulo vivono in colonne
 *      `numeric` SENZA precisione dichiarata, cioè esatte per costruzione, e
 *      `money.ts` esiste proprio per non farli mai passare da un double. Questa
 *      funzione accetta anche la STRINGA decimale così come arriva.
 *
 * `formatCurrency` NON viene toccata: la usano altre schermate, dove l'importo
 * dell'analisi amministrativa ha già quella semantica.
 *
 * ⚠️ Il tag di lingua è un PARAMETRO e non `getCurrentLocaleTag()`: importarlo
 * trascinerebbe React dentro questo file e i test offline non potrebbero più
 * eseguirlo. Chi disegna passa `getCurrentLocaleTag()`, il test passa 'it-CH'.
 */
export function formatDecimal(
  value: string | number | null | undefined,
  currency: string | null | undefined,
  localeTag: string,
): string | null {
  const canonical = canonicalDecimal(value);
  if (canonical === null) return null;

  const cur = String(currency ?? '').trim().toUpperCase();
  const frac = Math.min(Math.max(fractionDigits(canonical), 2), 6);
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
    // ⚠️ IL SEPARATORE DELLE MIGLIAIA SEMPRE, e in italiano non era così.
    // Il default di Intl per l'it è il raggruppamento «min2»: il separatore
    // compare da CINQUE cifre in su. Nella colonna delle fatture si leggeva
    //     CHF 23'450.80 / CHF 6712.40 / CHF 3120.00
    // cioè due modi di scrivere un franco a una riga di distanza, dove i
    // numeri servono a essere confrontati. In de-CH e fr-CH il risultato non
    // cambia — quelle lingue raggruppano già da mille — quindi il difetto era
    // invisibile a chi provava l'app in tedesco.
    // Stessa correzione, stesso giorno, in `formatCurrency` di lib/format.ts:
    // due funzioni per due semantiche diverse, ma la FORMA di un franco è una.
    useGrouping: true,
  };

  // ⚠️ OLTRE LE 15 CIFRE SIGNIFICATIVE NON SI PASSA DA `Number`. Un double non
  // le rappresenta tutte, e la formattazione restituirebbe un importo DIVERSO
  // da quello scritto sulla fattura — plausibile e sbagliato. In quel caso si
  // mostra la stringa decimale esatta, senza raggruppamento: meno bella, vera.
  if (significantDigits(canonical) > 15) {
    return cur ? `${cur} ${canonical}` : canonical;
  }
  const n = Number(canonical);

  if (/^[A-Z]{3}$/.test(cur)) {
    try {
      return new Intl.NumberFormat(localeTag, { style: 'currency', currency: cur, ...options }).format(n);
    } catch {
      // Un codice di tre lettere che Intl non conosce non è un guasto: la
      // fattura lo dichiara e si mostra com'è, davanti al numero.
      return `${cur} ${new Intl.NumberFormat(localeTag, options).format(n)}`;
    }
  }
  const formatted = new Intl.NumberFormat(localeTag, options).format(n);
  // Valuta assente: il numero da solo. Valuta presente ma malformata: si mostra
  // ciò che il documento dice, perché è l'unico dato che abbiamo.
  return cur ? `${cur} ${formatted}` : formatted;
}

/** La forma decimale canonica, oppure `null` se quello che è arrivato non è un numero. */
function canonicalDecimal(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const s = String(value);
    // Notazione esponenziale: non è una forma che si possa mostrare a qualcuno
    // e non si converte a mano — si dichiara di non saperla scrivere.
    return /e/i.test(s) ? null : s;
  }
  const s = value.trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

function fractionDigits(canonical: string): number {
  const dot = canonical.indexOf('.');
  return dot < 0 ? 0 : canonical.length - dot - 1;
}

function significantDigits(canonical: string): number {
  return canonical.replace(/[-.]/g, '').replace(/^0+/, '').length;
}

// ---------------------------------------------------------------------------
// I totali del cruscotto
// ---------------------------------------------------------------------------

/** I quattro secchielli di `finance_summary`. */
/**
 * ⚠️ LA CODA ACCETTA LAVORO E NON LO ESEGUE: chi se ne accorge?
 *
 * Il worker di Finanze gira su uno scheduler ogni cinque minuti. Se il segreto
 * non è impostato o il job cron non è stato creato, un documento entra in coda,
 * resta `pending` e la schermata continua a dire «Lettura in corso» — per
 * sempre. Un'attesa indefinita che si presenta come lavoro in corso è
 * esattamente il guasto che si maschera da normalità: lo stesso schema dei
 * quattordici messaggi dell'Inbox che sarebbero passati a «fatto» senza essere
 * stati letti, e del controllo i18n che dava verde su cento stringhe italiane.
 *
 * Qui NON si aggiunge un sistema di monitoraggio, né una tabella, né un
 * registro: si CALCOLA in lettura, come il duplicato sospetto — che per la
 * stessa ragione non è memorizzato. Se l'elemento più vecchio in coda aspetta
 * da più di questa soglia, il prodotto lo DICE.
 *
 * ⚠️ LE DUE FRASI SONO DIVERSE PERCHÉ PORTANO A DUE AZIONI DIVERSE: «la tua
 * fattura non è ancora stata letta» si risolve aspettando; «il servizio di
 * lettura non risulta in funzione» si risolve configurando lo scheduler, e chi
 * legge la schermata non può indovinare quale delle due sia.
 */
export const QUEUE_STALE_MINUTES = 30;

/**
 * Da quanti minuti aspetta l'elemento più vecchio ancora in coda.
 * `null` quando non c'è niente in coda: nessuna attesa da misurare.
 */
export function oldestPendingMinutes(
  items: readonly Pick<FinanceItem, 'processingStatus' | 'createdAt'>[],
  now: Date = new Date(),
): number | null {
  const waiting = items.filter(
    (i) => i.processingStatus === 'pending' || i.processingStatus === 'processing');
  if (!waiting.length) return null;
  // ⚠️ Il MASSIMO dei minuti di attesa, cioè il documento più VECCHIO. Con il
  // minimo si guarderebbe il più recente, e una coda ferma da un'ora sembrerebbe
  // sana solo perché qualcosa vi è entrato un istante fa — l'avviso non
  // comparirebbe mai proprio quando serve. Trovato dal test, non rileggendo.
  let waited = -Infinity;
  for (const item of waiting) {
    const t = Date.parse(item.createdAt);
    if (Number.isNaN(t)) continue;
    waited = Math.max(waited, (now.getTime() - t) / 60_000);
  }
  return Number.isFinite(waited) ? Math.floor(waited) : null;
}

/**
 * La coda sembra ferma?
 *
 * ⚠️ «SEMBRA», e la parola è scelta: da qui non si può sapere se il worker sia
 * spento, se lo scheduler non esista o se il provider AI sia irraggiungibile.
 * Si sa una cosa sola — che qualcosa aspetta da troppo — e il messaggio dice
 * quella, indicando dove guardare invece di diagnosticare a distanza.
 */
export function queueLooksStalled(
  items: readonly Pick<FinanceItem, 'processingStatus' | 'createdAt'>[],
  now: Date = new Date(),
): boolean {
  const minutes = oldestPendingMinutes(items, now);
  return minutes !== null && minutes >= QUEUE_STALE_MINUTES;
}

export const BUCKETS = ['needs_review', 'due_soon', 'overdue', 'expenses_month'] as const;
export type FinanceBucket = (typeof BUCKETS)[number];

/** Una riga grezza di `finance_summary`, prima di essere raggruppata. */
export interface FinanceSummaryRow {
  bucket: string;
  currency: string | null;
  n: number | string;
  total: number | string | null;
}

/**
 * I totali di un secchiello, UNA RIGA PER VALUTA.
 *
 * ⚠️ NON SI SOMMANO VALUTE DIVERSE (§22/§113). «CHF 12'400» e «EUR 3'100» sono
 * due fatti; «15'500» non è un fatto, è un'invenzione che richiederebbe un
 * tasso di cambio, una data e una fonte — nessuna delle quali il prodotto ha.
 *
 * ⚠️ Un totale `null` non diventa zero e non contamina gli altri: le fatture
 * senza valuta si CONTANO (sono comunque in scadenza) ma non si sommano, e la
 * loro riga resta in fondo con `total: null` perché l'interfaccia possa dire
 * «di cui una senza valuta» invece di farle sparire o attribuirle ai franchi.
 *
 * La somma dentro la stessa valuta è una DIFESA, non il caso normale:
 * `finance_summary` raggruppa già per valuta e restituisce una riga sola. Se
 * qualcuno passasse righe non raggruppate, sommarle è legittimo — è la stessa
 * moneta — e basta che un addendo sia sconosciuto perché il totale torni `null`.
 */
export function totalsByCurrency(
  rows: readonly FinanceSummaryRow[],
  bucket: FinanceBucket,
): FinanceTotal[] {
  const byCurrency = new Map<string, FinanceTotal>();
  for (const row of rows) {
    if (row.bucket !== bucket) continue;
    const currency = row.currency ? row.currency.toUpperCase() : null;
    const key = currency ?? '';
    const current = byCurrency.get(key);
    const n = Number(row.n ?? 0);
    const total = row.total === null || row.total === undefined ? null : Number(row.total);
    if (!current) {
      byCurrency.set(key, { currency, n, total });
      continue;
    }
    current.n += n;
    // Un addendo sconosciuto rende sconosciuta la somma: non lo si tratta come zero.
    current.total = current.total === null || total === null ? null : current.total + total;
  }
  return [...byCurrency.values()].sort((a, b) => {
    // La riga senza valuta va in fondo: è un'eccezione da leggere per ultima.
    if (!a.currency) return 1;
    if (!b.currency) return -1;
    return a.currency.localeCompare(b.currency);
  });
}

/** Il conteggio di un secchiello, valute comprese. `needs_review` è solo questo. */
export function bucketCount(rows: readonly FinanceSummaryRow[], bucket: FinanceBucket): number {
  return rows.reduce((sum, row) => (row.bucket === bucket ? sum + Number(row.n ?? 0) : sum), 0);
}

/** La riga delle fatture senza valuta, se c'è: serve alla frase «di cui …». */
export function withoutCurrency(totals: readonly FinanceTotal[]): FinanceTotal | null {
  return totals.find((t) => !t.currency) ?? null;
}

// ---------------------------------------------------------------------------
// Gli argomenti di `list_finance_items` — un solo posto in cui si costruiscono
// ---------------------------------------------------------------------------

export interface ListFinanceArgs {
  p_company_id: string;
  p_tab: FinanceTab | null;
  p_query: string | null;
  p_review: FinanceReviewStatus | null;
  p_processing: FinanceProcessingStatus | null;
  p_supplier: string | null;
  p_currency: string | null;
  p_date_from: string | null;
  p_date_to: string | null;
  p_due_from: string | null;
  p_due_to: string | null;
  p_source: DocumentSourceType | null;
  p_category: FinanceExpenseCategory | null;
  p_duplicates: boolean;
  p_flagged: boolean;
  p_archived: boolean;
  p_sort: FinanceSort;
  p_limit: number;
  p_offset: number;
  p_item_id: string | null;
}

export function toListArgs(companyId: string, f: FinanceFilters = {}): ListFinanceArgs {
  const query = (f.query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  const supplier = (f.supplier ?? '').trim();
  return {
    p_company_id: companyId,
    p_tab: f.tab ?? null,
    // Una ricerca vuota non è un errore e non è un filtro: è l'assenza di
    // filtro. Mandarla come stringa vuota farebbe cercare «niente».
    p_query: query || null,
    p_review: f.review ?? null,
    p_processing: f.processing ?? null,
    p_supplier: supplier || null,
    p_currency: normalizeCurrencyFilter(f.currency),
    p_date_from: f.dateFrom || null,
    p_date_to: f.dateTo || null,
    p_due_from: f.dueFrom || null,
    p_due_to: f.dueTo || null,
    p_source: f.source ?? null,
    p_category: f.category ?? null,
    p_duplicates: f.duplicates === true,
    p_flagged: f.flagged === true,
    p_archived: f.archived === true,
    p_sort: f.sort ?? 'default',
    // Gli stessi estremi che la funzione SQL applica: chiederne 500 ne
    // restituirebbe 100, e la pagina crederebbe di averli tutti.
    p_limit: Math.min(Math.max(f.limit ?? FINANCE_PAGE_SIZE, 1), 100),
    p_offset: Math.max(f.offset ?? 0, 0),
    p_item_id: null,
  };
}

/**
 * ⚠️ La valuta NON si confronta con un elenco chiuso.
 * `FINANCE_COMMON_CURRENCIES` sono le valute che compaiono fra i filtri
 * predefiniti, non le uniche ammesse: una fattura in SEK esiste, viene letta e
 * deve poter essere filtrata. Si controlla la FORMA (tre lettere), non
 * l'appartenenza — restringere qui vorrebbe dire rifiutare documenti veri.
 */
function normalizeCurrencyFilter(value: string | null | undefined): string | null {
  const cur = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cur) ? cur : null;
}

/** Un filtro è «attivo» se restringe qualcosa: serve a proporre «Rimuovi filtri». */
export function hasActiveFilters(f: FinanceFilters): boolean {
  return Boolean(
    (f.query ?? '').trim()
    || f.review
    || f.processing
    || (f.supplier ?? '').trim()
    || f.currency
    || f.dateFrom
    || f.dateTo
    || f.dueFrom
    || f.dueTo
    || f.source
    || f.category
    || f.duplicates
    || f.flagged
    || f.archived,
  );
}

// ---------------------------------------------------------------------------
// Filtri ↔ indirizzo
//
// Ricaricare la pagina non deve azzerare una ricerca, il tasto indietro deve
// funzionare e un collegamento a «fatture scadute in CHF» deve poter essere
// mandato a un collega. Le chiavi restano nella lingua dell'indirizzo (che qui
// è l'italiano, come `/documenti?categoria=` e `/attivita?vista=`); i VALORI
// restano chiavi tecniche, perché sono gli stessi che vanno al database.
//
// ⚠️ La sezione (`tab`) NON sta qui: è il percorso, non un filtro.
// ---------------------------------------------------------------------------

/** Scarta ciò che non è previsto: un valore inventato nell'indirizzo non filtra. */
const isOneOf = <T extends string>(all: readonly T[], v: string | null): T | null =>
  (v && (all as readonly string[]).includes(v) ? (v as T) : null);

export function filtersFromParams(params: URLSearchParams): FinanceFilters {
  return {
    query: params.get('q') || null,
    review: isOneOf(REVIEWS, params.get('verifica')),
    processing: isOneOf(PROCESSINGS, params.get('elaborazione')),
    supplier: params.get('fornitore') || null,
    currency: normalizeCurrencyFilter(params.get('valuta')),
    dateFrom: params.get('da') || null,
    dateTo: params.get('a') || null,
    dueFrom: params.get('scade-da') || null,
    dueTo: params.get('scade-a') || null,
    source: isOneOf(DOCUMENT_SOURCES, params.get('origine')),
    category: isOneOf(EXPENSE_CATEGORIES, params.get('categoria')),
    duplicates: params.get('duplicati') === '1',
    flagged: params.get('segnalati') === '1',
    archived: params.get('archiviati') === '1',
    sort: isOneOf(SORTS, params.get('ordine')) ?? 'default',
  };
}

export function paramsFromFilters(f: FinanceFilters): URLSearchParams {
  const p = new URLSearchParams();
  const q = (f.query ?? '').trim();
  const supplier = (f.supplier ?? '').trim();
  if (q) p.set('q', q.slice(0, MAX_QUERY_LENGTH));
  if (f.review) p.set('verifica', f.review);
  if (f.processing) p.set('elaborazione', f.processing);
  if (supplier) p.set('fornitore', supplier);
  const currency = normalizeCurrencyFilter(f.currency);
  if (currency) p.set('valuta', currency);
  if (f.dateFrom) p.set('da', f.dateFrom);
  if (f.dateTo) p.set('a', f.dateTo);
  if (f.dueFrom) p.set('scade-da', f.dueFrom);
  if (f.dueTo) p.set('scade-a', f.dueTo);
  if (f.source) p.set('origine', f.source);
  if (f.category) p.set('categoria', f.category);
  if (f.duplicates) p.set('duplicati', '1');
  if (f.flagged) p.set('segnalati', '1');
  if (f.archived) p.set('archiviati', '1');
  // L'ordinamento predefinito non si scrive: un indirizzo pulito è anche un
  // indirizzo che si legge.
  if (f.sort && f.sort !== 'default') p.set('ordine', f.sort);
  return p;
}
