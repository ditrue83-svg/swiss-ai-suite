// ============================================================================
// SWISS QR CODE — lettura, verifica e GENERAZIONE DETERMINISTICHE del
// contenuto di una QR-fattura svizzera.
//
// ⚠️ FONTE. Questo modulo è scritto contro le «Swiss Implementation Guidelines
// for the QR-bill» di SIX, documento ufficiale, non contro una descrizione di
// seconda mano:
//
//   · versione LETTA E VERIFICATA il 2026-07-27: 2.4 del 24.02.2026,
//     valida dal 14 novembre 2026;
//   · versione IN VIGORE alla stessa data: 2.3 del 21.11.2025, che secondo il
//     controllo delle versioni della 2.4 «remains valid until November 2027».
//     Le due convivono: un lettore deve saperle leggere entrambe.
//   · https://www.six-group.com/dam/download/banking-services/standardization/
//     qr-bill/ig-qr-bill-v2.4-en.pdf
//
// Fra la 2.3 e la 2.4 la STRUTTURA del codice non cambia — stesso ordine, stesse
// occorrenze, stesso separatore — e la 2.4 lo dichiara: «does not result in any
// technical adjustments for invoicing in Swiss francs». L'unica differenza
// tecnica riguarda l'EURO, per la dismissione di euroSIC. Per un LETTORE le due
// versioni si trattano quindi allo stesso modo, ed è per questo che il modulo
// può dichiarare di supportarle entrambe senza doverle distinguere.
//
// Il giorno in cui una versione cambierà davvero la struttura, i due punti in
// cui intervenire sono `SPEC` e `lineLayout()`: tutto il resto ragiona su un
// oggetto già interpretato (§36/§178).
//
// ⚠️ QUESTO MODULO NON LEGGE IMMAGINI. Riceve il TESTO già decodificato dal
// codice a barre. La decodifica dai pixel non è implementata e il motivo è
// dichiarato in `docs/finance-operations.md`: la pipeline non ha un
// rasterizzatore, e sul percorso dei PDF con testo il file non viene nemmeno
// scaricato lato server. Chiedere a un modello linguistico di «leggere l'IBAN
// dal QR» sarebbe l'esatto contrario di una decodifica deterministica.
//
// ⚠️ E NON ESEGUE NIENTE. Il contenuto di un codice QR è input NON FIDATO
// (§121): qui diventa solo dati: nessun URL da aprire, nessun HTML, nessun
// comando. Le stringhe si troncano alle lunghezze dello standard e i caratteri
// di controllo si rimuovono.
//
// Modulo PORTABILE: funzioni pure, un solo import interno (le cifre di
// controllo), nessuna dipendenza esterna.
// ============================================================================
import {
  checkCreditorReference, checkIban, checkQrReference, compact, isQrIban,
  mod10Recursive, mod97,
} from './checksums.ts';

/**
 * Che cosa questo lettore dichiara di sapere. È l'unico posto in cui una
 * versione dello standard è nominata: se un domani cambia la struttura, si
 * aggiunge qui e si dirama in `lineLayout()`.
 */
export const SPEC = {
  /** Versione delle Implementation Guidelines letta per scrivere questo codice. */
  verifiedVersion: '2.4',
  verifiedOn: '2026-07-27',
  /** Versione in vigore alla data di verifica. */
  inForceVersion: '2.3',
  /** Dalla quale la 2.4 sostituisce la 2.3. */
  nextVersionFrom: '2026-11-14',
  sourceUrl:
    'https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.4-en.pdf',
  /** L'unico valore ammesso per l'intestazione. */
  qrType: 'SPC',
  /** Nella versione principale 02 è ammessa solo questa designazione. */
  version: '0200',
  /** UTF-8 ristretto al latino. */
  coding: '1',
  trailer: 'EPD',
  /** Righe obbligatorie: da «QRType» fino a «Trailer» comprese. */
  minLines: 31,
  /** Con «Billing information» e fino a due procedure alternative. */
  maxLines: 34,
  /** Le uniche ammesse dallo standard: non è una scelta del prodotto. */
  currencies: ['CHF', 'EUR'] as const,
  /**
   * Il tetto di lunghezza del contenuto, separatori compresi (capitolo 6 delle
   * guideline). Oltre, il codice non sarebbe generabile — quindi un testo più
   * lungo non è una QR-fattura, è qualcos'altro che le somiglia.
   */
  maxPayloadChars: 997,
} as const;

export type QrAddressType = 'S' | 'K';

export interface QrAddress {
  /**
   * `S` indirizzo strutturato (l'unico ammesso dalla 2.3 in poi),
   * `K` indirizzo combinato: non più ammesso per le fatture NUOVE, ma le
   * fatture emesse prima restano in circolazione e vanno lette. Rifiutarle
   * significherebbe non saper leggere documenti perfettamente legittimi.
   */
  addressType: QrAddressType | null;
  name: string | null;
  /** Indirizzo strutturato: la via. Combinato: la prima riga per esteso. */
  streetOrLine1: string | null;
  /** Indirizzo strutturato: il numero civico. Combinato: CAP e località. */
  buildingOrLine2: string | null;
  postalCode: string | null;
  town: string | null;
  country: string | null;
}

export type QrReferenceType = 'QRR' | 'SCOR' | 'NON';

export interface SwissQrBill {
  qrType: string;
  version: string;
  coding: string;
  iban: string;
  ibanIsQr: boolean;
  creditor: QrAddress;
  ultimateCreditor: QrAddress;
  /** Stringa decimale così come scritta nel codice, oppure `null` se assente. */
  amount: string | null;
  currency: string;
  ultimateDebtor: QrAddress;
  referenceType: QrReferenceType | null;
  reference: string | null;
  unstructuredMessage: string | null;
  trailer: string;
  billingInformation: string | null;
  alternativeProcedures: string[];
}

/**
 * Codici di violazione. Sono CHIAVI: la frase la scrive l'interfaccia nella
 * lingua di chi legge. Ognuno corrisponde a una regola scritta nelle
 * Implementation Guidelines, non a un'opinione su come dovrebbe essere fatta
 * una fattura.
 */
export type QrIssueCode =
  | 'not_swiss_qr'            // l'intestazione non è «SPC»
  | 'too_few_lines'
  | 'too_many_lines'
  | 'unsupported_version'
  | 'unsupported_coding'
  | 'missing_trailer'
  | 'iban_bad_format'
  | 'iban_bad_checksum'
  | 'iban_country_not_allowed'  // ammessi solo CH e LI
  | 'creditor_name_missing'
  | 'creditor_address_type_invalid'
  | 'creditor_country_missing'
  | 'ultimate_creditor_filled'  // il gruppo deve restare vuoto
  | 'currency_not_allowed'      // solo CHF ed EUR
  | 'amount_invalid'
  | 'amount_out_of_range'
  | 'reference_type_invalid'
  | 'reference_required_for_qr_iban'   // QR-IBAN → deve esserci QRR
  | 'qrr_requires_qr_iban'
  | 'qrr_only_chf'
  | 'reference_bad_checksum'
  | 'reference_bad_format'
  | 'reference_present_with_non'       // con NON il riferimento va lasciato vuoto
  | 'additional_info_too_long';        // Ustrd + StrdBkgInf ≤ 140 in totale

export interface QrIssue {
  code: QrIssueCode;
  /** Il campo interessato, per poterlo indicare a schermo. */
  field?: string;
  /**
   * Una violazione BLOCCANTE rende il contenuto inaffidabile: i dati non vanno
   * usati come fatti. Una non bloccante va dichiarata ma non impedisce la
   * lettura — un indirizzo combinato è fuori standard per le fatture nuove e
   * perfettamente leggibile.
   */
  blocking: boolean;
}

export type QrParseResult =
  | { ok: true; bill: SwissQrBill; issues: QrIssue[] }
  | { ok: false; issues: QrIssue[] };

// ---------------------------------------------------------------------------
// Igiene dell'input
// ---------------------------------------------------------------------------

/**
 * Toglie i caratteri di controllo e taglia alla lunghezza dello standard.
 * Il codice QR è scritto da un terzo: nulla di ciò che contiene deve poter
 * diventare qualcosa di diverso da testo.
 */
function clean(value: string | undefined, maxLength: number): string | null {
  if (value === undefined) return null;
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!stripped) return null;
  return stripped.slice(0, maxLength);
}

/**
 * Dove sta ogni elemento. È l'unico punto che dipende dalla VERSIONE dello
 * standard: la 2.3 e la 2.4 condividono questa disposizione.
 */
function lineLayout() {
  return {
    qrType: 0, version: 1, coding: 2, iban: 3,
    creditor: 4,            // 4..10 — AdrTp, Name, Line1, Line2, PstCd, TwnNm, Ctry
    ultimateCreditor: 11,   // 11..17
    amount: 18, currency: 19,
    ultimateDebtor: 20,     // 20..26
    referenceType: 27, reference: 28,
    unstructuredMessage: 29, trailer: 30,
    billingInformation: 31, alternative: 32,
  };
}

function readAddress(lines: string[], at: number): QrAddress {
  const type = clean(lines[at], 1);
  return {
    addressType: type === 'S' || type === 'K' ? type : type === null ? null : (type as QrAddressType),
    name: clean(lines[at + 1], 70),
    streetOrLine1: clean(lines[at + 2], 70),
    buildingOrLine2: clean(lines[at + 3], 70),
    postalCode: clean(lines[at + 4], 16),
    town: clean(lines[at + 5], 35),
    country: clean(lines[at + 6], 2),
  };
}

function addressIsEmpty(a: QrAddress): boolean {
  return !a.addressType && !a.name && !a.streetOrLine1 && !a.buildingOrLine2
    && !a.postalCode && !a.town && !a.country;
}

/** L'importo secondo lo standard: decimale, punto, due decimali, senza zeri iniziali. */
function checkAmount(raw: string | null, issues: QrIssue[]): string | null {
  if (raw === null) return null;              // l'importo è facoltativo (§ elemento 19)
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) {
    issues.push({ code: 'amount_invalid', field: 'amount', blocking: true });
    return null;
  }
  const value = Number(raw);
  // Da 0.01 a 999'999'999.99, come prescrive la tabella degli elementi.
  if (!(value >= 0.01 && value <= 999_999_999.99)) {
    issues.push({ code: 'amount_out_of_range', field: 'amount', blocking: true });
    return null;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Il lettore
// ---------------------------------------------------------------------------

/**
 * Legge il contenuto testuale di uno Swiss QR Code.
 *
 * ⚠️ NON «AGGIUSTA» NIENTE. Se qualcosa non torna lo dichiara e, se è
 * bloccante, si rifiuta di restituire i dati. Un codice QR letto a metà e
 * presentato come completo sarebbe peggio di un codice non letto: da un lato
 * ci sarebbe un IBAN accanto a un importo, dall'altro nessuno saprebbe che uno
 * dei due non è affidabile.
 */
export function parseSwissQrPayload(payload: string | null | undefined): QrParseResult {
  const issues: QrIssue[] = [];
  const text = String(payload ?? '');
  if (!text.trim()) return { ok: false, issues: [{ code: 'not_swiss_qr', blocking: true }] };

  // §4.1.4 — il ritorno a capo è CR+LF oppure LF, ma dev'essere lo stesso in
  // tutto il documento. Si normalizza in lettura: accettare entrambi non
  // indebolisce nulla, perché la struttura è posizionale.
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // L'ultimo ritorno a capo è eliminato per specifica: una riga vuota finale
  // sarebbe comunque tollerata, ma non deve contare come elemento.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  const L = lineLayout();

  if (clean(lines[L.qrType], 3) !== SPEC.qrType) {
    return { ok: false, issues: [{ code: 'not_swiss_qr', field: 'qrType', blocking: true }] };
  }
  if (lines.length < SPEC.minLines) {
    return { ok: false, issues: [{ code: 'too_few_lines', blocking: true }] };
  }
  if (lines.length > SPEC.maxLines) {
    issues.push({ code: 'too_many_lines', blocking: true });
  }

  const version = clean(lines[L.version], 4) ?? '';
  if (version !== SPEC.version) {
    // ⚠️ NON bloccante, e la scelta è deliberata: una versione futura della
    // versione PRINCIPALE 02 resta leggibile con questa disposizione, e
    // rifiutarla renderebbe il prodotto cieco il giorno dell'aggiornamento
    // invece che semplicemente prudente. Si dichiara e si va avanti.
    issues.push({ code: 'unsupported_version', field: 'version', blocking: false });
  }
  const coding = clean(lines[L.coding], 1) ?? '';
  if (coding !== SPEC.coding) {
    issues.push({ code: 'unsupported_coding', field: 'coding', blocking: false });
  }

  const trailer = clean(lines[L.trailer], 3) ?? '';
  if (trailer !== SPEC.trailer) {
    issues.push({ code: 'missing_trailer', field: 'trailer', blocking: true });
  }

  // ---- Conto -------------------------------------------------------------
  const iban = compact(lines[L.iban]);
  const ibanCheck = checkIban(iban);
  // ⚠️ L'ORDINE DEI CONTROLLI DECIDE IL MESSAGGIO, e il messaggio è metà del
  // valore di questa funzione. Un IBAN tedesco è di 22 caratteri: verificando
  // prima la lunghezza fissa a 21 si otterrebbe «formato non valido», che manda
  // a cercare un refuso di trascrizione. Il problema vero è un altro — su una
  // QR-fattura sono ammessi soltanto conti svizzeri e liechtensteinesi — e va
  // detto per primo.
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) {
    issues.push({ code: 'iban_bad_format', field: 'iban', blocking: true });
  } else if (!['CH', 'LI'].includes(iban.slice(0, 2))) {
    issues.push({ code: 'iban_country_not_allowed', field: 'iban', blocking: true });
  } else if (iban.length !== 21) {
    issues.push({ code: 'iban_bad_format', field: 'iban', blocking: true });
  } else if (!ibanCheck.valid) {
    issues.push({ code: 'iban_bad_checksum', field: 'iban', blocking: true });
  }
  const ibanIsQr = isQrIban(iban);

  // ---- Creditore ---------------------------------------------------------
  const creditor = readAddress(lines, L.creditor);
  if (!creditor.name) {
    issues.push({ code: 'creditor_name_missing', field: 'creditor.name', blocking: true });
  }
  if (creditor.addressType !== 'S' && creditor.addressType !== 'K') {
    issues.push({ code: 'creditor_address_type_invalid', field: 'creditor.addressType', blocking: true });
  }
  if (!creditor.country) {
    issues.push({ code: 'creditor_country_missing', field: 'creditor.country', blocking: false });
  }

  // Il gruppo «creditore finale» è riservato a un uso futuro e non va compilato.
  const ultimateCreditor = readAddress(lines, L.ultimateCreditor);
  if (!addressIsEmpty(ultimateCreditor)) {
    issues.push({ code: 'ultimate_creditor_filled', field: 'ultimateCreditor', blocking: false });
  }

  // ---- Importo e valuta --------------------------------------------------
  const amount = checkAmount(clean(lines[L.amount], 12), issues);
  const currency = (clean(lines[L.currency], 3) ?? '').toUpperCase();
  if (!(SPEC.currencies as readonly string[]).includes(currency)) {
    issues.push({ code: 'currency_not_allowed', field: 'currency', blocking: true });
  }

  const ultimateDebtor = readAddress(lines, L.ultimateDebtor);

  // ---- Riferimento -------------------------------------------------------
  // È la parte in cui gli errori sono più facili e più cari: un riferimento
  // sbagliato manda un pagamento nel posto giusto senza che nessuno lo
  // riconosca, e il fornitore lo solleciterà lo stesso.
  const rawType = (clean(lines[L.referenceType], 4) ?? '').toUpperCase();
  const referenceType: QrReferenceType | null =
    rawType === 'QRR' || rawType === 'SCOR' || rawType === 'NON' ? rawType : null;
  if (referenceType === null) {
    issues.push({ code: 'reference_type_invalid', field: 'referenceType', blocking: true });
  }
  const referenceRaw = clean(lines[L.reference], 27);
  const reference = referenceRaw ? compact(referenceRaw) : null;

  if (referenceType === 'QRR') {
    // Un riferimento QR va usato SOLO con un QR-IBAN: è scritto nella tabella
    // degli elementi ed è ripetuto nelle regole di lettura per i programmi.
    if (!ibanIsQr) issues.push({ code: 'qrr_requires_qr_iban', field: 'reference', blocking: true });
    // ⚠️ «Solo per fatture in CHF» compare nella versione 2.4 e NON nella 2.3,
    // che è quella in vigore. Una fattura in euro con riferimento QR emessa
    // oggi è ancora conforme: segnalarla come errore bloccante vorrebbe dire
    // rifiutare un documento valido in nome di una regola non ancora entrata in
    // vigore. Si dichiara e basta.
    if (currency && currency !== 'CHF') {
      issues.push({ code: 'qrr_only_chf', field: 'reference', blocking: false });
    }
    const check = checkQrReference(reference);
    if (!check.valid) {
      issues.push({
        code: check.error === 'bad_checksum' ? 'reference_bad_checksum' : 'reference_bad_format',
        field: 'reference', blocking: true,
      });
    }
  } else if (referenceType === 'SCOR') {
    const check = checkCreditorReference(reference);
    if (!check.valid) {
      issues.push({
        code: check.error === 'bad_checksum' ? 'reference_bad_checksum' : 'reference_bad_format',
        field: 'reference', blocking: true,
      });
    }
  } else if (referenceType === 'NON') {
    // Con «nessun riferimento» l'elemento deve restare vuoto.
    if (reference) issues.push({ code: 'reference_present_with_non', field: 'reference', blocking: false });
  }

  // Un QR-IBAN senza riferimento QR è un errore del documento: quel conto
  // esiste proprio per essere abbinato a un riferimento.
  if (ibanIsQr && referenceType !== 'QRR') {
    issues.push({ code: 'reference_required_for_qr_iban', field: 'referenceType', blocking: true });
  }

  // ---- Informazioni aggiuntive -------------------------------------------
  const unstructuredMessage = clean(lines[L.unstructuredMessage], 140);
  const billingInformation = clean(lines[L.billingInformation], 140);
  if ((unstructuredMessage?.length ?? 0) + (billingInformation?.length ?? 0) > 140) {
    issues.push({ code: 'additional_info_too_long', field: 'additionalInformation', blocking: false });
  }

  const alternativeProcedures = lines
    .slice(L.alternative, L.alternative + 2)
    .map((l) => clean(l, 100))
    .filter((l): l is string => !!l);

  if (issues.some((i) => i.blocking)) return { ok: false, issues };

  return {
    ok: true,
    issues,
    bill: {
      qrType: SPEC.qrType,
      version,
      coding,
      iban: ibanCheck.normalized,
      ibanIsQr,
      creditor,
      ultimateCreditor,
      amount,
      currency,
      ultimateDebtor,
      referenceType,
      reference,
      unstructuredMessage,
      trailer,
      billingInformation,
      alternativeProcedures,
    },
  };
}

/**
 * L'indirizzo del creditore su una riga sola, per mostrarlo.
 * Rende l'indirizzo strutturato e quello combinato nello stesso modo: chi
 * legge non deve sapere quale forma aveva il codice.
 */
export function formatQrAddress(a: QrAddress): string | null {
  if (a.addressType === 'K') {
    return [a.streetOrLine1, a.buildingOrLine2].filter(Boolean).join(', ') || null;
  }
  const street = [a.streetOrLine1, a.buildingOrLine2].filter(Boolean).join(' ');
  const place = [a.postalCode, a.town].filter(Boolean).join(' ');
  return [street, place, a.country].filter(Boolean).join(', ') || null;
}

// ---------------------------------------------------------------------------
// La scrittrice
//
// ⚠️ LA GARANZIA È LA RILETTURA. Qui non esce NULLA che il lettore di questo
// stesso file non accetterebbe: ogni payload generato passa per
// `parseSwissQrPayload` prima di essere restituito, e una segnalazione —
// anche non bloccante — fa fallire la generazione. Chi chiama riceve un
// testo che un lettore conforme legge, per costruzione.
//
// Le scelte di forma sono fisse, le decide lo standard e non chi chiama:
//   · indirizzi SEMPRE strutturati ('S'): la variante combinata 'K' resta
//     leggibile perché le fatture vecchie girano ancora, ma non va più EMESSA
//     (fuori standard per le fatture nuove dalla 2.3);
//   · il gruppo «creditore finale» resta vuoto: è riservato a un uso futuro;
//   · nessuna «billing information» e nessuna procedura alternativa: il
//     payload è di 31 righe esatte (`SPEC.minLines`) e chiude con «EPD»,
//     SENZA riga vuota finale — il lettore la elimina per specifica, quindi
//     in scrittura non la si mette;
//   · separatore CR+LF: il lettore accetta anche LF per tolleranza, ma lo
//     standard chiede CR+LF e in scrittura si segue lo standard.
//
// Le posizioni NON sono riscritte qui: la disposizione sta in `lineLayout()`,
// unica fonte per chi legge e per chi scrive.
// ---------------------------------------------------------------------------

export interface SwissQrPartyInput {
  name: string;
  street?: string;
  buildingNumber?: string;
  postalCode: string;
  city: string;
  countryCode: string;
}

export interface SwissQrInput {
  iban: string;
  creditor: SwissQrPartyInput;
  /**
   * Stringa decimale con il punto, mai separatori delle migliaia.
   * Omesso, l'importo resta vuoto: è un elemento facoltativo.
   */
  amount?: string;
  currency: 'CHF' | 'EUR';
  debtor?: SwissQrPartyInput;
  referenceType: QrReferenceType;
  reference?: string;
  message?: string;
}

/**
 * Un campo in scrittura: vuoto se facoltativo e assente, rifiutato se troppo
 * lungo o se contiene caratteri di controllo — il lettore li rimuoverebbe in
 * silenzio, e un dato che cambia fra la mano che scrive e quella che legge è
 * un errore, non un dettaglio. Il nome del campo finisce nell'errore: è ciò
 * che l'interfaccia deve poter indicare.
 */
function writeField(value: string | undefined, field: string, maxLength: number, required: boolean): string {
  const text = (value ?? '').trim();
  if (!text) {
    if (required) throw new Error(`Campo obbligatorio mancante: ${field}`);
    return '';
  }
  if (text.length > maxLength) {
    throw new Error(`Campo troppo lungo: ${field} (max ${maxLength} caratteri)`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(text)) {
    throw new Error(`Campo con caratteri di controllo: ${field}`);
  }
  return text;
}

/** ISO 3166-1 alpha-2: due lettere maiuscole. Si normalizza, come l'IBAN. */
function writeCountry(value: string, field: string): string {
  const code = writeField(value, field, 2, true).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new Error(`Codice paese non valido: ${field} (servono 2 lettere)`);
  }
  return code;
}

/** Le sette righe di un indirizzo strutturato, nell'ordine dello standard. */
function writeAddress(party: SwissQrPartyInput, who: string): string[] {
  return [
    'S',
    writeField(party.name, `${who}.name`, 70, true),
    writeField(party.street, `${who}.street`, 70, false),
    // Al civico lo standard dà 16 caratteri; il lettore taglia a 70 perché
    // quella posizione ospita anche la seconda riga degli indirizzi 'K'.
    writeField(party.buildingNumber, `${who}.buildingNumber`, 16, false),
    writeField(party.postalCode, `${who}.postalCode`, 16, true),
    writeField(party.city, `${who}.city`, 35, true),
    writeCountry(party.countryCode, `${who}.countryCode`),
  ];
}

/**
 * L'importo in scrittura è la stessa regola del lettore (`checkAmount`):
 * cifre, punto decimale, al massimo due decimali, da 0.01 a 999'999'999.99.
 */
function writeAmount(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return '';
  const amount = raw.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount)) {
    throw new Error(`Importo non valido: amount (decimale con il punto, senza separatori delle migliaia)`);
  }
  const value = Number(amount);
  if (!(value >= 0.01 && value <= 999_999_999.99)) {
    throw new Error(`Importo fuori intervallo: amount (da 0.01 a 999999999.99)`);
  }
  return amount;
}

/**
 * Compone il contenuto testuale di uno Swiss QR Code e lo valida rileggendolo.
 *
 * Ogni violazione delle regole dello standard è un Error con il NOME del
 * campo e della regola violata: una fattura sbagliata non si emette, perché
 * il rifiuto arriverebbe comunque — dalla banca, dopo l'invio.
 */
export function buildSwissQrPayload(input: SwissQrInput): string {
  const iban = compact(input.iban);
  const ibanCheck = checkIban(iban);
  if (!ibanCheck.valid) {
    throw new Error(`IBAN non valido: iban (${ibanCheck.error})`);
  }

  const currency = input.currency;
  if (!(SPEC.currencies as readonly string[]).includes(currency)) {
    throw new Error(`Valuta non ammessa: currency (solo ${SPEC.currencies.join(' e ')})`);
  }
  const amount = writeAmount(input.amount);

  // Conto e riferimento si decidono a vicenda: l'incrocio lo impone lo
  // standard, e il lettore lo controlla — qui lo si impedisce in partenza.
  const reference = compact(input.reference ?? '');
  switch (input.referenceType) {
    case 'QRR': {
      if (!isQrIban(iban)) {
        throw new Error('Un riferimento QRR richiede un QR-IBAN: reference (qrr_requires_qr_iban)');
      }
      // In lettura «QRR solo in CHF» è oggi una segnalazione non bloccante,
      // perché la regola è della 2.4 e non ancora in vigore. In SCRITTURA si
      // segue già la 2.4: una fattura nuova in euro con riferimento QR non
      // va emessa.
      if (currency !== 'CHF') {
        throw new Error('Un riferimento QRR si emette solo in CHF: currency (qrr_only_chf)');
      }
      if (!checkQrReference(reference).valid) {
        throw new Error('Riferimento QRR non valido: reference (27 cifre, l\u2019ultima di controllo)');
      }
      break;
    }
    case 'SCOR': {
      if (!checkCreditorReference(reference).valid) {
        throw new Error('Riferimento SCOR non valido: reference (ISO 11649, «RF» + controllo)');
      }
      break;
    }
    case 'NON': {
      if (reference) {
        throw new Error('Con riferimento «NON» il campo resta vuoto: reference (reference_present_with_non)');
      }
      break;
    }
    default:
      throw new Error(`Tipo di riferimento non ammesso: referenceType («${String(input.referenceType)}»)`);
  }

  const message = writeField(input.message, 'message', 140, false);
  const creditor = writeAddress(input.creditor, 'creditor');
  const debtor = input.debtor
    ? writeAddress(input.debtor, 'debtor')
    : ['', '', '', '', '', '', ''];

  const L = lineLayout();
  const lines: string[] = new Array(L.trailer + 1).fill('');
  lines[L.qrType] = SPEC.qrType;
  lines[L.version] = SPEC.version;
  lines[L.coding] = SPEC.coding;
  lines[L.iban] = iban;
  creditor.forEach((value, i) => { lines[L.creditor + i] = value; });
  // L.ultimateCreditor..+6 restano vuote: il gruppo è riservato.
  lines[L.amount] = amount;
  lines[L.currency] = currency;
  debtor.forEach((value, i) => { lines[L.ultimateDebtor + i] = value; });
  lines[L.referenceType] = input.referenceType;
  lines[L.reference] = reference;
  lines[L.unstructuredMessage] = message;
  lines[L.trailer] = SPEC.trailer;

  const payload = lines.join('\r\n');
  // Il tetto lo pone il codice, non il lettore: oltre, il QR non sarebbe
  // generabile e si produrrebbe un testo che nessuno può stampare.
  if (payload.length > SPEC.maxPayloadChars) {
    throw new Error(`Payload troppo lungo: ${payload.length} caratteri oltre il tetto di ${SPEC.maxPayloadChars}`);
  }

  // La garanzia di cui sopra: ciò che il lettore di questo stesso modulo
  // segnala — anche senza bloccare — non esce da qui.
  const riletto = parseSwissQrPayload(payload);
  if (!riletto.ok || riletto.issues.length > 0) {
    const codici = riletto.issues.map((i) => i.code).join(', ');
    throw new Error(`Il payload generato non supera la rilettura: ${codici}`);
  }
  return payload;
}

/**
 * Il riferimento di pagamento di una fattura emessa, derivato dal suo numero.
 *
 * È il CONTO a decidere il tipo, mai chi chiama: su un QR-IBAN va il
 * riferimento QR (27 cifre, controllo modulo 10 ricorsivo), sugli altri il
 * riferimento creditore ISO 11649 («RF» + due cifre di controllo). Scegliere
 * diversamente produrrebbe un documento che il lettore rifiuta.
 */
export function generatePaymentReference(
  invoiceNumber: string,
  iban: string,
): { referenceType: 'QRR' | 'SCOR'; reference: string } {
  const digits = String(invoiceNumber ?? '').replace(/\D/g, '');
  if (!digits) {
    throw new Error('Numero di fattura senza cifre: non se ne può derivare un riferimento');
  }

  if (isQrIban(iban)) {
    // 26 cifre di corpo + una di controllo. Se il numero è più lungo si
    // tengono le cifre FINALI: sono quelle che cambiano da fattura a fattura.
    const body = digits.length > 26 ? digits.slice(-26) : digits.padStart(26, '0');
    const check = mod10Recursive(body);
    if (check === null) {
      throw new Error('Corpo del riferimento QRR non numerico');
    }
    const reference = `${body}${check}`;
    if (!checkQrReference(reference).valid) {
      throw new Error('Il riferimento QRR generato non supera il proprio controllo');
    }
    return { referenceType: 'QRR', reference };
  }

  // ISO 11649: si porta «RF00» in coda, si convertono le lettere in cifre e
  // il controllo è il complemento a 98 del resto modulo 97. L'aritmetica è
  // quella di `checksums.ts`: la stessa che poi verifica.
  const rearranged = `${digits}RF00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const check = String(98 - mod97(rearranged)).padStart(2, '0');
  const reference = `RF${check}${digits}`;
  const selfCheck = checkCreditorReference(reference);
  if (!selfCheck.valid) {
    throw new Error(`Il riferimento SCOR generato non supera il proprio controllo (${selfCheck.error})`);
  }
  return { referenceType: 'SCOR', reference };
}
