// ============================================================================
// PDF dei preventivi CRM — A4, tre lingue, nessuna dipendenza dall'interfaccia.
//
// Gli importi arrivano come stringhe decimali già calcolate da PostgreSQL. Qui
// si FORMATTANO soltanto: il PDF non ricalcola la verità economica del dato.
// Il modulo è condiviso dalla Edge Function e dai test offline.
// ============================================================================
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';

export type QuoteLanguage = 'it' | 'de' | 'fr';

export interface QuotePdfParty {
  legalName?: string | null;
  displayName?: string | null;
  uidChe?: string | null;
  vatNumber?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
}

export interface QuotePdfItem {
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

export interface QuotePdfInput {
  quoteNumber: string;
  version: number;
  language: QuoteLanguage;
  issuedOn: string;
  validUntil: string;
  currency: string;
  title: string;
  introduction?: string | null;
  notes?: string | null;
  subtotal: string | number;
  vatTotal: string | number;
  total: string | number;
  company: QuotePdfParty;
  customer: QuotePdfParty;
  items: QuotePdfItem[];
}

type Labels = {
  document: string; number: string; version: string; date: string; validUntil: string;
  recipient: string; description: string; quantity: string; unitPrice: string;
  vat: string; amount: string; subtotal: string; vatTotal: string; total: string;
  notes: string; vatSource: string; checked: string; page: string;
};

const LABELS: Record<QuoteLanguage, Labels> = {
  it: { document: 'Preventivo', number: 'Numero', version: 'Versione', date: 'Data', validUntil: 'Valido fino al', recipient: 'Destinatario', description: 'Descrizione', quantity: 'Quantità', unitPrice: 'Prezzo unitario', vat: 'IVA', amount: 'Importo', subtotal: 'Imponibile', vatTotal: 'IVA totale', total: 'Totale', notes: 'Note', vatSource: 'Fonte aliquote IVA', checked: 'verificata il', page: 'Pagina' },
  de: { document: 'Offerte', number: 'Nummer', version: 'Version', date: 'Datum', validUntil: 'Gültig bis', recipient: 'Empfänger', description: 'Beschreibung', quantity: 'Menge', unitPrice: 'Einzelpreis', vat: 'MWST', amount: 'Betrag', subtotal: 'Zwischensumme', vatTotal: 'MWST total', total: 'Total', notes: 'Hinweise', vatSource: 'Quelle der MWST-Sätze', checked: 'geprüft am', page: 'Seite' },
  fr: { document: 'Devis', number: 'Numéro', version: 'Version', date: 'Date', validUntil: 'Valable jusqu’au', recipient: 'Destinataire', description: 'Description', quantity: 'Quantité', unitPrice: 'Prix unitaire', vat: 'TVA', amount: 'Montant', subtotal: 'Sous-total', vatTotal: 'TVA totale', total: 'Total', notes: 'Remarques', vatSource: 'Source des taux de TVA', checked: 'vérifiée le', page: 'Page' },
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 46;
const INK = rgb(0.08, 0.13, 0.22);
const MUTED = rgb(0.38, 0.43, 0.50);
const LINE = rgb(0.84, 0.87, 0.91);
const ACCENT = rgb(0.10, 0.52, 0.42);
const SOFT = rgb(0.95, 0.97, 0.98);

/** StandardFonts usa WinAnsi: normalizziamo solo i segni non rappresentabili. */
export function pdfSafe(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/[^\u0020-\u007E\u00A1-\u00FF]/g, '?');
}

function decimal(value: string | number): number {
  const parsed = Number(String(value));
  if (!Number.isFinite(parsed)) throw new Error('QUOTE_PDF_INVALID_AMOUNT');
  return parsed;
}

function money(value: string | number, currency: string, language: QuoteLanguage): string {
  return pdfSafe(new Intl.NumberFormat(`${language}-CH`, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(decimal(value)));
}

function quantity(value: string | number, language: QuoteLanguage): string {
  return pdfSafe(new Intl.NumberFormat(`${language}-CH`, { maximumFractionDigits: 3 }).format(decimal(value)));
}

function date(value: string, language: QuoteLanguage): string {
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

function address(party: QuotePdfParty): string[] {
  return [
    party.legalName || party.displayName || '',
    party.street || '',
    [party.postalCode, party.city].filter(Boolean).join(' '),
    party.countryCode || '',
  ].map(pdfSafe).filter(Boolean);
}

export async function createQuotePdf(input: QuotePdfInput, logo?: Uint8Array | null,
  logoMimeType?: string | null): Promise<Uint8Array> {
  if (!input.items.length) throw new Error('QUOTE_PDF_NO_ITEMS');
  const labels = LABELS[input.language];
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${labels.document} ${input.quoteNumber}`);
  pdf.setSubject(pdfSafe(input.title));
  pdf.setAuthor(pdfSafe(input.company.legalName || 'AI-Swisse'));
  pdf.setCreator('AI-Swisse CRM');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let embeddedLogo: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (logo?.length) {
    try {
      embeddedLogo = logoMimeType === 'image/jpeg' ? await pdf.embedJpg(logo) : await pdf.embedPng(logo);
    } catch { embeddedLogo = null; }
  }

  const pages: PDFPage[] = [];
  let page = pdf.addPage([A4.width, A4.height]); pages.push(page);
  let y = A4.height - MARGIN;

  const pageHeader = (current: PDFPage, compact: boolean) => {
    if (compact) {
      current.drawText(pdfSafe(input.company.legalName || ''), { x: MARGIN, y: A4.height - 34, size: 9, font: bold, color: INK });
      const ref = `${labels.document} ${input.quoteNumber} / ${input.version}`;
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
  page.drawText(labels.document, { x: 395, y: y - 12, size: 23, font: bold, color: INK });
  page.drawText(pdfSafe(input.quoteNumber), { x: 395, y: y - 31, size: 10, font: regular, color: MUTED });
  page.drawText(`${labels.version} ${input.version}`, { x: 395, y: y - 46, size: 9, font: regular, color: MUTED });
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
  if (input.customer.vatNumber) page.drawText(pdfSafe(input.customer.vatNumber), { x: 326, y: rightY, size: 8.5, font: regular, color: MUTED });
  y = Math.min(leftY, rightY) - 23;

  page.drawText(pdfSafe(input.title), { x: MARGIN, y, size: 17, font: bold, color: INK });
  y -= 24;
  const meta = `${labels.date}: ${date(input.issuedOn, input.language)}    ${labels.validUntil}: ${date(input.validUntil, input.language)}`;
  page.drawText(pdfSafe(meta), { x: MARGIN, y, size: 9, font: regular, color: MUTED });
  y -= 25;
  if (input.introduction) y = drawLines(page, input.introduction, MARGIN, y, A4.width - MARGIN * 2, regular, 9.5, INK, 14) - 9;

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

  pages.forEach((current, index) => {
    current.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: A4.width - MARGIN, y: 38 }, thickness: 0.5, color: LINE });
    const footer = `${labels.page} ${index + 1} / ${pages.length}`;
    current.drawText(footer, { x: A4.width - MARGIN - regular.widthOfTextAtSize(footer, 7.5), y: 24, size: 7.5, font: regular, color: MUTED });
    current.drawText(pdfSafe(`${labels.document} ${input.quoteNumber}`), { x: MARGIN, y: 24, size: 7.5, font: regular, color: MUTED });
  });
  return await pdf.save({ useObjectStreams: false });
}
