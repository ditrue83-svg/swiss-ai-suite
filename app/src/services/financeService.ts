// ============================================================================
// financeService — Finanze: fatture fornitori, ricevute, note di credito.
//
// COSA FA E COSA NON FA. Questo servizio LEGGE la lettura finanziaria di
// documenti che appartengono ad altri — il file è del Document Hub, il testo
// dell'estrazione, la lettura amministrativa dell'analisi immutabile, la
// provenienza dell'Inbox, il lavoro delle attività — e SCRIVE soltanto ciò che
// una persona decide: verificata, archiviata, categoria di spesa, tipo,
// correzione di un campo.
//
// ⚠️⚠️ IL MODULO COMPRENDE E PREPARA IL DENARO, NON LO MUOVE.
// In questo file non esiste — e non deve esistere — alcuna funzione che esegua
// un pagamento, componga un file di pagamento, chiami una banca o trasformi un
// IBAN in un'azione. `iban` e `paymentReference` sono testo che si mostra
// accanto alla sua provenienza. Finché non ci sono approvazioni mature,
// integrazione bancaria, permessi granulari e riconciliazione, il prodotto non
// deve poter muovere denaro.
//
// La lista passa da `list_finance_items`: filtri, ricerca, ordinamento,
// paginazione, duplicato sospetto e composizione stanno nel database. Farlo qui
// vorrebbe dire una interrogazione per fattura per relazione, e per sapere
// quali venticinque righe mostrare bisognerebbe averle scaricate tutte.
//
// I VERBALI NON SI SCRIVONO DA QUI: `finance_extractions` è in sola lettura per
// il browser (grant della 0021 e trigger di immutabilità). Le estrazioni le
// scrive il worker con il service role.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import {
  FINANCE_CORRECTABLE_FIELDS, bucketCount, toListArgs, totalsByCurrency,
  type FinanceSummaryRow,
} from '@/features/finance/financeModel';
import { documentHubService, toDocumentRecord } from './documentHubService';
import type { Database, Json } from '@/types/database';
import type {
  FinanceCorrection, FinanceDetail, FinanceDuplicate, FinanceEvent, FinanceEvidence,
  FinanceExpenseCategory, FinanceExtraction, FinanceFieldSource, FinanceFilters, FinanceItem,
  FinanceItemType, FinancePage, FinancePaymentMethod, FinanceSummary, VatLine,
} from '@/types/models';

type ListRow = Database['public']['Functions']['list_finance_items']['Returns'][number];
type ExtractionRow = Database['public']['Tables']['finance_extractions']['Row'];
type CorrectionRow = Database['public']['Tables']['finance_corrections']['Row'];
type EventRow = Database['public']['Tables']['finance_events']['Row'];
type DuplicateRow = Database['public']['Functions']['finance_duplicates']['Returns'][number];
type ItemUpdate = Database['public']['Tables']['finance_items']['Update'];

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asRecord = <T,>(v: unknown): Record<string, T> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {});

/**
 * ⚠️ UN SOLO MAPPER PER UNA RIGA DI FINANZE, e vale per la lista E per il
 * dettaglio. È il motivo per cui il dettaglio riusa `list_finance_items` con
 * `p_item_id` invece di ricomporre i valori effettivi per conto proprio: due
 * mappature prima o poi direbbero due importi diversi sulla stessa fattura.
 *
 * `Number(...)` sugli importi e sui conteggi: PostgREST consegna `numeric` e
 * `bigint` come JSON, e a seconda della versione possono arrivare come stringa.
 * `null` resta `null` — un importo che non c'è non diventa zero.
 */
function toItem(row: ListRow): FinanceItem {
  return {
    id: row.id,
    documentId: row.document_id,
    type: row.type,
    processingStatus: row.processing_status,
    reviewStatus: row.review_status,
    origin: row.origin,
    errorCode: row.error_code,
    expenseCategory: row.expense_category,
    paymentMethod: row.payment_method,
    qualityFlags: Array.isArray(row.quality_flags) ? row.quality_flags : [],
    duplicateSuspected: row.duplicate_suspected === true,
    duplicateCount: Number(row.duplicate_count ?? 0),
    supplierName: row.supplier_name,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    expenseDate: row.expense_date,
    merchant: row.merchant,
    currency: row.currency,
    grossAmount: row.gross_amount === null ? null : Number(row.gross_amount),
    netAmount: row.net_amount === null ? null : Number(row.net_amount),
    vatAmount: row.vat_amount === null ? null : Number(row.vat_amount),
    iban: row.iban,
    referenceType: row.reference_type,
    paymentReference: row.payment_reference,
    correctedFields: Array.isArray(row.corrected_fields) ? row.corrected_fields : [],
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    extractionId: row.extraction_id,
    extractionVersion: row.extraction_version === null ? null : Number(row.extraction_version),
    documentTitle: row.document_title,
    documentSource: row.document_source,
    documentStatus: row.document_status,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    openTaskCount: Number(row.open_task_count ?? 0),
    taskCount: Number(row.task_count ?? 0),
    emailCount: Number(row.email_count ?? 0),
  };
}

function toExtraction(row: ExtractionRow): FinanceExtraction {
  return {
    id: row.id,
    financeItemId: row.finance_item_id,
    documentId: row.document_id,
    extractionVersion: Number(row.extraction_version),
    status: row.status,
    method: row.method,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    invoiceNumber: row.invoice_number,
    supplierName: row.supplier_name,
    supplierAddress: row.supplier_address,
    supplierVatId: row.supplier_vat_id,
    supplierCountry: row.supplier_country,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    currency: row.currency,
    grossAmount: row.gross_amount === null ? null : Number(row.gross_amount),
    netAmount: row.net_amount === null ? null : Number(row.net_amount),
    vatAmount: row.vat_amount === null ? null : Number(row.vat_amount),
    vatBreakdown: asArray<VatLine>(row.vat_breakdown),
    creditorIban: row.creditor_iban,
    ibanIsQr: row.iban_is_qr,
    referenceType: row.reference_type,
    paymentReference: row.payment_reference,
    qrPresent: row.qr_present === true,
    qrValid: row.qr_valid,
    qrSpecVersion: row.qr_spec_version,
    qrErrors: Array.isArray(row.qr_errors) ? row.qr_errors : [],
    merchant: row.merchant,
    expenseDate: row.expense_date,
    fieldSources: asRecord<FinanceFieldSource>(row.field_sources),
    fieldConfidence: asRecord<number>(row.field_confidence),
    evidence: asRecord<FinanceEvidence>(row.evidence),
    uncertainties: asArray<FinanceExtraction['uncertainties'][number]>(row.uncertainties),
    qualityFlags: Array.isArray(row.quality_flags) ? row.quality_flags : [],
    documentLanguage: row.document_language,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

function toCorrection(row: CorrectionRow): FinanceCorrection {
  return {
    id: row.id,
    financeItemId: row.finance_item_id,
    documentId: row.document_id,
    extractionId: row.extraction_id,
    field: row.field,
    originalValue: row.original_value,
    correctedValue: row.corrected_value,
    correctedBy: row.corrected_by,
    correctedAt: row.corrected_at,
  };
}

function toEvent(row: EventRow): FinanceEvent {
  return {
    id: row.id,
    financeItemId: row.finance_item_id,
    actorUserId: row.actor_user_id,
    kind: row.kind,
    detail: asRecord<unknown>(row.detail),
    createdAt: row.created_at,
  };
}

function toDuplicate(row: DuplicateRow): FinanceDuplicate {
  return {
    id: row.id,
    documentId: row.document_id,
    supplierName: row.supplier_name,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    currency: row.currency,
    grossAmount: row.gross_amount === null ? null : Number(row.gross_amount),
    reviewStatus: row.review_status,
    createdAt: row.created_at,
  };
}

/**
 * I guasti che QUESTO dominio produce davvero, detti come li capisce chi legge.
 *
 * I vincoli della 0021 arrivano come messaggi di Postgres con dentro il nome
 * del vincolo: `finance_correction_author_mismatch` non è «un errore di
 * sistema», è qualcuno che sta firmando una correzione con il nome di un
 * collega, e va detto così. Un codice fuori da questo elenco NON si mostra
 * grezzo — contiene nomi di tabelle, che a chi legge non dicono niente e a chi
 * guarda dicono troppo (§110): si ricade su `toUserMessage`.
 */
export function financeErrorMessage(error: unknown): string {
  const raw = error as { message?: string; code?: string; hint?: string; details?: string } | null;
  const text = `${raw?.message ?? ''} ${raw?.hint ?? ''} ${raw?.details ?? ''}`;
  if (text.includes('finance_document_company_mismatch')) return tr('finance.errors.wrongCompany');
  if (text.includes('finance_correction_company_mismatch')) return tr('finance.errors.correctionWrongCompany');
  if (text.includes('finance_correction_author_mismatch')) return tr('finance.errors.correctionAuthor');
  if (text.includes('finance_extraction_immutable')) return tr('finance.errors.extractionImmutable');
  if (text.includes('finance_correction_append_only')) return tr('finance.errors.correctionAppendOnly');
  if (text.includes('finance_correction_field_known')) return tr('finance.errors.fieldNotCorrectable');
  // Il guardiano rifiuta una correzione MALFORMATA all'ingresso, e ognuno di
  // quei rifiuti ha un nome proprio. Senza queste righe l'errore ricadeva su
  // `toUserMessage`, che — non riconoscendo gli errcode 22007/22P02 — mostrava
  // il messaggio grezzo `finance_correction_bad_iban`: un nome interno, cioè
  // niente per chi legge e troppo per chi guarda (§110).
  if (text.includes('finance_correction_bad_date')) return tr('finance.errors.correctionBadDate');
  if (text.includes('finance_correction_bad_amount')) return tr('finance.errors.correctionBadAmount');
  if (text.includes('finance_correction_bad_currency')) return tr('finance.errors.correctionBadCurrency');
  if (text.includes('finance_correction_bad_reference_type')) return tr('finance.errors.correctionBadReferenceType');
  if (text.includes('finance_correction_bad_iban')) return tr('finance.errors.correctionBadIban');
  if (text.includes('finance_ready_needs_extraction')) return tr('finance.errors.readyNeedsExtraction');
  // Un documento è già in Finanze: in V1 ne produce AL PIÙ un elemento (§6).
  if (text.includes('uq_finance_items_document')) return tr('finance.errors.alreadyInFinance');
  return toUserMessage(error);
}

/**
 * Un guasto diventa un errore esplicito, sempre nello stesso modo.
 * Dichiarata come funzione e non come costante: TypeScript riconosce così che
 * la chiamata non torna, e ciò che segue può contare sui dati.
 */
function fail(error: unknown): never {
  throw new AppError(financeErrorMessage(error), error);
}

export const financeService = {
  /** Una pagina di fatture e spese, già filtrata, ordinata e composta dal database. */
  async list(companyId: string, filters: FinanceFilters = {}): Promise<FinancePage> {
    const { data, error } = await requireSupabase()
      .rpc('list_finance_items', toListArgs(companyId, filters));
    if (error) fail(error);
    const rows = (data ?? []) as ListRow[];
    return {
      items: rows.map(toItem),
      // `total_count` è uguale su ogni riga (funzione finestra): è affidabile
      // SOLO se una riga c'è. Senza righe non esiste un totale da leggere, e
      // inventarne uno diverso da zero mostrerebbe una paginazione fantasma.
      total: rows.length ? Number(rows[0].total_count) : 0,
    };
  },

  /**
   * I quattro numeri del cruscotto.
   *
   * ⚠️ Il raggruppamento NON avviene qui: lo fa `totalsByCurrency`, che sta nel
   * modello puro ed è provato offline. Ciò che si può sbagliare in silenzio —
   * sommare valute diverse, trattare un totale sconosciuto come zero — non deve
   * vivere in un file che i test non possono eseguire senza rete.
   */
  async summary(companyId: string, dueDays?: number): Promise<FinanceSummary> {
    const { data, error } = await requireSupabase()
      .rpc('finance_summary', { p_company_id: companyId, p_due_days: dueDays });
    if (error) fail(error);
    const rows = (data ?? []) as FinanceSummaryRow[];
    return {
      // Un CONTEGGIO, non un importo: mettere insieme totali non verificati per
      // farne una somma significherebbe dare per buoni proprio i numeri incerti.
      needsReview: bucketCount(rows, 'needs_review'),
      dueSoon: totalsByCurrency(rows, 'due_soon'),
      overdue: totalsByCurrency(rows, 'overdue'),
      expensesMonth: totalsByCurrency(rows, 'expenses_month'),
    };
  },

  /**
   * Il dettaglio di una fattura.
   *
   * La testata passa dalla STESSA funzione della lista (`p_item_id`), come nel
   * Document Hub: se il dettaglio ricostruisse i valori effettivi per conto
   * proprio, prima o poi direbbe un importo diverso da quello della riga da cui
   * si è arrivati. Attorno, letture mirate in parallelo — ognuna usa un indice —
   * invece di un'unica interrogazione con join annidati.
   */
  async get(itemId: string, companyId: string): Promise<FinanceDetail | null> {
    const sb = requireSupabase();

    // `finance_items` si legge anche direttamente, e per una ragione precisa:
    // la funzione di lista non restituisce `company_id`, e senza quello la
    // difesa esplicita qui sotto non sarebbe possibile.
    const [{ data: rowData, error: rowErr }, { data: itemRows, error: itemErr }] = await Promise.all([
      sb.from('finance_items').select('id, company_id, document_id').eq('id', itemId).maybeSingle(),
      sb.rpc('list_finance_items', {
        ...toListArgs(companyId), p_item_id: itemId, p_limit: 1,
      }),
    ]);
    if (rowErr) fail(rowErr);
    if (itemErr) fail(itemErr);
    if (!rowData) return null;

    // ⚠️ Difesa esplicita OLTRE alla RLS: dopo un cambio di azienda una fattura
    // dell'azienda precedente non deve restare in pagina. La RLS lo impedirebbe
    // già; questa riga rende il fatto verificabile leggendo il servizio.
    if (rowData.company_id !== companyId) return null;

    const rows = (itemRows ?? []) as ListRow[];
    if (!rows.length) return null;
    const item = toItem(rows[0]);

    const [extraction, extractionHistory, corrections, events, duplicates, document, emails, tasks] =
      await Promise.all([
        item.extractionId ? financeService.extraction(item.extractionId) : Promise.resolve(null),
        financeService.extractions(itemId),
        financeService.corrections(itemId),
        financeService.events(itemId),
        financeService.duplicates(itemId),
        financeService.documentOf(item.documentId),
        documentHubService.emailSources(item.documentId),
        documentHubService.linkedTasks(item.documentId),
      ]);

    return { item, extraction, extractionHistory, corrections, events, duplicates, document, emails, tasks };
  },

  /** Una riga sola, ricomposta come nella lista. `null` se non è (più) visibile. */
  async item(itemId: string, companyId: string): Promise<FinanceItem | null> {
    const { data, error } = await requireSupabase().rpc('list_finance_items', {
      ...toListArgs(companyId), p_item_id: itemId, p_limit: 1,
    });
    if (error) fail(error);
    const rows = (data ?? []) as ListRow[];
    return rows.length ? toItem(rows[0]) : null;
  },

  /** Il documento da cui la fattura è stata letta. Il file resta suo, non di Finanze. */
  async documentOf(documentId: string) {
    const { data, error } = await requireSupabase()
      .from('documents').select('*').eq('id', documentId).maybeSingle();
    if (error) fail(error);
    return data ? toDocumentRecord(data) : null;
  },

  /**
   * Le controparti di un possibile duplicato (§71).
   * NON fonde e non cancella niente: le restituisce perché una persona possa
   * guardarle accanto e decidere lei.
   */
  async duplicates(itemId: string): Promise<FinanceDuplicate[]> {
    const { data, error } = await requireSupabase()
      .rpc('finance_duplicates', { p_item_id: itemId });
    if (error) fail(error);
    return ((data ?? []) as DuplicateRow[]).map(toDuplicate);
  },

  /**
   * Lo storico delle versioni del verbale (§9).
   * Un'estrazione non si corregge, si affianca: qui si vedono tutte, dalla più
   * recente, ed è ciò che permette di rispondere a «prima diceva un altro
   * importo?» con un fatto invece che con un'impressione.
   */
  async extractions(itemId: string): Promise<FinanceDetail['extractionHistory']> {
    const { data, error } = await requireSupabase()
      .from('finance_extractions')
      .select('id, extraction_version, status, created_at')
      .eq('finance_item_id', itemId)
      .order('extraction_version', { ascending: false });
    if (error) fail(error);
    return (data ?? []).map((r) => ({
      id: r.id,
      version: Number(r.extraction_version),
      status: r.status,
      createdAt: r.created_at,
    }));
  },

  /** Un verbale per intero: provenienza campo per campo, fiducia, citazioni. */
  async extraction(extractionId: string): Promise<FinanceExtraction | null> {
    const { data, error } = await requireSupabase()
      .from('finance_extractions').select('*').eq('id', extractionId).maybeSingle();
    if (error) fail(error);
    return data ? toExtraction(data) : null;
  },

  /** Le correzioni umane, in ordine cronologico: l'ultima di ogni campo vince. */
  async corrections(itemId: string): Promise<FinanceCorrection[]> {
    const { data, error } = await requireSupabase()
      .from('finance_corrections').select('*')
      .eq('finance_item_id', itemId)
      .order('corrected_at', { ascending: false });
    if (error) fail(error);
    return (data ?? []).map(toCorrection);
  },

  /** Lo storico (§87). Non registra le visualizzazioni: solo ciò che è cambiato. */
  async events(itemId: string): Promise<FinanceEvent[]> {
    const { data, error } = await requireSupabase()
      .from('finance_events').select('*')
      .eq('finance_item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) fail(error);
    return (data ?? []).map(toEvent);
  },

  // ---- Le decisioni di una persona ----------------------------------------

  /**
   * «Verificata» / «Da verificare».
   *
   * Il timbro — chi e quando — lo scrive il database da `auth.uid()` e `now()`,
   * mai il client (§85). Riaprire lo cancella, perché non è più vero che
   * qualcuno l'abbia verificata.
   *
   * ⚠️ Chi chiama dovrebbe aver già consultato `readyBlockers`: se manca il
   * fornitore, il totale o la valuta non c'è niente da dichiarare. Il vincolo
   * `finance_ready_needs_extraction` resta comunque l'ultima parola del
   * database, e il suo rifiuto diventa una frase leggibile.
   */
  async setReview(itemId: string, companyId: string, ready: boolean): Promise<FinanceItem> {
    return await financeService.patch(itemId, companyId, {
      review_status: ready ? 'ready' : 'needs_review',
    });
  },

  /** Archivia: fuori dalle viste, dentro il sistema. Non è una cancellazione (§91). */
  async archive(itemId: string, companyId: string): Promise<FinanceItem> {
    // Il client dichiara l'INTENZIONE; l'istante vero lo scrive il guardiano.
    return await financeService.patch(itemId, companyId, { archived_at: new Date().toISOString() });
  },

  async restore(itemId: string, companyId: string): Promise<FinanceItem> {
    return await financeService.patch(itemId, companyId, { archived_at: null });
  },

  /**
   * «Riprova estrazione» (§111): si rimette in coda e la raccoglie il worker
   * periodico. Nessuna Edge Function da chiamare.
   *
   * ⚠️ SI RIPARTE SOLO DA FERMO. Rimettere in coda qualcosa che è già in
   * lavorazione produrrebbe due estrazioni concorrenti sullo stesso documento:
   * il guardiano della 0021 annulla quella transizione, ma lo fa IN SILENZIO —
   * l'update riesce e non cambia niente. Qui si guarda prima e si dice che cosa
   * sta succedendo, invece di restituire un successo che non è avvenuto.
   *
   * Resta una corsa possibile: il worker può prendere in carico l'elemento fra
   * questa lettura e la scrittura. In quel caso vince il guardiano, e la
   * rilettura finale mostrerà «in lavorazione» — che è la verità.
   */
  async retry(itemId: string, companyId: string): Promise<FinanceItem> {
    const current = await financeService.item(itemId, companyId);
    if (!current) throw new AppError(tr('finance.errors.notFound'));
    if (current.processingStatus === 'pending' || current.processingStatus === 'processing') {
      throw new AppError(tr('finance.errors.retryWhileProcessing'));
    }
    return await financeService.patch(itemId, companyId, { processing_status: 'pending' });
  },

  /**
   * La categoria di spesa (§57).
   * ⚠️ NON è un conto contabile e non produce nessuna registrazione: è
   * organizzazione, e una persona può cambiarla liberamente. Chi e quando lo
   * scrive il database.
   */
  async setExpenseCategory(
    itemId: string, companyId: string, category: FinanceExpenseCategory | null,
  ): Promise<FinanceItem> {
    return await financeService.patch(itemId, companyId, { expense_category: category });
  },

  /** Come è stata pagata la spesa, SE il documento lo dice (§59). Non si deduce. */
  async setPaymentMethod(
    itemId: string, companyId: string, method: FinancePaymentMethod | null,
  ): Promise<FinanceItem> {
    return await financeService.patch(itemId, companyId, { payment_method: method });
  },

  /**
   * Cambiare il tipo: una ricevuta che era stata presa per una fattura, una
   * nota di credito riconosciuta tardi. Il cambio finisce nello storico, e la
   * bandiera «importo negativo» si ricalcola da sola alla prossima proiezione.
   */
  async setType(itemId: string, companyId: string, type: FinanceItemType): Promise<FinanceItem> {
    return await financeService.patch(itemId, companyId, { type });
  },

  /**
   * Correggere un campo letto male.
   *
   * ⚠️ NON MODIFICA IL VERBALE: aggiunge una riga a `finance_corrections`, che
   * vince in lettura (§11). Il valore originariamente letto resta visibile nel
   * dettaglio — è ciò che distingue «l'ha corretto una persona» da «l'aveva
   * letto così la macchina».
   *
   * ⚠️ I VALORI SONO STRINGHE, anche gli importi, e non è una svista.
   * La proiezione della 0021 li rilegge con `->>`, cioè come TESTO: un numero
   * JSON passerebbe da un double e `12345678.90` potrebbe tornare scritto
   * diversamente. Un importo si scrive `"1234.50"`, una data `"2026-07-28"`.
   * Il tipo lo impone, così non serve fidarsi di chi chiama.
   *
   * ⚠️ `document_id` ed `extraction_id` NON si dichiarano: li stabilisce il
   * trigger dall'elemento. Farli scrivere al client vorrebbe dire permettergli
   * di agganciare una correzione al documento sbagliato.
   */
  async correct(
    itemId: string,
    companyId: string,
    field: string,
    correctedValue: string | null,
    originalValue: string | null = null,
  ): Promise<FinanceItem> {
    // L'elenco chiuso è quello del contratto, ed è lo stesso che il vincolo
    // `finance_correction_field_known` applica: si controlla qui per non
    // mandare al database una scrittura che si sa già rifiutata.
    if (!(FINANCE_CORRECTABLE_FIELDS as readonly string[]).includes(field)) {
      throw new AppError(tr('finance.errors.fieldNotCorrectable'));
    }
    const { error } = await requireSupabase().from('finance_corrections').insert({
      company_id: companyId,
      finance_item_id: itemId,
      field,
      original_value: originalValue as Json,
      corrected_value: correctedValue as Json,
    });
    if (error) fail(error);
    // Si rilegge: il trigger ha ricalcolato valori effettivi, impronta del
    // duplicato e bandiere, e la riga in pagina deve mostrare quelli.
    return await financeService.reread(itemId, companyId);
  },

  /**
   * «Aggiungi a Finanze»: il gesto umano ed esplicito per un documento che il
   * classificatore deterministico non ha riconosciuto (§15).
   *
   * L'elemento nasce `pending` e `needs_review`: nessun elemento nasce pronto,
   * la verifica è un gesto umano. L'estrazione la farà il worker.
   */
  async addFromDocument(
    companyId: string, documentId: string, type: FinanceItemType,
  ): Promise<FinanceItem> {
    const { data, error } = await requireSupabase()
      .from('finance_items')
      .insert({ company_id: companyId, document_id: documentId, type })
      .select('id')
      .single();
    if (error || !data) fail(error);
    return await financeService.reread(data.id, companyId);
  },

  /**
   * Una modifica dello stato operativo, seguita dalla rilettura della riga.
   *
   * `select('id').single()` dopo l'update NON è un ornamento: senza, un update
   * che non tocca nessuna riga — perché la RLS l'ha filtrata, o perché
   * l'identificativo non esiste — tornerebbe senza errore e la schermata direbbe
   * «fatto». `.single()` trasforma «zero righe» in un errore, che è la verità.
   */
  async patch(itemId: string, companyId: string, change: ItemUpdate): Promise<FinanceItem> {
    const { error } = await requireSupabase()
      .from('finance_items')
      .update(change)
      .eq('id', itemId)
      .eq('company_id', companyId)
      .select('id')
      .single();
    if (error) fail(error);
    return await financeService.reread(itemId, companyId);
  },

  /**
   * Rilegge la riga composta dopo una scrittura. Se non torna, lo si dichiara:
   * un elemento che sparisce dopo una modifica è un fatto da dire, non un
   * `null` da far scivolare in pagina.
   */
  async reread(itemId: string, companyId: string): Promise<FinanceItem> {
    const item = await financeService.item(itemId, companyId);
    if (!item) throw new AppError(tr('finance.errors.notFound'));
    return item;
  },
};
