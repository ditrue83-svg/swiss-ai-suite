// ============================================================================
// PDF delle fatture emesse — A4, tre lingue, polizza di pagamento QR svizzera.
//
// Gli importi arrivano come stringhe decimali già calcolate da PostgreSQL. Qui
// si FORMATTANO soltanto: il PDF non ricalcola la verità economica del dato.
// Il modulo è condiviso dalla Edge Function e dai test offline.
//
// La polizza QR è obbligatoria sulla fattura e vietata altrove: nota di
// credito e sollecito sono documenti contabili, non richieste di pagamento.
// La disposizione grafica della polizza segue le «Swiss Implementation
// Guidelines for the QR-bill» (SIX): ricevuta a sinistra, parte di pagamento
// a destra, Swiss QR Code di 46 mm con la croce svizzera di 7 mm al centro.
// Il CONTENUTO del codice lo compone e lo ri-verifica `qrbill.ts`: qui entra
// già come immagine PNG.
// ============================================================================
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import { pdfSafe } from '../crm-quotes/pdf.ts';

export type InvoiceLanguage = 'it' | 'de' | 'fr';
export type InvoiceDocKind = 'invoice' | 'credit_note' | 'reminder';

export interface InvoicePdfParty {
  legalName?: string | null;
  displayName?: string | null;
  uidChe?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
  bankIban?: string | null;
}

export interface InvoicePdfItem {
  lineNumber: number;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  vatRate: string | number;
  vatSourceUrl: string;
  vatSourceTitle?: string | null;
  vatCheckedAt: string;
  netAmount: string | number;
  vatAmount: string | number;
  totalAmount: string | number;
}

export interface InvoicePdfInput {
  invoiceNumber: string;
  language: InvoiceLanguage;
  currency: string;
  issuedOn: string;
  dueDate: string;
  title: string;
  notes?: string | null;
  subtotal: string | number;
  vatTotal: string | number;
  total: string | number;
  company: InvoicePdfParty;
  customer: InvoicePdfParty;
  items: InvoicePdfItem[];
  kind: InvoiceDocKind;
  /** Obbligatorio (1..3) per il sollecito, ignorato altrove. */
  level?: number | null;
  /** Numero proprio della nota di credito (NC-…): la fattura resta l'originale. */
  creditNoteNumber?: string | null;
  /** Motivo dell'annullo, obbligatorio in anagrafica per le fatture voided. */
  creditReason?: string | null;
  referenceType?: string | null;
  reference?: string | null;
}

type Labels = {
  invoice: string; creditNote: string; reminder: string;
  number: string; date: string; dueDate: string; recipient: string;
  description: string; quantity: string; unitPrice: string; vat: string; amount: string;
  subtotal: string; vatTotal: string; total: string; notes: string;
  vatSource: string; checked: string; page: string;
  originalInvoice: string; creditReason: string; amountDue: string;
  receipt: string; paymentPart: string; account: string; reference: string; payableBy: string;
};

const LABELS: Record<InvoiceLanguage, Labels> = {
  it: { invoice: 'Fattura', creditNote: 'Nota di credito', reminder: 'Sollecito', number: 'Numero', date: 'Data', dueDate: 'Scadenza', recipient: 'Destinatario', description: 'Descrizione', quantity: 'Quantità', unitPrice: 'Prezzo unitario', vat: 'IVA', amount: 'Importo', subtotal: 'Imponibile', vatTotal: 'IVA totale', total: 'Totale', notes: 'Note', vatSource: 'Fonte aliquote IVA', checked: 'verificata il', page: 'Pagina', originalInvoice: 'Fattura originale', creditReason: 'Motivo dell\u2019annullo', amountDue: 'Importo dovuto', receipt: 'Ricevuta', paymentPart: 'Parte di pagamento', account: 'Conto', reference: 'Riferimento', payableBy: 'Pagabile da' },
  de: { invoice: 'Rechnung', creditNote: 'Gutschrift', reminder: 'Zahlungserinnerung', number: 'Nummer', date: 'Datum', dueDate: 'Fällig am', recipient: 'Empfänger', description: 'Beschreibung', quantity: 'Menge', unitPrice: 'Einzelpreis', vat: 'MWST', amount: 'Betrag', subtotal: 'Zwischensumme', vatTotal: 'MWST total', total: 'Total', notes: 'Hinweise', vatSource: 'Quelle der MWST-Sätze', checked: 'geprüft am', page: 'Seite', originalInvoice: 'Originalrechnung', creditReason: 'Grund der Annullierung', amountDue: 'Offener Betrag', receipt: 'Empfangsschein', paymentPart: 'Zahlteil', account: 'Konto', reference: 'Referenz', payableBy: 'Zahlbar durch' },
  fr: { invoice: 'Facture', creditNote: 'Note de crédit', reminder: 'Rappel', number: 'Numéro', date: 'Date', dueDate: 'Échéance', recipient: 'Destinataire', description: 'Description', quantity: 'Quantité', unitPrice: 'Prix unitaire', vat: 'TVA', amount: 'Montant', subtotal: 'Sous-total', vatTotal: 'TVA totale', total: 'Total', notes: 'Remarques', vatSource: 'Source des taux de TVA', checked: 'vérifiée le', page: 'Page', originalInvoice: 'Facture d\u2019origine', creditReason: 'Motif de l\u2019annulation', amountDue: 'Montant dû', receipt: 'Récépissé', paymentPart: 'Section paiement', account: 'Compte', reference: 'Référence', payableBy: 'Payable par' },
};

/** Il sollecito si intitola col suo livello: «1° sollecito», «1. Zahlungserinnerung», «1er rappel». */
export function invoiceDocumentWord(
  language: InvoiceLanguage,
  kind: InvoiceDocKind,
  level?: number | null,
): string {
  const labels = LABELS[language];
  if (kind === 'credit_note') return labels.creditNote;
  if (kind === 'reminder') {
    const n = level ?? 1;
    if (language === 'de') return `${n}. ${labels.reminder}`;
    if (language === 'fr') return n === 1 ? '1er rappel' : `${n}e rappel`;
    return `${n}° sollecito`;
  }
  return labels.invoice;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 46;
const INK = rgb(0.08, 0.13, 0.22);
const MUTED = rgb(0.38, 0.43, 0.50);
const LINE = rgb(0.84, 0.87, 0.91);
const ACCENT = rgb(0.10, 0.52, 0.42);
const SOFT = rgb(0.95, 0.97, 0.98);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);

// La polizza: 1 mm ≈ 2.835 pt. Lo standard SIX dà il codice in 46 mm e la
// croce in 7 mm, e vuole la polizza staccabile in fondo alla pagina.
const MM = 841.89 / 297;
const QR_SIZE = Math.round(46 * MM);      // ≈ 130 pt
const CROSS_SIZE = Math.round(7 * MM);    // ≈ 20 pt
const SLIP_TOP = 280;                     // linea di separazione (polizza ≈ 78 mm)
const SLIP_CLEARANCE = 20;                // spazio minimo sopra la linea
const RECEIPT_X = MARGIN;
const RECEIPT_W = 158;
const DIVIDER_X = 216;                    // fra ricevuta e parte di pagamento
const PAY_X = 230;
const INFO_X = PAY_X + QR_SIZE + 14;
const INFO_W = A4.width - MARGIN - INFO_X;

function decimal(value: string | number): number {
  const parsed = Number(String(value));
  if (!Number.isFinite(parsed)) throw new Error('INVOICE_PDF_INVALID_AMOUNT');
  return parsed;
}

function money(value: string | number, currency: string, language: InvoiceLanguage): string {
  return pdfSafe(new Intl.NumberFormat(`${language}-CH`, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(decimal(value)));
}

function quantity(value: string | number, language: InvoiceLanguage): string {
  return pdfSafe(new Intl.NumberFormat(`${language}-CH`, { maximumFractionDigits: 3 }).format(decimal(value)));
}

function date(value: string, language: InvoiceLanguage): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return pdfSafe(value);
  return pdfSafe(new Intl.DateTimeFormat(`${language}-CH`, {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  }).format(parsed));
}

function lines(value: string, font: PDFFont, size: number, width: number): string[] {
  const paragraphs = pdfSafe(value).split(/\r?\n/);
  const out: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) { out.push(''); continue; }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { current = candidate; continue; }
      if (current) out.push(current);
      if (font.widthOfTextAtSize(word, size) <= width) { current = word; continue; }
      let chunk = '';
      for (const char of word) {
        if (font.widthOfTextAtSize(chunk + char, size) > width && chunk) {
          out.push(chunk); chunk = char;
        } else chunk += char;
      }
      current = chunk;
    }
    if (current) out.push(current);
  }
  return out;
}

function drawLines(page: PDFPage, value: string, x: number, y: number, width: number,
  font: PDFFont, size: number, color = INK, leading = size + 3): number {
  const wrapped = lines(value, font, size, width);
  wrapped.forEach((line, index) => page.drawText(line, { x, y: y - index * leading, size, font, color }));
  return y - wrapped.length * leading;
}

function address(party: InvoicePdfParty): string[] {
  return [
    party.legalName || party.displayName || '',
    party.street || '',
    [party.postalCode, party.city].filter(Boolean).join(' '),
    party.countryCode || '',
  ].map(pdfSafe).filter(Boolean);
}

/** IBAN a gruppi di quattro caratteri, come si legge sull'estratto conto. */
function groupIban(value: string): string {
  return pdfSafe(String(value ?? '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim());
}

/** Il riferimento QR (27 cifre) si legge a gruppi di cinque da destra; lo SCOR a gruppi di quattro. */
function groupReference(referenceType: string | null | undefined, reference: string): string {
  const clean = String(reference ?? '').replace(/\s+/g, '');
  if (referenceType === 'QRR') {
    const groups: string[] = [];
    let rest = clean;
    while (rest.length > 5) { groups.unshift(rest.slice(-5)); rest = rest.slice(0, -5); }
    if (rest) groups.unshift(rest);
    return groups.join(' ');
  }
  return pdfSafe(clean.replace(/(.{4})/g, '$1 ').trim());
}

/**
 * La croce svizzera al centro del codice: quadrato bianco di 7 mm con la
 * croce nera — le due barre si incontrano al centro e il braccio è un terzo
 * della sua lunghezza (6 mm di apertura entro il quadrato, per SIX). Il
 * codice resta leggibile perché la zona centrale è riservata per standard.
 */
function drawSwissCross(page: PDFPage, centerX: number, centerY: number) {
  const span = CROSS_SIZE * (6 / 7);
  const arm = span / 3;
  page.drawRectangle({
    x: centerX - CROSS_SIZE / 2, y: centerY - CROSS_SIZE / 2,
    width: CROSS_SIZE, height: CROSS_SIZE, color: WHITE,
  });
  page.drawRectangle({
    x: centerX - arm / 2, y: centerY - span / 2, width: arm, height: span, color: BLACK,
  });
  page.drawRectangle({
    x: centerX - span / 2, y: centerY - arm / 2, width: span, height: arm, color: BLACK,
  });
}

export async function createInvoicePdf(
  input: InvoicePdfInput,
  logo?: Uint8Array | null,
  logoMimeType?: string | null,
  qrPng?: Uint8Array | null,
): Promise<Uint8Array> {
  if (!input.items.length) throw new Error('INVOICE_PDF_NO_ITEMS');
  if (input.kind === 'invoice' && !qrPng?.length) throw new Error('INVOICE_PDF_QR_MISSING');
  if (input.kind === 'reminder'
      && !(Number.isInteger(input.level) && (input.level as number) >= 1 && (input.level as number) <= 3)) {
    throw new Error('INVOICE_PDF_LEVEL_INVALID');
  }
  const labels = LABELS[input.language];
  const docWord = invoiceDocumentWord(input.language, input.kind, input.level);
  const docNumber = input.kind === 'credit_note'
    ? (input.creditNoteNumber ?? input.invoiceNumber)
    : input.invoiceNumber;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${docWord} ${docNumber}`);
  pdf.setSubject(pdfSafe(input.title));
  pdf.setAuthor(pdfSafe(input.company.legalName || 'AI-Swisse'));
  pdf.setCreator('AI-Swisse Finanze');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let embeddedLogo: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (logo?.length) {
    try {
      embeddedLogo = logoMimeType === 'image/jpeg' ? await pdf.embedJpg(logo) : await pdf.embedPng(logo);
    } catch { embeddedLogo = null; }
  }
  let embeddedQr: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (input.kind === 'invoice') {
    try {
      embeddedQr = await pdf.embedPng(qrPng!);
    } catch {
      throw new Error('INVOICE_PDF_QR_INVALID');
    }
  }

  const pages: PDFPage[] = [];
  let page = pdf.addPage([A4.width, A4.height]); pages.push(page);
  let y = A4.height - MARGIN;

  const pageHeader = (current: PDFPage, compact: boolean) => {
    if (compact) {
      current.drawText(pdfSafe(input.company.legalName || ''), { x: MARGIN, y: A4.height - 34, size: 9, font: bold, color: INK });
      const ref = `${docWord} ${docNumber}`;
      current.drawText(pdfSafe(ref), { x: A4.width - MARGIN - regular.widthOfTextAtSize(ref, 8), y: A4.height - 34, size: 8, font: regular, color: MUTED });
      current.drawLine({ start: { x: MARGIN, y: A4.height - 43 }, end: { x: A4.width - MARGIN, y: A4.height - 43 }, thickness: 0.7, color: LINE });
    }
  };

  if (embeddedLogo) {
    const scale = Math.min(126 / embeddedLogo.width, 48 / embeddedLogo.height, 1);
    page.drawImage(embeddedLogo, { x: MARGIN, y: y - embeddedLogo.height * scale, width: embeddedLogo.width * scale, height: embeddedLogo.height * scale });
  } else {
    page.drawText(pdfSafe(input.company.legalName || ''), { x: MARGIN, y: y - 27, size: 18, font: bold, color: INK });
  }
  page.drawText(docWord, { x: 395, y: y - 12, size: 23, font: bold, color: INK });
  page.drawText(pdfSafe(docNumber), { x: 395, y: y - 31, size: 10, font: regular, color: MUTED });
  y -= 82;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 2, color: ACCENT });
  y -= 25;

  const companyAddress = address(input.company);
  page.drawText(pdfSafe(input.company.legalName || ''), { x: MARGIN, y, size: 10, font: bold, color: INK });
  let leftY = y - 15;
  for (const row of companyAddress.slice(1)) { page.drawText(row, { x: MARGIN, y: leftY, size: 8.5, font: regular, color: MUTED }); leftY -= 12; }
  if (input.company.uidChe) page.drawText(pdfSafe(input.company.uidChe), { x: MARGIN, y: leftY, size: 8.5, font: regular, color: MUTED });

  page.drawText(labels.recipient, { x: 326, y, size: 8, font: bold, color: ACCENT });
  let rightY = y - 16;
  for (const row of address(input.customer)) { page.drawText(row, { x: 326, y: rightY, size: 9.5, font: row === address(input.customer)[0] ? bold : regular, color: INK }); rightY -= 14; }
  y = Math.min(leftY, rightY) - 23;

  page.drawText(pdfSafe(input.title), { x: MARGIN, y, size: 17, font: bold, color: INK });
  y -= 24;
  const meta = `${labels.date}: ${date(input.issuedOn, input.language)}    ${labels.dueDate}: ${date(input.dueDate, input.language)}`;
  page.drawText(pdfSafe(meta), { x: MARGIN, y, size: 9, font: regular, color: MUTED });
  y -= 25;

  if (input.kind === 'credit_note') {
    page.drawText(pdfSafe(`${labels.originalInvoice}: ${input.invoiceNumber}`), { x: MARGIN, y, size: 10, font: bold, color: INK });
    y -= 17;
    if (input.creditReason) {
      y = drawLines(page, `${labels.creditReason}: ${input.creditReason}`, MARGIN, y, A4.width - MARGIN * 2, regular, 9, MUTED, 13) - 9;
    }
  }
  if (input.kind === 'reminder') {
    const due = `${labels.amountDue}: ${money(input.total, input.currency, input.language)}`;
    page.drawText(pdfSafe(due), { x: MARGIN, y, size: 12, font: bold, color: INK });
    y -= 24;
  }

  const columns = { desc: MARGIN, qty: 286, unit: 342, vat: 432, amount: 488 };
  const tableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 19, width: A4.width - MARGIN * 2, height: 25, color: SOFT });
    page.drawText(labels.description, { x: columns.desc + 4, y: y - 10, size: 8, font: bold, color: MUTED });
    page.drawText(labels.quantity, { x: columns.qty, y: y - 10, size: 8, font: bold, color: MUTED });
    page.drawText(labels.unitPrice, { x: columns.unit, y: y - 10, size: 8, font: bold, color: MUTED });
    page.drawText(labels.vat, { x: columns.vat, y: y - 10, size: 8, font: bold, color: MUTED });
    page.drawText(labels.amount, { x: columns.amount, y: y - 10, size: 8, font: bold, color: MUTED });
    y -= 27;
  };
  tableHeader();

  for (const item of input.items) {
    const descriptionLines = lines(item.description, regular, 8.5, 226);
    const rowHeight = Math.max(25, descriptionLines.length * 11 + 10);
    if (y - rowHeight < 180) {
      page = pdf.addPage([A4.width, A4.height]); pages.push(page); pageHeader(page, true);
      y = A4.height - 67; tableHeader();
    }
    descriptionLines.forEach((row, index) => page.drawText(row, { x: columns.desc + 4, y: y - 11 - index * 11, size: 8.5, font: regular, color: INK }));
    const rowValues = [
      { right: 330, value: quantity(item.quantity, input.language) },
      { right: 425, value: money(item.unitPrice, input.currency, input.language) },
      { right: 474, value: `${quantity(item.vatRate, input.language)}%` },
      { right: A4.width - MARGIN, value: money(item.netAmount, input.currency, input.language) },
    ];
    for (const cell of rowValues) {
      const value = pdfSafe(cell.value);
      page.drawText(value, { x: cell.right - regular.widthOfTextAtSize(value, 8.2), y: y - 11, size: 8.2, font: regular, color: INK });
    }
    page.drawLine({ start: { x: MARGIN, y: y - rowHeight }, end: { x: A4.width - MARGIN, y: y - rowHeight }, thickness: 0.5, color: LINE });
    y -= rowHeight;
  }

  if (y < 210) { page = pdf.addPage([A4.width, A4.height]); pages.push(page); pageHeader(page, true); y = A4.height - 72; }
  const totalsX = 342;
  const totalRows: Array<[string, string, boolean]> = [
    [labels.subtotal, money(input.subtotal, input.currency, input.language), false],
    [labels.vatTotal, money(input.vatTotal, input.currency, input.language), false],
    [labels.total, money(input.total, input.currency, input.language), true],
  ];
  for (const [label, value, strong] of totalRows) {
    if (strong) page.drawLine({ start: { x: totalsX, y: y + 14 }, end: { x: A4.width - MARGIN, y: y + 14 }, thickness: 1.2, color: ACCENT });
    page.drawText(label, { x: totalsX, y, size: strong ? 11 : 9, font: strong ? bold : regular, color: strong ? INK : MUTED });
    const chosen = strong ? bold : regular; const size = strong ? 11 : 9;
    page.drawText(value, { x: A4.width - MARGIN - chosen.widthOfTextAtSize(value, size), y, size, font: chosen, color: INK });
    y -= strong ? 28 : 20;
  }
  if (input.notes) {
    page.drawText(labels.notes, { x: MARGIN, y, size: 8, font: bold, color: ACCENT });
    y = drawLines(page, input.notes, MARGIN, y - 14, 260, regular, 8.5, INK, 12) - 8;
  }

  const sources = [...new Map(input.items.map((item) => [item.vatSourceUrl, item])).values()];
  if (y < 125 + sources.length * 22) { page = pdf.addPage([A4.width, A4.height]); pages.push(page); pageHeader(page, true); y = A4.height - 72; }
  page.drawText(labels.vatSource, { x: MARGIN, y, size: 8, font: bold, color: ACCENT }); y -= 14;
  for (const source of sources) {
    const sourceLine = `${source.vatSourceTitle || source.vatSourceUrl} - ${labels.checked} ${date(source.vatCheckedAt, input.language)}`;
    y = drawLines(page, sourceLine, MARGIN, y, A4.width - MARGIN * 2, regular, 7.5, MUTED, 10);
    y = drawLines(page, source.vatSourceUrl, MARGIN, y, A4.width - MARGIN * 2, regular, 6.5, MUTED, 9) - 4;
  }

  // La polizza di pagamento chiude la fattura, ancorata al fondo dell'ULTIMA
  // pagina: se il contenuto arriva troppo in basso, la polizza prende una
  // pagina sua. Nota di credito e sollecito non la portano mai.
  if (input.kind === 'invoice') {
    if (y < SLIP_TOP + SLIP_CLEARANCE) {
      page = pdf.addPage([A4.width, A4.height]); pages.push(page); pageHeader(page, true);
    }
    const iban = groupIban(input.company.bankIban ?? '');
    const reference = input.reference ? groupReference(input.referenceType, input.reference) : null;
    const creditorLines = [iban, ...address(input.company)];
    const debtorLines = address(input.customer);

    page.drawLine({ start: { x: MARGIN, y: SLIP_TOP }, end: { x: A4.width - MARGIN, y: SLIP_TOP }, thickness: 0.7, color: MUTED, dashArray: [5, 4] });
    page.drawLine({ start: { x: DIVIDER_X, y: 58 }, end: { x: DIVIDER_X, y: SLIP_TOP }, thickness: 0.7, color: MUTED, dashArray: [5, 4] });

    // ---- Ricevuta (sinistra) --------------------------------------------
    page.drawText(labels.receipt, { x: RECEIPT_X, y: SLIP_TOP - 18, size: 10, font: bold, color: INK });
    let ry = SLIP_TOP - 36;
    const slipLabel = (text: string) => {
      page.drawText(pdfSafe(text), { x: RECEIPT_X, y: ry, size: 6.5, font: bold, color: MUTED });
      ry -= 11;
    };
    const slipValue = (text: string) => {
      page.drawText(pdfSafe(text), { x: RECEIPT_X, y: ry, size: 8.5, font: regular, color: INK });
      ry -= 12;
    };
    slipLabel(labels.account);
    // Sulla ricevuta il paese si omette: la colonna è stretta e l'indirizzo
    // resta completo di nome, via e località.
    for (const row of creditorLines.slice(0, -1)) slipValue(row);
    ry -= 4;
    if (reference) { slipLabel(labels.reference); slipValue(reference); ry -= 4; }
    if (debtorLines.length) {
      slipLabel(labels.payableBy);
      for (const row of [debtorLines[0], debtorLines[2]].filter(Boolean) as string[]) slipValue(row);
    }
    page.drawText(labels.amount, { x: RECEIPT_X, y: 102, size: 6.5, font: bold, color: MUTED });
    page.drawText(pdfSafe(money(input.total, input.currency, input.language)), { x: RECEIPT_X, y: 88, size: 11, font: bold, color: INK });

    // ---- Parte di pagamento (destra) -------------------------------------
    page.drawText(labels.paymentPart, { x: PAY_X, y: SLIP_TOP - 18, size: 10, font: bold, color: INK });
    const qrTop = SLIP_TOP - 36;
    page.drawImage(embeddedQr!, { x: PAY_X, y: qrTop - QR_SIZE, width: QR_SIZE, height: QR_SIZE });
    drawSwissCross(page, PAY_X + QR_SIZE / 2, qrTop - QR_SIZE / 2);
    page.drawText(labels.amount, { x: PAY_X, y: qrTop - QR_SIZE - 18, size: 6.5, font: bold, color: MUTED });
    page.drawText(pdfSafe(money(input.total, input.currency, input.language)), { x: PAY_X, y: qrTop - QR_SIZE - 32, size: 11, font: bold, color: INK });

    let iy = qrTop;
    const infoLabel = (text: string) => {
      page.drawText(pdfSafe(text), { x: INFO_X, y: iy, size: 6.5, font: bold, color: MUTED });
      iy -= 11;
    };
    const infoValue = (text: string, size = 8.5) => {
      iy = drawLines(page, text, INFO_X, iy, INFO_W, regular, size, INK, size + 2.5) + 2.5;
    };
    infoLabel(labels.account);
    for (const row of creditorLines) infoValue(row);
    iy -= 6;
    if (reference) { infoLabel(labels.reference); infoValue(reference); iy -= 6; }
    if (debtorLines.length) {
      infoLabel(labels.payableBy);
      for (const row of debtorLines) infoValue(row);
    }
  }

  pages.forEach((current, index) => {
    current.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: A4.width - MARGIN, y: 38 }, thickness: 0.5, color: LINE });
    const footer = `${labels.page} ${index + 1} / ${pages.length}`;
    current.drawText(footer, { x: A4.width - MARGIN - regular.widthOfTextAtSize(footer, 7.5), y: 24, size: 7.5, font: regular, color: MUTED });
    current.drawText(pdfSafe(`${docWord} ${docNumber}`), { x: MARGIN, y: 24, size: 7.5, font: regular, color: MUTED });
  });
  return await pdf.save({ useObjectStreams: false });
}
