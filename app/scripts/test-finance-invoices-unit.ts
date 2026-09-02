// ============================================================================
// Fatture emesse (0053) — prove OFFLINE del payload QR, del PDF e del
// contratto di sicurezza.
//   npm run test:finance-invoices-unit
//   npm run test:finance-invoices-unit -- --sample  (scrive output/pdf/… per QA)
//
// ⚠️ SI ESEGUE SENZA `--env-file`, E NON È UNA DIMENTICANZA: nessuna rete,
// nessuna credenziale. Il codice provato è QUELLO VERo — `qrbill.ts` e
// `invoice-pdf.ts` sono gli stessi file che girano nella Edge Function, e il
// PNG del QR è reso con le STESSE opzioni di `generate-finance-invoice`
// (errorCorrectionLevel M, margin 0, scale 4: la sezione 6 lo assicura
// rileggendo il sorgente della funzione).
//
// LE GARANZIE PROVATE, NELL'ORDINE DELLE SEZIONI:
//   1. IL PAYLOAD SIX: SCOR/QRR/NON sui conti giusti, 31 righe, chiusura EPD
//      senza riga vuota, tetto di 997 caratteri — e ogni regola di scrittura
//      SA FALLIRE (QRR in euro, QRR su IBAN normale, IBAN storto, importo con
//      separatore delle migliaia, campi oltre misura);
//   2. IL RIFERIMENTO DI PAGAMENTO: il vettore ISO 11649 noto, il numero
//      F-000012 ancorato a un valore FISSO (non ricalcolato dal codice sotto
//      prova), la via QRR a 27 cifre, il determinismo;
//   3. IL PDF NELLE TRE LINGUE: testo ESTRATTO con pdfjs — «pdf.save() non ha
//      sollevato» non prova che il documento contenga numero, importi, polizza
//      e fonte IVA. Ogni pagina è A4 e dichiara «Pagina x / y»;
//   4. IL QR DECODIFICATO: non «c'è un'immagine» — il PNG viene DECODIFICATO
//      (pngjs + jsQR) e il testo deve essere IDENTICO al payload, sia in
//      partenza sia dentro il PDF finale, dove l'immagine viene estratta con
//      pdf-lib e riletta pixel per pixel;
//   5. NOTA DI CREDITO E SOLLECITO: documenti contabili SENZA polizza di
//      pagamento — l'assenza delle etichette «Ricevuta»/«Parte di pagamento»
//      è asserita, non supposta;
//   6. IL CONTRATTO SORGENTE: le garanzie delle migrazioni 0053/0054 e delle
//      due Edge Function, lette dai file — se il sorgente le perde, qui
//      diventa rosso;
//   7. --sample: tre PDF (fattura, nota di credito, sollecito) per il QA visivo.
//
// ⚠️ OGNI SEZIONE CONTIENE ALMENO UNA CONTROPROVA: un caso che DEVE fallire.
// Un test che non sa fallire non è un test, è una rassicurazione.
// ============================================================================
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as QRCode from 'qrcode';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  buildSwissQrPayload, generatePaymentReference, parseSwissQrPayload, SPEC,
  type SwissQrInput,
} from '../supabase/functions/_shared/finance/qrbill.ts';
import {
  checkCreditorReference, checkQrReference,
} from '../supabase/functions/_shared/finance/checksums.ts';
import { TABS } from '../src/features/finance/financeModel.ts';
import {
  createInvoicePdf, invoiceDocumentWord,
  type InvoiceLanguage, type InvoicePdfInput,
} from '../supabase/functions/_shared/finance/invoice-pdf.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function ok(condition: boolean, label: string, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? `\n    ${detail}` : ''}`); }
}

/** Una chiamata che DEVE sollevare, con un frammento d'errore riconoscibile. */
function expectThrow(label: string, needle: string, fn: () => unknown) {
  let message = '';
  try { fn(); } catch (error) { message = String(error); }
  ok(message.includes(needle), label, message ? `errore: ${message}` : 'nessun errore sollevato');
}

// IBAN normale e QR-IBAN, entrambi con cifra di controllo valida (sono nella
// matrice IBAN di test-finance.ts, sezione 13).
const IBAN = 'CH9300762011623852957';
const QR_IBAN = 'CH4431999123000889012';
const VAT_SOURCE = 'https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-steuersaetze.html';

const CREDITOR = {
  name: 'Ai-Swisse SA', street: 'Via Centrale', buildingNumber: '1',
  postalCode: '6900', city: 'Lugano', countryCode: 'CH',
};
const DEBTOR = {
  name: 'Cliente Esempio SA', street: 'Rue du Lac', buildingNumber: '8',
  postalCode: '1201', city: 'Genève', countryCode: 'CH',
};

function qrInput(over: Partial<SwissQrInput> = {}): SwissQrInput {
  return {
    iban: IBAN, creditor: CREDITOR, amount: '267.50', currency: 'CHF',
    debtor: DEBTOR, referenceType: 'SCOR', reference: 'RF18539007547034',
    message: 'Fattura F-000001', ...over,
  };
}

/** Il PNG dello Swiss QR Code, con le STESSE opzioni della Edge Function. */
async function renderQrPng(payload: string): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 0, scale: 4 });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** La decodifica vera dei pixel: pngjs scomprime, jsQR legge il codice. */
function decodeQrPng(bytes: Uint8Array): string | null {
  const png = PNG.sync.read(Buffer.from(bytes));
  const pixels = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  return jsQR(pixels, png.width, png.height)?.data ?? null;
}

/**
 * L'immagine QR ESTRATTA dal PDF finale e riletta: pdf-lib la incorpora come
 * XObject /DeviceRGB a 8 bit con FlateDecode (verificato sperimentalmente il
 * 2026-09-02: nessun byte di filtro per riga). Se un domani l'incorporazione
 * cambiasse forma, qui si dichiara «non trovata» invece di tacere.
 */
async function decodeQrFromPdf(bytes: Uint8Array): Promise<{ images: number; decoded: string | null }> {
  const doc = await PDFDocument.load(bytes);
  let images = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.lookup(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    images += 1;
    const width = Number(dict.lookup(PDFName.of('Width'))?.toString());
    const height = Number(dict.lookup(PDFName.of('Height'))?.toString());
    const bits = Number(dict.lookup(PDFName.of('BitsPerComponent'))?.toString());
    const colorSpace = dict.lookup(PDFName.of('ColorSpace'))?.toString();
    if (!width || !height || bits !== 8 || colorSpace !== '/DeviceRGB') continue;
    const raw = decodePDFRawStream(obj).decode();
    if (raw.length !== width * height * 3) continue;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
      rgba[j] = raw[i]; rgba[j + 1] = raw[i + 1]; rgba[j + 2] = raw[i + 2]; rgba[j + 3] = 255;
    }
    const decoded = jsQR(rgba, width, height)?.data;
    if (decoded) return { images, decoded };
  }
  return { images, decoded: null };
}

async function inspect(bytes: Uint8Array) {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages: Array<{ width: number; height: number; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      width: viewport.width, height: viewport.height,
      text: content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
    });
  }
  return { pageCount: doc.numPages, pages, text: pages.map((page) => page.text).join(' ') };
}

// ---------------------------------------------------------------------------
// La fattura di riferimento: due voci con aliquote diverse, stringhe decimali.
// ---------------------------------------------------------------------------
function fixtureInvoice(language: InvoiceLanguage, rows = 2): InvoicePdfInput {
  const base = [
    {
      lineNumber: 1, description: 'Consulenza strategica e configurazione iniziale',
      quantity: '2.000', unitPrice: '100.00', vatRate: '8.1',
      vatSourceUrl: VAT_SOURCE,
      vatSourceTitle: 'Eidgenössische Steuerverwaltung — Schweizer Mehrwertsteuersätze',
      vatCheckedAt: '2026-07-27', netAmount: '200.00', vatAmount: '16.20', totalAmount: '216.20',
    },
    {
      lineNumber: 2, description: 'Materiale editoriale', quantity: '1.000',
      unitPrice: '50.00', vatRate: '2.6', vatSourceUrl: VAT_SOURCE,
      vatSourceTitle: 'Eidgenössische Steuerverwaltung — Schweizer Mehrwertsteuersätze',
      vatCheckedAt: '2026-07-27', netAmount: '50.00', vatAmount: '1.30', totalAmount: '51.30',
    },
  ];
  const items = rows === 2 ? base : Array.from({ length: rows }, (_, index) => ({
    ...base[0], lineNumber: index + 1,
    description: `Voce ${index + 1}: consulenza con una descrizione sufficientemente lunga per verificare a capo e paginazione`,
  }));
  const reference = generatePaymentReference('F-000001', IBAN);
  return {
    invoiceNumber: 'F-000001', language, currency: 'CHF',
    issuedOn: '2026-08-31', dueDate: '2026-09-30',
    title: language === 'de' ? 'Digitale Beratung' : language === 'fr' ? 'Conseil numérique' : 'Consulenza digitale',
    notes: 'Pagamento entro trenta giorni.',
    // Stringhe decimali ESATTE anche sul multipagina: niente virgola mobile
    // (34 * 16.2 in JS fa 550.8000000000001, che lo standard QR rifiuta).
    subtotal: rows === 2 ? '250.00' : (rows * 200).toFixed(2),
    vatTotal: rows === 2 ? '17.50' : (rows * 162 / 10).toFixed(2),
    total: rows === 2 ? '267.50' : (rows * 2162 / 10).toFixed(2),
    company: {
      legalName: 'Ai-Swisse SA', uidChe: 'CHE-123.456.789', street: 'Via Centrale 1',
      postalCode: '6900', city: 'Lugano', countryCode: 'CH', bankIban: IBAN,
    },
    customer: {
      displayName: 'Cliente Esempio SA', street: 'Rue du Lac 8',
      postalCode: '1201', city: 'Genève', countryCode: 'CH',
    },
    items, kind: 'invoice',
    referenceType: reference.referenceType, reference: reference.reference,
  };
}

/** Il percorso d'integrazione VERO usato dalla funzione: riferimento dal
 *  numero + conto, payload SIX, PNG con le opzioni della Edge Function. */
async function qrFor(input: InvoicePdfInput) {
  const payment = generatePaymentReference(input.invoiceNumber, String(input.company.bankIban));
  const payload = buildSwissQrPayload({
    iban: String(input.company.bankIban),
    creditor: CREDITOR,
    amount: String(input.total),
    currency: 'CHF',
    debtor: DEBTOR,
    referenceType: payment.referenceType,
    reference: payment.reference,
    message: `${invoiceDocumentWord(input.language, 'invoice')} ${input.invoiceNumber}`,
  });
  return { payment, payload, png: await renderQrPng(payload) };
}

console.log('Fatture emesse — QR, PDF e contratto offline\n');

// ============================================================================
console.log('1 · Il payload SIX: forme ammesse e rifiuti obbligati');
// ============================================================================
{
  const payload = buildSwissQrPayload(qrInput());
  ok(checkCreditorReference('RF18539007547034').valid, 'il riferimento SCOR della fixture è un ISO 11649 valido');
  const lines = payload.split('\r\n');
  ok(lines.length === SPEC.minLines && lines.length === 31, 'il payload ha esattamente 31 righe', `righe ${lines.length}`);
  ok(payload.endsWith(SPEC.trailer) && !payload.endsWith('\n'),
    'chiude con EPD senza riga vuota finale');
  ok(payload.length <= SPEC.maxPayloadChars && SPEC.maxPayloadChars === 997,
    'resta entro il tetto di 997 caratteri dello standard', `lunghezza ${payload.length}`);
  const parsed = parseSwissQrPayload(payload);
  ok(parsed.ok && parsed.issues.length === 0, 'la rilettura non trova alcuna violazione',
    parsed.ok ? parsed.issues.map((i) => i.code).join(', ') : 'non leggibile');
  if (parsed.ok) {
    ok(parsed.bill.amount === '267.50' && parsed.bill.currency === 'CHF',
      'importo e valuta fanno il giro intatti', `${parsed.bill.amount} ${parsed.bill.currency}`);
    ok(parsed.bill.iban === IBAN && !parsed.bill.ibanIsQr, 'l’IBAN è riconosciuto come conto normale');
    ok(parsed.bill.referenceType === 'SCOR' && parsed.bill.reference === 'RF18539007547034',
      'tipo e riferimento sopravvivono alla lettura');
    ok(parsed.bill.creditor.name === 'Ai-Swisse SA' && parsed.bill.ultimateDebtor.name === 'Cliente Esempio SA',
      'creditore e debitore sono nelle posizioni dello standard');
  }

  const qrr = generatePaymentReference('F-000007', QR_IBAN);
  const qrPayload = buildSwissQrPayload(qrInput({
    iban: QR_IBAN, referenceType: 'QRR', reference: qrr.reference,
  }));
  const qrParsed = parseSwissQrPayload(qrPayload);
  ok(qrParsed.ok && qrParsed.bill.ibanIsQr && qrParsed.bill.referenceType === 'QRR'
    && /^[0-9]{27}$/.test(qrParsed.bill.reference ?? '') && checkQrReference(qrParsed.bill.reference).valid,
    'su QR-IBAN il riferimento è un QRR di 27 cifre con controllo valido');

  const non = parseSwissQrPayload(buildSwissQrPayload(qrInput({ referenceType: 'NON', reference: undefined })));
  ok(non.ok && non.bill.referenceType === 'NON' && non.bill.reference === null,
    'la forma «senza riferimento» lascia il campo vuoto');

  const senzaDebitore = parseSwissQrPayload(buildSwissQrPayload(qrInput({ debtor: undefined })));
  ok(senzaDebitore.ok && senzaDebitore.bill.ultimateDebtor.name === null
    && senzaDebitore.bill.ultimateDebtor.addressType === null,
    'il debitore si può omettere: il gruppo resta vuoto');

  const euro = parseSwissQrPayload(buildSwissQrPayload(qrInput({ currency: 'EUR' })));
  ok(euro.ok && euro.bill.currency === 'EUR', 'lo SCOR in euro è ammesso dallo standard');

  // ---- CONTROPROVE: ogni rifiuto DEVE scattare, col suo motivo ------------
  expectThrow('un QRR in euro non si emette (regola 2.4, già applicata in scrittura)',
    'qrr_only_chf', () => buildSwissQrPayload(qrInput({ iban: QR_IBAN, referenceType: 'QRR', reference: qrr.reference, currency: 'EUR' })));
  expectThrow('un QRR su IBAN normale viene rifiutato',
    'qrr_requires_qr_iban', () => buildSwissQrPayload(qrInput({ referenceType: 'QRR', reference: qrr.reference })));
  expectThrow('un IBAN con cifra di controllo sbagliata viene rifiutato',
    'IBAN non valido', () => buildSwissQrPayload(qrInput({ iban: 'CH9300762011623852958' })));
  expectThrow('l’importo con separatore delle migliaia viene rifiutato',
    'Importo non valido', () => buildSwissQrPayload(qrInput({ amount: "1'250.50" })));
  expectThrow('un nome di 71 caratteri non entra nel codice',
    'Campo troppo lungo: creditor.name', () => buildSwissQrPayload(qrInput({ creditor: { ...CREDITOR, name: 'N'.repeat(71) } })));
  expectThrow('un messaggio di 141 caratteri non entra nel codice',
    'Campo troppo lungo: message', () => buildSwissQrPayload(qrInput({ message: 'm'.repeat(141) })));
  expectThrow('un codice paese che non è ISO alpha-2 viene rifiutato',
    'Codice paese non valido', () => buildSwissQrPayload(qrInput({ creditor: { ...CREDITOR, countryCode: 'C1' } })));
}

// ============================================================================
console.log('\n2 · Il riferimento di pagamento: ISO 11649, QRR, determinismo');
// ============================================================================
{
  // Le cifre di controllo ISO 11649, ricalcolate QUI con un'aritmetica
  // indipendente (BigInt invece del mod97 a blocchi): due implementazioni che
  // divergono si smascherano a vicenda, e il valore FISSO le ancora entrambe.
  const rfIndependent = (body: string) => {
    const rearranged = `${body}RF00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    return String(98 - Number(BigInt(rearranged) % 97n)).padStart(2, '0');
  };

  const vettore = generatePaymentReference('539007547034', IBAN);
  ok(vettore.referenceType === 'SCOR' && vettore.reference === 'RF18539007547034',
    'il vettore ISO 11649 noto: corpo 539007547034 → RF18539007547034', vettore.reference);
  ok(rfIndependent('539007547034') === '18', 'l’aritmetica indipendente conferma le cifre 18');
  ok(checkCreditorReference(vettore.reference).valid, 'il riferimento generato supera la propria verifica');

  const dodici = generatePaymentReference('F-000012', IBAN);
  ok(dodici.reference === 'RF68000012',
    'F-000012 produce il riferimento atteso RF68000012 (valore ancorato)', dodici.reference);
  ok(dodici.reference === `RF${rfIndependent('000012')}000012`,
    'e coincide col ricalcolo indipendente');
  ok(checkCreditorReference(dodici.reference).valid, 'anche questo supera la verifica ISO 11649');

  const qrr = generatePaymentReference('F-000012', QR_IBAN);
  ok(qrr.referenceType === 'QRR' && /^[0-9]{27}$/.test(qrr.reference),
    'su QR-IBAN nasce un riferimento di 27 cifre', qrr.reference);
  ok(checkQrReference(qrr.reference).valid,
    'l’ultima cifra è il modulo 10 ricorsivo del corpo');
  ok(qrr.reference.startsWith('00000000000000000000000012'),
    'il corpo porta le cifre finali del numero di fattura', qrr.reference);

  ok(generatePaymentReference('F-000012', IBAN).reference === dodici.reference
    && generatePaymentReference('F-000012', QR_IBAN).reference === qrr.reference,
    'stesso numero, stesso riferimento: la generazione è deterministica');
  ok(generatePaymentReference('F-000013', IBAN).reference !== dodici.reference
    && generatePaymentReference('F-000013', QR_IBAN).reference !== qrr.reference,
    'numeri diversi producono riferimenti diversi');
  // CONTROPROVA: un numero SENZA cifre non può diventare un riferimento.
  expectThrow('un numero di fattura senza cifre viene rifiutato',
    'senza cifre', () => generatePaymentReference('F-ABCDEF', IBAN));
}

// ============================================================================
console.log('\n3 · Il PDF della fattura nelle tre lingue, testo estratto');
// ============================================================================
const expectedLabels: Record<InvoiceLanguage, { doc: string; receipt: string; paymentPart: string; checked: string }> = {
  it: { doc: 'Fattura', receipt: 'Ricevuta', paymentPart: 'Parte di pagamento', checked: 'verificata il' },
  de: { doc: 'Rechnung', receipt: 'Empfangsschein', paymentPart: 'Zahlteil', checked: 'geprüft am' },
  fr: { doc: 'Facture', receipt: 'Récépissé', paymentPart: 'Section paiement', checked: 'vérifiée le' },
};
const pdfByLanguage = new Map<InvoiceLanguage, { bytes: Uint8Array; payload: string }>();
for (const language of ['it', 'de', 'fr'] as const) {
  const input = fixtureInvoice(language);
  const qr = await qrFor(input);
  const pdf = await createInvoicePdf(input, null, null, qr.png);
  pdfByLanguage.set(language, { bytes: pdf, payload: qr.payload });
  const parsed = await inspect(pdf);
  const expected = expectedLabels[language];
  const groupedReference = String(input.reference).replace(/(.{4})/g, '$1 ').trim();

  ok(pdf.byteLength > 4_000, `${language}: produce un PDF non vuoto`);
  ok(parsed.text.includes(expected.doc) && parsed.text.includes('F-000001'),
    `${language}: parola del documento e numero nel testo estratto`, parsed.text.slice(0, 300));
  ok(parsed.text.includes('Ai-Swisse SA') && parsed.text.includes('Cliente Esempio SA'),
    `${language}: conserva emittente e destinatario`);
  ok(parsed.text.includes('267.50') && parsed.text.includes('CHF'),
    `${language}: stampa totale e valuta`, parsed.text.slice(-400));
  ok(parsed.text.includes('estv.admin.ch') && parsed.text.includes(expected.checked),
    `${language}: dichiara fonte e data di verifica delle aliquote IVA`);
  ok(parsed.text.includes(expected.receipt) && parsed.text.includes(expected.paymentPart),
    `${language}: la polizza ha ricevuta e parte di pagamento nella lingua del documento`);
  ok(parsed.text.includes('CH93 0076'), `${language}: l’IBAN è stampato a gruppi di quattro`);
  ok(parsed.text.includes(groupedReference),
    `${language}: il riferimento di pagamento è sulla polizza`, groupedReference);
}

{
  const input = fixtureInvoice('it', 34);
  const qr = await qrFor(input);
  const parsed = await inspect(await createInvoicePdf(input, null, null, qr.png));
  ok(parsed.pageCount >= 2, 'una fattura lunga crea più pagine', `pagine ${parsed.pageCount}`);
  ok(parsed.pages.every((page) => Math.abs(page.width - 595.28) < 0.2
    && Math.abs(page.height - 841.89) < 0.2), 'ogni pagina conserva il formato A4');
  ok(parsed.pages.every((page, index) => page.text.includes(`Pagina ${index + 1} / ${parsed.pageCount}`)),
    'ogni pagina espone una paginazione verificabile');
  ok(parsed.text.includes('Voce 34:'), 'l’ultima voce non viene persa nel cambio pagina');
  ok(parsed.pages[parsed.pageCount - 1].text.includes('Ricevuta')
    && parsed.pages[parsed.pageCount - 1].text.includes('Parte di pagamento'),
    'la polizza di pagamento chiude l’ultima pagina');
}

// ============================================================================
console.log('\n4 · Il QR DECODIFICATO: dai pixel al payload, anche dentro il PDF');
// ============================================================================
{
  const input = fixtureInvoice('it');
  const { payment, payload, png } = await qrFor(input);

  const decoded = decodeQrPng(png);
  ok(decoded === payload, 'il PNG decodificato è IDENTICO al payload SIX',
    decoded === null ? 'jsQR non legge il codice' : `diverso: ${decoded?.slice(0, 80)}…`);
  const bill = parseSwissQrPayload(decoded);
  ok(bill.ok, 'il testo decodificato si rilegge come QR-fattura');
  if (bill.ok) {
    ok(bill.bill.iban === IBAN, 'decodificato: IBAN corretto');
    ok(bill.bill.amount === '267.50' && bill.bill.currency === 'CHF', 'decodificato: importo e valuta');
    ok(bill.bill.referenceType === payment.referenceType && bill.bill.reference === payment.reference,
      'decodificato: tipo e riferimento di pagamento');
    ok(bill.bill.creditor.name === 'Ai-Swisse SA' && bill.bill.ultimateDebtor.name === 'Cliente Esempio SA',
      'decodificato: creditore e debitore');
    ok(bill.bill.trailer === 'EPD', 'decodificato: chiusura EPD');
  }

  // CONTROPROVA: un QR generato da un ALTRO payload non deve risultare uguale,
  // altrimenti il confronto sopra non starebbe provando niente.
  const altro = decodeQrPng(await renderQrPng(buildSwissQrPayload(qrInput({ amount: '1.00', message: 'Fattura F-999999' }))));
  ok(altro !== null && altro !== payload, 'un QR diverso decodifica un testo diverso: il confronto morde');

  // DENTRO IL PDF: l'immagine incorporata viene estratta con pdf-lib e
  // decodificata pixel per pixel. Non «c'è un'immagine»: QUEL testo, lì dentro.
  const inPdf = await decodeQrFromPdf(pdfByLanguage.get('it')!.bytes);
  ok(inPdf.images >= 1, 'il PDF contiene l’immagine del codice QR', `immagini ${inPdf.images}`);
  ok(inPdf.decoded === payload, 'il QR DENTRO IL PDF decodifica lo stesso payload SIX',
    inPdf.decoded === null ? 'immagine estratta ma non decodificabile' : `diverso: ${inPdf.decoded?.slice(0, 80)}…`);
}

// ============================================================================
console.log('\n5 · Nota di credito e sollecito: documenti contabili, niente polizza');
// ============================================================================
{
  const base = fixtureInvoice('it');
  const creditNote = await inspect(await createInvoicePdf({
    ...base, kind: 'credit_note', creditNoteNumber: 'NC-000001',
    creditReason: 'Errore di fatturazione: doppio addebito',
  }));
  ok(creditNote.text.includes('Nota di credito') && creditNote.text.includes('NC-000001'),
    'la nota di credito porta il proprio numero NC', creditNote.text.slice(0, 300));
  ok(creditNote.text.includes('Fattura originale') && creditNote.text.includes('F-000001'),
    'e dichiara la fattura che storna');
  ok(creditNote.text.includes('doppio addebito'), 'e il motivo dell’annullo');
  ok(!creditNote.text.includes('Ricevuta') && !creditNote.text.includes('Parte di pagamento'),
    'CONTROPROVA: sulla nota di credito la polizza NON c’è');

  const reminderWords: Record<InvoiceLanguage, { doc: string; due: string; receipt: string }> = {
    it: { doc: '2° sollecito', due: 'Importo dovuto', receipt: 'Ricevuta' },
    de: { doc: '2. Zahlungserinnerung', due: 'Offener Betrag', receipt: 'Empfangsschein' },
    fr: { doc: '2e rappel', due: 'Montant dû', receipt: 'Récépissé' },
  };
  for (const language of ['it', 'de', 'fr'] as const) {
    const reminder = await inspect(await createInvoicePdf({
      ...fixtureInvoice(language), kind: 'reminder', level: 2,
    }));
    const expected = reminderWords[language];
    ok(reminder.text.includes(expected.doc), `${language}: il sollecito si intitola col suo livello`,
      reminder.text.slice(0, 300));
    ok(reminder.text.includes(expected.due) && reminder.text.includes('267.50'),
      `${language}: dichiara l’importo dovuto`);
    ok(!reminder.text.includes(expected.receipt),
      `${language}: CONTROPROVA — nessuna polizza sul sollecito`);
  }

  ok(invoiceDocumentWord('it', 'invoice') === 'Fattura'
    && invoiceDocumentWord('fr', 'reminder', 1) === '1er rappel'
    && invoiceDocumentWord('de', 'reminder', 3) === '3. Zahlungserinnerung'
    && invoiceDocumentWord('it', 'credit_note') === 'Nota di credito',
    'invoiceDocumentWord forma i titoli nelle tre lingue');

  // ---- CONTROPROVE sugli errori del modulo --------------------------------
  let qrMissing = '';
  try { await createInvoicePdf(fixtureInvoice('it')); } catch (error) { qrMissing = String(error); }
  ok(qrMissing.includes('INVOICE_PDF_QR_MISSING'), 'una fattura SENZA immagine QR non si produce', qrMissing);
  let qrInvalid = '';
  try {
    await createInvoicePdf(fixtureInvoice('it'), null, null, new Uint8Array([1, 2, 3]));
  } catch (error) { qrInvalid = String(error); }
  ok(qrInvalid.includes('INVOICE_PDF_QR_INVALID'), 'un PNG illeggibile è un errore dichiarato', qrInvalid);
  let levelMissing = '';
  try {
    await createInvoicePdf({ ...fixtureInvoice('it'), kind: 'reminder' });
  } catch (error) { levelMissing = String(error); }
  ok(levelMissing.includes('INVOICE_PDF_LEVEL_INVALID'), 'un sollecito senza livello non si produce', levelMissing);
  let levelOut = '';
  try {
    await createInvoicePdf({ ...fixtureInvoice('it'), kind: 'reminder', level: 4 });
  } catch (error) { levelOut = String(error); }
  ok(levelOut.includes('INVOICE_PDF_LEVEL_INVALID'), 'il livello 4 è fuori standard (1..3)', levelOut);
  let noItems = '';
  try {
    await createInvoicePdf({ ...fixtureInvoice('it'), items: [] }, null, null, new Uint8Array([1]));
  } catch (error) { noItems = String(error); }
  ok(noItems.includes('INVOICE_PDF_NO_ITEMS'), 'un documento senza voci non si produce', noItems);
  let badAmount = '';
  try {
    // Sul sollecito il QR non serve: così il rifiuto arriva dal TOTALE, non dal QR.
    await createInvoicePdf({ ...fixtureInvoice('it'), kind: 'reminder', level: 1, total: 'non-numero' });
  } catch (error) { badAmount = String(error); }
  ok(badAmount.includes('INVOICE_PDF_INVALID_AMOUNT'), 'un totale non numerico viene rifiutato', badAmount);
  // Nota di credito e sollecito NON chiedono il QR: i due PDF qui sopra sono
  // stati prodotti senza, ed è la controprova che la polizza è vietata altrove.
}

// ============================================================================
console.log('\n6 · Il contratto sorgente: migrazioni 0053/0054 e Edge Function');
// ============================================================================
{
  const migration = readFileSync(join(ROOT, 'supabase/migrations/0053_finance_issued_invoices.sql'), 'utf8');
  const widening = readFileSync(join(ROOT, 'supabase/migrations/0054_issued_invoice_entity_type.sql'), 'utf8');
  const invoiceFunction = readFileSync(join(ROOT, 'supabase/functions/generate-finance-invoice/index.ts'), 'utf8');
  const sendFunction = readFileSync(join(ROOT, 'supabase/functions/send-crm-email/index.ts'), 'utf8');

  ok(migration.includes("create type public.finance_issued_invoice_status as enum (\n    'draft', 'issued', 'sent', 'paid', 'overdue', 'voided'")
    && migration.includes("create type public.finance_issued_invoice_doc_kind as enum (\n    'invoice', 'credit_note', 'reminder'")
    && migration.includes("create type public.finance_issued_invoice_language as enum ('it', 'de', 'fr')"),
    'la 0053 enumera stati, tipi documento e lingue senza dipendere dalla UI');
  ok(migration.indexOf('revoke all on public.finance_issued_invoices') < migration.indexOf('grant select on public.finance_issued_invoices')
    && migration.indexOf('revoke all on public.finance_issued_invoice_items') < migration.indexOf('grant select on public.finance_issued_invoice_items')
    && migration.indexOf('revoke all on public.finance_issued_invoice_documents') < migration.indexOf('grant select on public.finance_issued_invoice_documents'),
    'revoke precede grant su tutte e tre le tabelle (su public il default è pieno)');
  ok(migration.includes('unique (company_id, sequence_number)')
    && migration.includes('unique (company_id, invoice_number)')
    && migration.includes('unique (company_id, credit_note_number)')
    && migration.includes('unique (invoice_id, line_number)'),
    'numeri di fattura, nota di credito e riga hanno vincoli univoci per azienda');
  ok(migration.includes('generated always as') && migration.includes('numeric(14,2)')
    && migration.includes('finance_issued_invoice_refresh_totals'),
    'gli importi di riga sono colonne generate in SQL decimale e i totali li scrive solo il database');
  ok(migration.includes('vat_rate_id') && migration.includes('vat_source_url')
    && migration.includes('vat_checked_at') && migration.includes('vat_source_title'),
    'ogni voce conserva aliquota, fonte e data di verifica (snapshot, non riferimento)');
  for (const mode of ['totals', 'pdf', 'issue', 'send', 'lifecycle', 'overdue']) {
    ok(migration.includes(`set_config('ai_swisse.invoice_write', '${mode}'`),
      `la modalità di scrittura «${mode}» è dichiarata nel GUC`);
  }
  ok(migration.includes('finance_issued_invoice_cross_tenant')
    && migration.includes('finance_issued_invoice_item_cross_tenant')
    && migration.includes('finance_issued_invoice_document_cross_tenant'),
    'le guardie ricontrollano i legami cross-tenant, anche per il service role');
  ok(migration.includes('before insert or update on public.finance_issued_invoice_items')
    && !migration.includes('before insert or update or delete on public.finance_issued_invoice_items'),
    'l’immutabilità delle righe non impedisce la cancellazione a cascata');
  ok(migration.includes('0053: RLS non attiva su') && migration.includes("privilege_type <> 'SELECT'"),
    'il blocco di autoverifica della 0053 rilegge RLS e privilegi');
  ok((migration.match(/pg_advisory_xact_lock\(hashtextextended\(p_company_id::text, 0\)\)/g) ?? []).length === 2,
    'la numerazione di fatture e note di credito avviene sotto advisory lock per azienda');
  ok(migration.includes('finance_issued_invoice_pdf_required')
    && migration.includes('finance_issued_invoice_iban_required')
    && migration.includes('finance_issued_invoice_void_reason_required')
    && migration.includes('finance_issued_invoice_document_conflict'),
    'emissione senza PDF, senza IBAN, annullo senza motivo e doppia registrazione sono errori nominati');
  ok(migration.includes("alter type public.automation_event_type add value if not exists 'finance_issued_invoice_overdue'")
    && migration.includes("'fininv:' || r.id::text || ':overdue:' || r.due_date::text"),
    'la scansione scadute emette un evento con chiave di deduplicazione');

  ok((widening.match(/add constraint \w+_entity_type_check/g) ?? []).length === 3
    && widening.includes('automation_events_entity_type_check')
    && widening.includes('workflow_runs_entity_type_check')
    && widening.includes('notifications_entity_type_check')
    && (widening.match(/'finance_issued_invoice'/g) ?? []).length >= 3,
    'la 0054 riscrive i tre vincoli entity_type ammettendo la fattura emessa');
  ok(widening.includes('0054 autoverifica fallita') && widening.includes('pg_get_constraintdef'),
    'la 0054 si autoverifica leggendo i vincoli dal catalogo');

  ok(invoiceFunction.includes("source_type: 'generated'"),
    'il PDF della fattura dichiara la provenienza nel modulo Documenti');
  ok(invoiceFunction.includes('finance_register_issued_invoice_pdf'),
    'la funzione registra il PDF tramite la RPC con guardiani');
  ok(invoiceFunction.includes('generatePaymentReference') && invoiceFunction.includes('buildSwissQrPayload'),
    'riferimento e payload QR sono composti dal codice condiviso, non riscritti');
  ok(invoiceFunction.includes('INVOICE_IBAN_MISSING'),
    'senza IBAN aziendale la fattura non si genera');
  ok(invoiceFunction.includes("errorCorrectionLevel: 'M'") && invoiceFunction.includes('margin: 0')
    && invoiceFunction.includes('scale: 4'),
    'le opzioni del QR della funzione sono quelle replicate in questa suite');

  ok(sendFunction.includes('INVOICE_PDF_STALE') && sendFunction.includes('pdf_generated_at'),
    'il composer blocca l’invio di un PDF di fattura diventato obsoleto');
  ok(sendFunction.indexOf('provider.send(') < sendFunction.lastIndexOf('finance_mark_attached_invoices_sent')
    && sendFunction.indexOf("delivery_status: 'sent'") < sendFunction.lastIndexOf('finance_mark_attached_invoices_sent'),
    'la fattura diventa «inviata» solo DOPO l’accettazione del provider');

  // Il parametro ?sezione= deve nominare un identificativo di TABS. Il
  // 2026-09-02 tre collegamenti scritti a mano dicevano «emesse»: tabFromParams
  // ricadeva su «invoices» e il pannello «Emesse» non si apriva mai.
  {
    const sorgenti: string[] = [];
    const raccogli = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const percorso = join(dir, entry.name);
        if (entry.isDirectory()) raccogli(percorso);
        else if (/\.(ts|tsx)$/.test(entry.name)) sorgenti.push(readFileSync(percorso, 'utf8'));
      }
    };
    raccogli(join(ROOT, 'src'));
    const usati = new Set<string>();
    for (const sorgente of sorgenti) {
      for (const m of sorgente.matchAll(/sezione=([a-z]+)/g)) usati.add(m[1]);
    }
    ok([...usati].every((v) => (TABS as readonly string[]).includes(v)),
      'ogni ?sezione= scritto a mano nomina una scheda esistente', [...usati].join(', '));
  }
}

// ============================================================================
if (process.argv.includes('--sample')) {
  const outDir = join(ROOT, 'output/pdf');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'finance-invoice-sample.pdf'), pdfByLanguage.get('it')!.bytes);
  const credit = fixtureInvoice('it');
  writeFileSync(join(outDir, 'finance-invoice-sample-NC.pdf'), await createInvoicePdf({
    ...credit, kind: 'credit_note', creditNoteNumber: 'NC-000001',
    creditReason: 'Errore di fatturazione: doppio addebito',
  }));
  writeFileSync(join(outDir, 'finance-invoice-sample-S2.pdf'), await createInvoicePdf({
    ...fixtureInvoice('it'), kind: 'reminder', level: 2,
  }));
  console.log(`\nCampioni scritti: ${outDir}/finance-invoice-sample{,-NC,-S2}.pdf`);
}

console.log(`\n${passed} superati · ${failed} falliti`);
process.exit(failed ? 1 : 0);
