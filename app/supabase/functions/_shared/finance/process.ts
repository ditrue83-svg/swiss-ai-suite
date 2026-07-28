// ============================================================================
// L'ORCHESTRAZIONE DELLA LETTURA FINANZIARIA.
//
// L'ORDINE DI LETTURA È IL CUORE DEL MODULO, e non è negoziabile:
//
//   (1) CODICE QR  — un payload Swiss QR è dato strutturato, scritto dal
//                    fornitore stesso e verificato riga per riga da `qrbill.ts`.
//                    È la fonte più forte che esista su una fattura svizzera.
//   (2) TESTO, DETERMINISTICO — IBAN, riferimento a 27 cifre, riferimento
//                    creditore RF, IDI, valuta, importi con un'etichetta
//                    esplicita. Ciò che passa una cifra di controllo non è
//                    un'interpretazione: è aritmetica.
//   (3) MODELLO    — SOLO ciò che manca dopo (1) e (2). Non si paga l'AI per
//                    riestrarre quello che il codice ha già letto con certezza
//                    (§99), e soprattutto non si sostituisce un dato verificato
//                    con uno probabile.
//
// ⚠️ PROVENIENZA PER CAMPO, SEMPRE. Ogni valore salvato porta con sé se viene
// dal codice QR, dal lettore deterministico o dal modello. Non è una curiosità
// tecnica: è la differenza fra «l'IBAN è scritto nel codice QR» e «l'ho letto
// nel testo», e chi sta per pagare ha diritto di sapere quale delle due (§101).
// Le origini non si mescolano MAI dentro un campo.
//
// ⚠️ QUANDO DUE FONTI DIVERGONO NON SI SCEGLIE IN SILENZIO: si alza
// `qr_text_mismatch`, si conserva anche il candidato scartato fra le citazioni,
// e l'elemento resta da verificare. Vedi `mergeSources()` per la scelta fatta e
// per quella scartata.
//
// ⚠️ QUESTO MODULO NON LEGGE `Deno.env` E NON COSTRUISCE CLIENT. Riceve il
// client Supabase e il client AI per PARAMETRO. È ciò che permette al test di
// eseguire QUESTO codice — non una sua riscrittura che assomiglia.
// ============================================================================
import {
  EDGE_TIME_BUDGET_MS, FINANCE_BATCH, FINANCE_MIN_CONFIDENCE, FINANCE_SLOT_MS,
  type FinanceErrorCode, type FinanceQualityFlag,
} from './contract.ts';
import {
  checkCreditorReference, checkIban, checkQrReference, isQrIban, referenceShape,
} from './checksums.ts';
import {
  ZERO, add, checkAmounts, cmp, isNegative, normalizeCurrency, parseAmount, parseMoney,
  roundingTolerance, sub, toString as decimalToString, type Decimal,
} from './money.ts';
import { formatQrAddress, parseSwissQrPayload, SPEC, type SwissQrBill } from './qrbill.ts';
import {
  FINANCE_AI_FIELDS, FINANCE_MODEL, FINANCE_PROMPT_VERSION, buildFinanceExtractionRequest,
  type FinanceAiField, type FinanceDocumentKind, type FinanceKnownFields, type FinanceOutputLanguage,
} from './prompt.ts';
import {
  parseFinanceModelJson, validateFinanceOutput, verifyQuote,
  type FinanceEvidence, type FinanceFieldValue, type FinanceSourceText, type FinanceUncertainty,
  type FinanceVatLine,
} from './validate.ts';
import {
  claimNextFinanceItem, countPendingFinanceItems, finalizeFinanceAiSlot, loadDocumentText,
  markFinanceFailed, markFinanceRetryLater, reserveFinanceAiSlot, saveFinanceExtraction,
  FinanceStoreError, type DocumentTextRow, type FinanceItemRow, type ServerClient,
} from './store.ts';

// ---------------------------------------------------------------------------
// (0) Le dipendenze, tutte iniettate
// ---------------------------------------------------------------------------

/** Forma minima della risposta del modello: comune all'SDK Deno e a quello Node. */
export interface FinanceModelMessage {
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export type FinanceCreateMessage =
  (request: ReturnType<typeof buildFinanceExtractionRequest>) => Promise<FinanceModelMessage>;

export interface FinanceDeps {
  sb: ServerClient;
  /**
   * Il client AI. `null` = non configurato: la lettura deterministica gira
   * comunque e ciò che manca resta `null`, dichiarato. NON si finge un'estrazione
   * riuscita, e non si finge nemmeno un guasto: `AI_NOT_CONFIGURED` è un codice.
   */
  createMessage: FinanceCreateMessage | null;
  /** Lingua in cui l'utente legge l'app: i testi generati dal modello la seguono (§42). */
  outputLanguage?: FinanceOutputLanguage;
  /** Istante oltre il quale non si comincia un'altra lettura. */
  deadlineMs?: number;
  /** Iniettabile perché il test possa far scorrere il tempo senza aspettarlo. */
  now?: () => number;
}

export interface FinanceWorkerReport {
  claimed: number;
  completed: number;
  failed: number;
  retryLater: number;
  noText: number;
  notFinancial: number;
  qrRead: number;
  aiCalls: number;
  pendingLeft: number;
  /** Chi legge deve distinguere «non c'era altro da fare» da «il tempo è finito». */
  timeBudgetReached: boolean;
}

// ---------------------------------------------------------------------------
// (1) IL CODICE QR
// ---------------------------------------------------------------------------

/**
 * L'esito della decodifica di un codice QR A PARTIRE DAL FILE.
 *
 * ⚠️ `available: false` NON È UN GUASTO. È una capacità che il prodotto non ha
 * e che dichiara di non avere.
 */
export type QrDecodeOutcome =
  | { available: true; payload: string }
  | { available: false; reason: 'RASTERIZER_NOT_AVAILABLE' };

export interface QrDecodeInput {
  /** Il percorso del file nello Storage, quando esiste. */
  storagePath: string | null;
  mimeType: string | null;
  /** Come il testo era stato estratto: `native_pdf` significa che il file non è mai stato scaricato. */
  extractionMethod: string | null;
}

/**
 * Decodifica il codice QR dai PIXEL del documento.
 *
 * ⚠️⚠️ NON È IMPLEMENTATA, E NON VA FINTA.
 * Servirebbe un rasterizzatore — trasformare la pagina PDF in un'immagine e poi
 * leggere il codice a barre da quei pixel — e questa pipeline non ne ha uno. Di
 * più: sul percorso `native_pdf`, che è quello della grande maggioranza delle
 * fatture svizzere, il file NON viene nemmeno scaricato lato server; il worker
 * lavora sul testo già estratto. Non c'è nulla da decodificare, nemmeno
 * volendo.
 *
 * ⚠️ E NON SI CHIEDE A UN MODELLO LINGUISTICO DI «LEGGERE L'IBAN DAL QR»: un
 * codice QR è una struttura binaria con una correzione d'errore, non un testo da
 * interpretare. Farlo indovinare sarebbe l'esatto contrario di una decodifica
 * deterministica, e produrrebbe un IBAN plausibile — cioè il tipo di dato che
 * questo modulo esiste per non produrre.
 *
 * Resta esportata, con un esito TIPIZZATO, perché il giorno in cui esisterà un
 * rasterizzatore questo è il punto unico in cui collegarlo, e perché il rapporto
 * deve poter dire «non l'ho letto» invece di tacere.
 */
export function decodeSwissQrFromDocument(_input: QrDecodeInput): QrDecodeOutcome {
  return { available: false, reason: 'RASTERIZER_NOT_AVAILABLE' };
}

/**
 * Cerca un payload Swiss QR DENTRO IL TESTO estratto.
 *
 * Capita davvero: alcuni generatori scrivono il contenuto del codice anche come
 * testo nel PDF, e alcuni motori di OCR restituiscono il payload accanto
 * all'immagine. Quando c'è, è dato strutturato al cento per cento — comincia per
 * `SPC` e finisce con `EPD` — e va usato come tale.
 */
export function findSwissQrPayload(text: string): string | null {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const start = normalized.search(/(^|\n)SPC(\n|$)/);
  if (start < 0) return null;
  const from = normalized[start] === '\n' ? start + 1 : start;
  const endMatch = /(^|\n)EPD(\n|$)/.exec(normalized.slice(from));
  if (!endMatch) return null;
  const end = from + endMatch.index + endMatch[0].length;
  const payload = normalized.slice(from, end).trim();
  // La forma minima dello standard: sotto questa soglia non è un payload, è una
  // coincidenza di tre lettere.
  return payload.split('\n').length >= SPEC.minLines ? payload : null;
}

// ---------------------------------------------------------------------------
// (2) IL LETTORE DETERMINISTICO DEL TESTO
// ---------------------------------------------------------------------------

export interface DeterministicReading {
  /** campo → valore normalizzato + la riga da cui viene (serve alla citazione). */
  values: Partial<Record<FinanceAiField, { value: string; quote: string }>>;
  /** Ci sono indizi di una QR-fattura: un QR-IBAN, o un riferimento a 27 cifre. */
  qrEvidenceInText: boolean;
  /** Che cosa NON si è potuto decidere perché il testo diceva più cose. */
  ambiguous: FinanceAiField[];
}

/** Righe che classificano un importo. L'ordine conta: si prova IVA, poi netto, poi totale. */
const VAT_LABEL = /\b(mwst|mehrwertsteuer|iva|tva|vat)\b/i;
const NET_LABEL = /\b(netto|imponibile|total\s*ht|sous[-\s]?total|zwischentotal|subtotal|totale\s*imponibile)\b/i;
const GROSS_LABEL =
  /\b(total|totale|gesamtbetrag|gesamtsumme|rechnungsbetrag|endbetrag|zu\s*bezahlen|da\s*pagare|[àa]\s*payer|montant\s*total|importo\s*totale|amount\s*due)\b/i;

/**
 * L'ultimo numero di una riga, che su una fattura è quasi sempre l'importo:
 * l'etichetta sta a sinistra, il valore a destra.
 *
 * ⚠️ SI ISOLA IL TOKEN PRIMA DI LEGGERLO. `parseMoney` rifiuta — giustamente —
 * tutto ciò che non è cifra o separatore, quindi una riga come
 * «Totale CHF 1'234.50 (IVA inclusa)» non si può passargli intera: tornerebbe
 * `null` e un totale perfettamente leggibile andrebbe perso. Qui si prende il
 * numero, e a leggerlo resta `money.ts`.
 */
function readAmountFromLine(line: string): string | null {
  const tokens = line.match(
    /-?\d{1,3}(?:[’'   .,]\d{3})*(?:[.,](?:\d{1,2}|[-–]))?|-?\d+(?:[.,](?:\d{1,2}|[-–]))?/g,
  );
  if (!tokens || !tokens.length) return null;
  const money = parseMoney(tokens[tokens.length - 1]);
  return money ? decimalToString(money.amount) : null;
}

function distinctOrNull(
  entries: { value: string; quote: string }[],
): { value: string; quote: string } | null {
  if (!entries.length) return null;
  const first = entries[0];
  // ⚠️ SE IL TESTO DICE DUE COSE DIVERSE NON SE NE SCEGLIE UNA.
  // Un totale letto da due righe che non coincidono non è un totale: è un
  // dubbio, e un dubbio si passa al modello (che vede il contesto) invece di
  // risolverlo con la prima occorrenza.
  return entries.every((e) => e.value === first.value) ? first : null;
}

/**
 * Legge dal testo tutto ciò che si può VERIFICARE.
 *
 * ⚠️ CHE COSA È «DETERMINISTICO» QUI, ESATTAMENTE.
 * Un IBAN, un riferimento QR, un riferimento creditore e un IDI hanno una cifra
 * di controllo: o tornano o non tornano, e la risposta non dipende da come è
 * fatto il documento. Un importo NON ha una cifra di controllo — per questo si
 * legge SOLO da una riga che porta un'etichetta esplicita («Totale», «Betrag»,
 * «Montant total») e SOLO se tutte le righe di quella classe dicono lo stesso
 * numero. Dove non si può essere certi, questo lettore tace e lascia parlare il
 * modello: tacere costa una chiamata, indovinare costa un pagamento sbagliato.
 *
 * ⚠️ E NON DICE CHE UN IBAN È «GIUSTO». Una cifra di controllo valida dice che
 * il numero è stato TRASCRITTO bene. Non dice che il conto esista, né che
 * appartenga al fornitore indicato (§119).
 */
export function readDeterministic(text: string): DeterministicReading {
  const values: DeterministicReading['values'] = {};
  const ambiguous: FinanceAiField[] = [];
  const lines = text.split(/\n+/);

  // ---- IBAN ---------------------------------------------------------------
  const ibanHits: { value: string; quote: string }[] = [];
  for (const line of lines) {
    const matches = line.toUpperCase().match(/[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,32}/g) ?? [];
    for (const candidate of matches) {
      const check = checkIban(candidate);
      if (check.valid) ibanHits.push({ value: check.normalized, quote: line.trim() });
    }
  }
  const iban = distinctOrNull(ibanHits);
  if (iban) values.creditor_iban = iban;
  else if (ibanHits.length) ambiguous.push('creditor_iban');

  // ---- Riferimento QR (27 cifre) e riferimento creditore (RF…) ------------
  const referenceHits: { value: string; quote: string }[] = [];
  for (const line of lines) {
    for (const candidate of line.match(/\d[\d ]{24,45}\d/g) ?? []) {
      const check = checkQrReference(candidate);
      if (check.valid) referenceHits.push({ value: check.normalized, quote: line.trim() });
    }
    for (const candidate of line.toUpperCase().match(/RF\d{2}[A-Z0-9 ]{1,25}/g) ?? []) {
      // Stessa regola dell'IBAN: senza la cifra di controllo ISO 11649 non è un
      // riferimento creditore, è una sequenza che gli somiglia.
      const check = checkCreditorReference(candidate);
      if (check.valid) referenceHits.push({ value: check.normalized, quote: line.trim() });
    }
  }
  const reference = distinctOrNull(referenceHits);
  if (reference) {
    values.payment_reference = reference;
    const shape = referenceShape(reference.value);
    if (shape !== 'unknown') {
      values.reference_type = { value: shape, quote: reference.quote };
    }
  } else if (referenceHits.length) {
    ambiguous.push('payment_reference');
  }

  // ---- Valuta -------------------------------------------------------------
  const currencyHits: { value: string; quote: string }[] = [];
  for (const line of lines) {
    for (const token of line.match(/\b(CHF|EUR|USD|GBP)\b/g) ?? []) {
      const iso = normalizeCurrency(token);
      if (iso) currencyHits.push({ value: iso, quote: line.trim() });
    }
  }
  const currency = distinctOrNull(currencyHits);
  if (currency) values.currency = currency;
  else if (currencyHits.length) ambiguous.push('currency');

  // ---- Importi con un'etichetta esplicita ---------------------------------
  const buckets: Record<'vat' | 'net' | 'gross', { value: string; quote: string }[]> = {
    vat: [], net: [], gross: [],
  };
  for (const line of lines) {
    const matched: ('vat' | 'net' | 'gross')[] = [];
    if (VAT_LABEL.test(line)) matched.push('vat');
    if (NET_LABEL.test(line)) matched.push('net');
    if (GROSS_LABEL.test(line)) matched.push('gross');
    // ⚠️ UNA RIGA CHE PORTA DUE ETICHETTE NON SI LEGGE, E QUI SI PERDE
    // QUALCOSA DI PROPOSITO. «Gesamtbetrag CHF 1'234.50 (inkl. MWST)» è un
    // totale che nomina l'IVA; «Totale IVA CHF 88.80» è un importo d'IVA che
    // nomina il totale. Le due frasi sono indistinguibili con delle parole
    // chiave, e sbagliare significherebbe scrivere l'IVA nel campo del totale —
    // un errore di un fattore dieci, perfettamente plausibile a schermo.
    // Si tace, e il modello legge quella riga guardandone il contesto.
    if (matched.length !== 1) continue;
    const bucket = matched[0];
    // Si legge il numero della riga con `money.ts`: è lì che vive la regola sui
    // separatori svizzeri, francesi, tedeschi e anglosassoni (§116).
    const amount = readAmountFromLine(line);
    if (!amount) continue;
    buckets[bucket].push({ value: amount, quote: line.trim() });
  }
  const gross = distinctOrNull(buckets.gross);
  if (gross) values.gross_amount = gross; else if (buckets.gross.length) ambiguous.push('gross_amount');
  const net = distinctOrNull(buckets.net);
  if (net) values.net_amount = net; else if (buckets.net.length) ambiguous.push('net_amount');
  const vat = distinctOrNull(buckets.vat);
  if (vat) values.vat_amount = vat; else if (buckets.vat.length) ambiguous.push('vat_amount');

  // ---- Indizi di QR-fattura ------------------------------------------------
  const qrEvidenceInText =
    ibanHits.some((hit) => isQrIban(hit.value)) || referenceHits.some(
      (hit) => referenceShape(hit.value) === 'qrr',
    );

  return { values, qrEvidenceInText, ambiguous };
}

// ---------------------------------------------------------------------------
// (3) LA FUSIONE DELLE FONTI
// ---------------------------------------------------------------------------

/** Il valore di un campo, con la sua provenienza. `null` = non lo sappiamo. */
export type MergedFields = Partial<Record<FinanceAiField, FinanceFieldValue>>;

export interface MergeResult {
  fields: MergedFields;
  flags: Set<FinanceQualityFlag>;
  uncertainties: FinanceUncertainty[];
  /** Citazioni aggiuntive: fra queste, il candidato scartato in un disaccordo. */
  extraEvidence: Record<string, FinanceEvidence>;
}

/** I campi che toccano il DENARO: su questi un disaccordo non si liquida (§153). */
const HIGH_RISK: ReadonlySet<FinanceAiField> = new Set<FinanceAiField>([
  'creditor_iban', 'payment_reference', 'reference_type',
]);

/** Che cosa il codice QR sa dire, campo per campo. */
function fieldsFromQr(bill: SwissQrBill, source: FinanceSourceText): MergedFields {
  const out: MergedFields = {};
  const put = (field: FinanceAiField, value: string | null, raw?: string) => {
    if (!value) return;
    out[field] = {
      raw: raw ?? value,
      value,
      source: 'qr',
      // ⚠️ Fiducia 1 e non «alta»: non è una stima, è un dato strutturato che ha
      // superato la verifica riga per riga di `qrbill.ts`.
      confidence: 1,
      evidence: null,
    };
  };

  put('creditor_iban', bill.iban);
  put('payment_reference', bill.reference);
  put('reference_type', bill.referenceType ? bill.referenceType.toLowerCase() : null);
  put('currency', normalizeCurrency(bill.currency));
  if (bill.amount) {
    const parsed = parseAmount(bill.amount);
    if (parsed) put('gross_amount', decimalToString(parsed.amount), bill.amount);
  }
  put('supplier_name', bill.creditor.name);
  put('supplier_address', formatQrAddress(bill.creditor));
  put('supplier_country', bill.creditor.country);

  // La citazione, quando il payload è dentro il testo, esiste davvero: è la riga
  // del payload. Si verifica come tutte le altre invece di darla per buona.
  for (const value of Object.values(out)) {
    if (!value) continue;
    value.evidence = verifyQuote(source, value.raw, null);
  }
  return out;
}

/**
 * Sovrappone le tre letture nell'ordine dichiarato e registra i disaccordi.
 *
 * ⚠️ LA SCELTA FATTA QUANDO QR E TESTO DIVERGONO, e quella scartata.
 * Si conserva il valore del CODICE QR — è dato strutturato, non una
 * trascrizione — ma non si fa finta di niente: si alza `qr_text_mismatch`, si
 * scrive un'incertezza sul campo, e il candidato letto nel testo resta
 * consultabile fra le citazioni sotto la chiave `<campo>__text`. L'elemento
 * resta `needs_review`, perché il worker non dichiara mai «pronta» una fattura:
 * quello è un gesto umano.
 * ⚠️ ALTERNATIVA SCARTATA: azzerare il campo. Sarebbe stato più prudente in
 * astratto, ma toglie di mezzo l'unico dato verificato che si possiede e
 * costringe comunque una persona ad aprire il PDF — con in mano meno
 * informazioni di prima, non di più.
 */
export function mergeSources(input: {
  qr: MergedFields;
  deterministic: DeterministicReading;
  source: FinanceSourceText;
}): MergeResult {
  const fields: MergedFields = {};
  const flags = new Set<FinanceQualityFlag>();
  const uncertainties: FinanceUncertainty[] = [];
  const extraEvidence: Record<string, FinanceEvidence> = {};

  for (const [name, value] of Object.entries(input.qr)) {
    if (value) fields[name as FinanceAiField] = value;
  }

  for (const [name, read] of Object.entries(input.deterministic.values)) {
    if (!read) continue;
    const field = name as FinanceAiField;
    const fromQr = fields[field];
    const evidence = verifyQuote(input.source, read.quote, null);

    if (!fromQr) {
      fields[field] = {
        raw: read.quote,
        value: read.value,
        source: 'deterministic',
        // Fiducia 1: ciò che passa una cifra di controllo, o che è stato letto
        // da un'etichetta senza alcuna ambiguità, non è una stima.
        confidence: 1,
        evidence,
      };
      continue;
    }

    if (fromQr.value === read.value) continue;         // le due fonti concordano

    flags.add('qr_text_mismatch');
    uncertainties.push({
      field,
      description: 'qr_text_mismatch',
      severity: HIGH_RISK.has(field) ? 'high' : 'medium',
    });
    if (evidence) extraEvidence[`${field}__text`] = evidence;
  }

  return { fields, flags, uncertainties, extraEvidence };
}

// ---------------------------------------------------------------------------
// Quali campi ha ancora senso chiedere
// ---------------------------------------------------------------------------

/** I campi che non riguardano quel tipo di documento: chiederli è spesa a vuoto. */
function fieldsForKind(kind: FinanceDocumentKind): FinanceAiField[] {
  const receiptOnly: FinanceAiField[] = ['merchant', 'expense_date', 'payment_method'];
  const invoiceOnly: FinanceAiField[] = [
    'due_date', 'creditor_iban', 'payment_reference', 'reference_type',
  ];
  return FINANCE_AI_FIELDS.filter((field) => (
    kind === 'receipt'
      ? !invoiceOnly.includes(field)
      // Una ricevuta ha un esercente; una fattura ha un fornitore. Chiedere
      // l'esercente su una fattura produce un doppione del fornitore.
      : !receiptOnly.includes(field)
  ));
}

export function fieldsStillMissing(kind: FinanceDocumentKind, known: MergedFields): FinanceAiField[] {
  return fieldsForKind(kind).filter((field) => !known[field]);
}

// ---------------------------------------------------------------------------
// Le verifiche di coerenza
// ---------------------------------------------------------------------------

function decimalOf(value: string | null | undefined): Decimal | null {
  if (!value) return null;
  const parsed = parseAmount(value);
  return parsed ? parsed.amount : null;
}

/**
 * Le bandiere che dipendono dai VALORI, non da come sono stati letti.
 *
 * ⚠️ Nessuna di queste «corregge» niente. `vat_mismatch` non ricalcola l'IVA,
 * `amount_mismatch` non aggiusta il totale: dicono che i numeri stampati non
 * tornano fra loro, e la conclusione la trae una persona guardando il documento.
 */
export function consistencyFlags(input: {
  fields: MergedFields;
  vatBreakdown: FinanceVatLine[];
  kind: FinanceDocumentKind;
}): { flags: FinanceQualityFlag[]; uncertainties: FinanceUncertainty[] } {
  const flags = new Set<FinanceQualityFlag>();
  const uncertainties: FinanceUncertainty[] = [];

  const gross = decimalOf(input.fields.gross_amount?.value);
  const net = decimalOf(input.fields.net_amount?.value);
  const vat = decimalOf(input.fields.vat_amount?.value);

  const check = checkAmounts({ net, vat, gross, vatLineCount: input.vatBreakdown.length || 1 });
  if (check.outcome === 'mismatch') {
    flags.add('amount_mismatch');
    uncertainties.push({ field: 'gross_amount', description: 'amount_mismatch', severity: 'high' });
  }

  // Il dettaglio IVA deve sommare al totale IVA. Se non lo fa NON si «corregge»
  // il totale con la somma: si dichiara (§53).
  if (vat && input.vatBreakdown.length) {
    let sum: Decimal = ZERO;
    let complete = true;
    for (const line of input.vatBreakdown) {
      const amount = decimalOf(line.taxAmount);
      if (!amount) { complete = false; break; }
      sum = add(sum, amount);
    }
    if (complete) {
      const difference = sub(vat, sum);
      const tolerance = roundingTolerance(input.vatBreakdown.length);
      const absolute = isNegative(difference) ? sub(ZERO, difference) : difference;
      if (cmp(absolute, tolerance) > 0) {
        flags.add('vat_mismatch');
        uncertainties.push({ field: 'vat_amount', description: 'vat_mismatch', severity: 'medium' });
      }
    }
  }

  if (gross && isNegative(gross) && input.kind !== 'credit_note') {
    flags.add('negative_amount');
  }

  const iban = input.fields.creditor_iban?.value ?? null;
  if (iban && !checkIban(iban).valid) flags.add('invalid_iban');

  const reference = input.fields.payment_reference?.value ?? null;
  if (reference) {
    const shape = referenceShape(reference);
    if (shape === 'qrr' && !checkQrReference(reference).valid) flags.add('invalid_reference');
    if (iban && isQrIban(iban) !== (shape === 'qrr')) flags.add('reference_type_mismatch');
  }

  return { flags: [...flags], uncertainties };
}

// ---------------------------------------------------------------------------
// La lettura di UN elemento
// ---------------------------------------------------------------------------

export type ItemOutcome =
  | { outcome: 'completed'; flags: FinanceQualityFlag[]; usedAi: boolean; qrRead: boolean }
  | { outcome: 'failed'; code: FinanceErrorCode }
  | { outcome: 'retry_later'; code: FinanceErrorCode };

const KIND_OF: Record<FinanceItemRow['type'], FinanceDocumentKind> = {
  supplier_invoice: 'supplier_invoice',
  receipt: 'receipt',
  credit_note: 'credit_note',
};

export async function processFinanceItem(
  deps: FinanceDeps, item: FinanceItemRow,
): Promise<ItemOutcome> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const kind = KIND_OF[item.type];

  // ---- Il testo: si legge, non si riproduce -------------------------------
  const document: DocumentTextRow | null =
    await loadDocumentText(deps.sb, item.company_id, item.document_id);
  if (!document) {
    await markFinanceFailed(deps.sb, item, 'NO_TEXT');
    return { outcome: 'failed', code: 'NO_TEXT' };
  }
  const source: FinanceSourceText = { fullText: document.fullText, pages: document.pages };

  const flags = new Set<FinanceQualityFlag>();
  const uncertainties: FinanceUncertainty[] = [];

  // Una trascrizione poco leggibile non rende falsi i dati, ma spiega perché
  // qualcuno deve guardare il documento. Si dichiara solo quando il valore c'è:
  // un OCR senza punteggio non si giudica a occhio.
  if (document.ocrConfidence !== null && document.ocrConfidence < FINANCE_MIN_CONFIDENCE) {
    flags.add('low_ocr_confidence');
  }
  if (document.truncated) {
    uncertainties.push({ field: 'documento', description: 'text_truncated', severity: 'high' });
  }

  // ---- (1) Codice QR -------------------------------------------------------
  const payload = findSwissQrPayload(document.fullText);
  const qrResult = payload ? parseSwissQrPayload(payload) : null;
  let qrFields: MergedFields = {};
  let qrSpecVersion: string | null = null;
  let qrErrors: string[] = [];
  let qrValid: boolean | null = null;

  if (qrResult) {
    qrValid = qrResult.ok;
    qrErrors = qrResult.issues.map((issue) => issue.code);
    if (qrResult.ok) {
      qrSpecVersion = qrResult.bill.version || null;
      qrFields = fieldsFromQr(qrResult.bill, source);
    } else {
      // Un codice QR con una violazione BLOCCANTE non è una fonte: `qrbill.ts`
      // si rifiuta di restituire i dati, ed è la cosa giusta. Si dichiara.
      uncertainties.push({ field: 'qr', description: 'qr_invalid', severity: 'high' });
    }
  }

  // ---- (2) Testo, deterministico ------------------------------------------
  const deterministic = readDeterministic(document.fullText);
  for (const field of deterministic.ambiguous) {
    uncertainties.push({ field, description: 'ambiguous_in_text', severity: 'low' });
  }

  // C'è un QR-IBAN o un riferimento a 27 cifre nel testo, ma nessun payload
  // leggibile: da qualche parte su quel foglio c'è un codice QR che non abbiamo
  // decodificato. Si alza la bandiera SOLO in questo caso — alzarla su ogni
  // documento senza payload la renderebbe rumore su ogni ricevuta di taxi.
  if (!qrResult && deterministic.qrEvidenceInText) flags.add('qr_not_read');

  const merged = mergeSources({ qr: qrFields, deterministic, source });
  for (const flag of merged.flags) flags.add(flag);
  uncertainties.push(...merged.uncertainties);

  // ---- (3) Il modello, solo per ciò che manca ------------------------------
  const askFor = fieldsStillMissing(kind, merged.fields);
  let vatBreakdown: FinanceVatLine[] = [];
  let documentLanguage: string | null = null;
  let usedAi = false;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let logId: string | null = null;

  if (askFor.length && !deps.createMessage) {
    // Non si prosegue fingendo che il documento non avesse quei dati: si scrive
    // ciò che si è letto e si DICHIARA che il resto non è stato tentato.
    uncertainties.push({ field: 'generale', description: 'ai_not_configured', severity: 'high' });
  } else if (askFor.length && deps.createMessage) {
    const known: FinanceKnownFields = {};
    for (const [name, value] of Object.entries(merged.fields)) {
      if (value && value.source !== 'ai') {
        known[name] = { value: value.value, source: value.source };
      }
    }

    logId = await reserveFinanceAiSlot(deps.sb, {
      companyId: item.company_id,
      documentId: item.document_id,
      model: FINANCE_MODEL,
    });
    if (!logId) {
      // La quota dell'azienda è finita: non è un guasto del documento, e
      // riprovare fra poco funzionerà.
      await markFinanceRetryLater(deps.sb, item, 'RATE_LIMITED');
      return { outcome: 'retry_later', code: 'RATE_LIMITED' };
    }

    const request = buildFinanceExtractionRequest({
      documentText: document.fullText,
      kind,
      askFor,
      known,
      todayIso: new Date(now()).toISOString().slice(0, 10),
      outputLanguage: deps.outputLanguage ?? 'it',
    });

    let message: FinanceModelMessage;
    try {
      message = await deps.createMessage(request);
      usedAi = true;
    } catch {
      await finalizeFinanceAiSlot(deps.sb, logId, {
        status: 'error', errorCode: 'PROVIDER_ERROR', model: FINANCE_MODEL,
        durationMs: now() - startedAt,
      });
      await markFinanceRetryLater(deps.sb, item, 'PROVIDER_ERROR');
      return { outcome: 'retry_later', code: 'PROVIDER_ERROR' };
    }

    inputTokens = message.usage?.input_tokens ?? null;
    outputTokens = message.usage?.output_tokens ?? null;

    const block = message.content.find((b) => b.type === 'text' && typeof b.text === 'string');
    if (message.stop_reason === 'refusal' || !block?.text) {
      await finalizeFinanceAiSlot(deps.sb, logId, {
        status: 'error', errorCode: 'AI_INVALID_OUTPUT', model: FINANCE_MODEL,
        durationMs: now() - startedAt, inputTokens, outputTokens,
      });
      await markFinanceRetryLater(deps.sb, item, 'AI_INVALID_OUTPUT');
      return { outcome: 'retry_later', code: 'AI_INVALID_OUTPUT' };
    }

    let reading: ReturnType<typeof validateFinanceOutput>;
    try {
      reading = validateFinanceOutput({
        raw: parseFinanceModelJson(block.text),
        source,
        askFor,
      });
    } catch {
      await finalizeFinanceAiSlot(deps.sb, logId, {
        status: 'error', errorCode: 'AI_INVALID_OUTPUT', model: FINANCE_MODEL,
        durationMs: now() - startedAt, inputTokens, outputTokens,
      });
      await markFinanceRetryLater(deps.sb, item, 'AI_INVALID_OUTPUT');
      return { outcome: 'retry_later', code: 'AI_INVALID_OUTPUT' };
    }

    if (!reading.documentIsFinancial && !merged.fields.gross_amount && !merged.fields.creditor_iban) {
      // Nel dubbio il documento resta FUORI da Finance (§15). Il verbale si
      // scrive comunque, perché «l'ho guardato e non era una fattura» è un
      // fatto che vale la pena poter rileggere.
      await finalizeFinanceAiSlot(deps.sb, logId, {
        status: 'ok', model: FINANCE_MODEL, durationMs: now() - startedAt,
        inputTokens, outputTokens,
      });
      await saveFinanceExtraction(deps.sb, {
        companyId: item.company_id,
        financeItemId: item.id,
        documentId: item.document_id,
        status: 'failed',
        method: 'ai',
        provider: 'anthropic',
        model: FINANCE_MODEL,
        promptVersion: FINANCE_PROMPT_VERSION,
        uncertainties: [...uncertainties, ...reading.uncertainties],
        errorCode: 'NOT_FINANCIAL',
        documentLanguage: reading.documentLanguage,
        inputTokens,
        outputTokens,
        durationMs: now() - startedAt,
      });
      await markFinanceFailed(deps.sb, item, 'NOT_FINANCIAL');
      return { outcome: 'failed', code: 'NOT_FINANCIAL' };
    }

    for (const [name, value] of Object.entries(reading.fields)) {
      // Doppia difesa: `validateFinanceOutput` ha già scartato i campi non
      // richiesti, e qui un valore dell'AI non può comunque sovrascrivere una
      // lettura verificata. Le due difese sono ridondanti di proposito: la prima
      // che salta è quella che nessuno ricorda di aver messo.
      if (value && !merged.fields[name as FinanceAiField]) {
        merged.fields[name as FinanceAiField] = value;
      }
    }
    vatBreakdown = reading.vatBreakdown;
    documentLanguage = reading.documentLanguage;
    uncertainties.push(...reading.uncertainties);
    for (const flag of reading.qualityFlags) flags.add(flag);

    await finalizeFinanceAiSlot(deps.sb, logId, {
      status: 'ok', model: FINANCE_MODEL, durationMs: now() - startedAt,
      inputTokens, outputTokens,
    });
  }

  // ---- Coerenza ------------------------------------------------------------
  const consistency = consistencyFlags({ fields: merged.fields, vatBreakdown, kind });
  for (const flag of consistency.flags) flags.add(flag);
  uncertainties.push(...consistency.uncertainties);

  // ---- Il verbale ----------------------------------------------------------
  const fieldSources: Record<string, string> = {};
  const fieldConfidence: Record<string, number> = {};
  const evidence: Record<string, unknown> = { ...merged.extraEvidence };
  for (const [name, value] of Object.entries(merged.fields)) {
    if (!value) continue;
    fieldSources[name] = value.source;
    fieldConfidence[name] = value.confidence;
    if (value.evidence) evidence[name] = value.evidence;
  }

  const sources = new Set(Object.values(fieldSources));
  const method = sources.size === 0 ? 'none' : sources.size === 1 ? [...sources][0] : 'hybrid';

  const iban = merged.fields.creditor_iban?.value ?? null;
  const referenceTypeValue = merged.fields.reference_type?.value ?? null;
  const referenceType = referenceTypeValue === 'qrr' || referenceTypeValue === 'scor'
    || referenceTypeValue === 'non' ? referenceTypeValue : null;
  const paymentMethodValue = merged.fields.payment_method?.value ?? null;
  const paymentMethod = paymentMethodValue === 'card' || paymentMethodValue === 'cash'
    || paymentMethodValue === 'other' ? paymentMethodValue : null;

  await saveFinanceExtraction(deps.sb, {
    companyId: item.company_id,
    financeItemId: item.id,
    documentId: item.document_id,
    status: 'completed',
    method,
    provider: usedAi ? 'anthropic' : null,
    model: usedAi ? FINANCE_MODEL : null,
    promptVersion: usedAi ? FINANCE_PROMPT_VERSION : null,

    invoiceNumber: merged.fields.invoice_number?.value ?? null,
    supplierName: merged.fields.supplier_name?.value ?? null,
    supplierAddress: merged.fields.supplier_address?.value ?? null,
    supplierVatId: merged.fields.supplier_vat_id?.value ?? null,
    supplierCountry: merged.fields.supplier_country?.value ?? null,
    invoiceDate: merged.fields.invoice_date?.value ?? null,
    dueDate: merged.fields.due_date?.value ?? null,
    currency: merged.fields.currency?.value ?? null,
    grossAmount: merged.fields.gross_amount?.value ?? null,
    netAmount: merged.fields.net_amount?.value ?? null,
    vatAmount: merged.fields.vat_amount?.value ?? null,
    vatBreakdown,

    creditorIban: iban,
    ibanIsQr: iban ? isQrIban(iban) : null,
    referenceType,
    paymentReference: merged.fields.payment_reference?.value ?? null,

    qrPresent: !!qrResult || deterministic.qrEvidenceInText,
    qrValid,
    qrSpecVersion,
    qrErrors,

    merchant: merged.fields.merchant?.value ?? null,
    expenseDate: merged.fields.expense_date?.value ?? null,
    paymentMethodDetected: paymentMethod,

    fieldSources,
    fieldConfidence,
    evidence,
    uncertainties,
    qualityFlags: [...flags],
    documentLanguage,

    errorCode: null,
    inputTokens,
    outputTokens,
    durationMs: now() - startedAt,
  });

  // Da qui in poi non tocca al worker: `finance_after_extraction` promuove il
  // verbale, mette l'elemento in `completed` e ricalcola la proiezione.
  return { outcome: 'completed', flags: [...flags], usedAi, qrRead: !!(qrResult?.ok) };
}

// ---------------------------------------------------------------------------
// Il giro completo
// ---------------------------------------------------------------------------

export function emptyFinanceReport(): FinanceWorkerReport {
  return {
    claimed: 0, completed: 0, failed: 0, retryLater: 0, noText: 0, notFinancial: 0,
    qrRead: 0, aiCalls: 0, pendingLeft: 0, timeBudgetReached: false,
  };
}

/**
 * Svuota un pezzo della coda, entro il proprio budget di tempo.
 *
 * ⚠️ IL BUDGET NON È PRUDENZA, È LA LEZIONE PIÙ CARA DEL PROGETTO.
 * Supabase chiude la richiesta a 150 secondi e UCCIDE l'isolate: il `finally`
 * non gira e restano stati appesi. Qui, prima di prendere in carico un elemento,
 * si verifica che davanti ci sia almeno `FINANCE_SLOT_MS` — cominciare una
 * lettura con dieci secondi davanti significa perderla a metà, e averla pagata.
 */
export async function runFinanceWorker(deps: FinanceDeps): Promise<FinanceWorkerReport> {
  const now = deps.now ?? (() => Date.now());
  const deadline = deps.deadlineMs ?? (now() + EDGE_TIME_BUDGET_MS);
  const report = emptyFinanceReport();

  for (let i = 0; i < FINANCE_BATCH; i++) {
    if (now() + FINANCE_SLOT_MS > deadline) {
      report.timeBudgetReached = true;
      break;
    }

    const item = await claimNextFinanceItem(deps.sb);
    if (!item) break;
    report.claimed++;

    try {
      const outcome = await processFinanceItem(deps, item);
      if (outcome.outcome === 'completed') {
        report.completed++;
        if (outcome.usedAi) report.aiCalls++;
        if (outcome.qrRead) report.qrRead++;
      } else if (outcome.outcome === 'failed') {
        report.failed++;
        if (outcome.code === 'NO_TEXT') report.noText++;
        if (outcome.code === 'NOT_FINANCIAL') report.notFinancial++;
      } else {
        report.retryLater++;
      }
      // ⚠️ NEI LOG SOLO IDENTIFICATIVI E CODICI: mai IBAN, riferimento,
      // fornitore, importi o testo del documento (§168).
      console.log(
        `[finance-worker] item=${item.id} company=${item.company_id} `
        + `outcome=${outcome.outcome} code=${'code' in outcome ? outcome.code : '-'}`,
      );
    } catch (error) {
      // Un'eccezione qui è un guasto tecnico: si dichiara e si riproverà. Il
      // codice, mai il messaggio — un messaggio può contenere un dato.
      const code: FinanceErrorCode = error instanceof FinanceStoreError
        && error.code === 'CONFIG_MISSING' ? 'AI_NOT_CONFIGURED' : 'UNKNOWN_ERROR';
      await markFinanceRetryLater(deps.sb, item, code);
      report.retryLater++;
      // ⚠️ Solo identificativi e codice: nessun messaggio d'errore grezzo, che
      // potrebbe contenere il valore che ha violato un vincolo — cioè un IBAN.
      console.log(`[finance-worker] item=${item.id} outcome=error code=${code}`);
      if (code === 'AI_NOT_CONFIGURED') break;   // insistere non porta da nessuna parte
    }
  }

  report.pendingLeft = await countPendingFinanceItems(deps.sb);
  // ⚠️ «Il tempo è finito» si dichiara solo se è finito CON DEL LAVORO DAVANTI.
  // Un'esecuzione che ha svuotato la coda e si è chiusa al novantanovesimo
  // secondo non è stata interrotta da niente, e dirlo manderebbe a cercare un
  // problema di prestazioni che non esiste.
  if (!report.timeBudgetReached && report.pendingLeft > 0 && now() + FINANCE_SLOT_MS > deadline) {
    report.timeBudgetReached = true;
  }
  return report;
}
