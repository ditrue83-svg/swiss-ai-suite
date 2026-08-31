// ============================================================================
// Preventivi CRM — prove offline del PDF e del contratto di sicurezza.
//   npm run test:crm-quotes-unit
//   npm run test:crm-quotes-unit -- --sample  (scrive output/pdf/… per QA)
//
// Il testo viene ESTRATTO con pdfjs: "pdf.save() non ha sollevato" non prova
// che il documento contenga davvero numero, importi, lingua e fonte fiscale.
// Il provider non viene chiamato: il percorso d'invio è controllato nel
// sorgente e la fetch finta vive in test:crm-email-unit.
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  createQuotePdf, pdfSafe, type QuoteLanguage, type QuotePdfInput,
} from '../supabase/functions/_shared/crm-quotes/pdf.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function ok(condition: boolean, label: string, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? `\n    ${detail}` : ''}`); }
}

const sourceUrl = 'https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-steuersaetze.html';
function fixture(language: QuoteLanguage, rows = 2): QuotePdfInput {
  const base = [
    {
      lineNumber: 1, description: 'Consulenza strategica e configurazione iniziale',
      quantity: '2.000', unitPrice: '100.00', vatRate: '8.1',
      vatSourceUrl: sourceUrl,
      vatSourceTitle: 'Eidgenössische Steuerverwaltung — Schweizer Mehrwertsteuersätze',
      vatCheckedAt: '2026-07-27', netAmount: '200.00', vatAmount: '16.20', totalAmount: '216.20',
    },
    {
      lineNumber: 2, description: 'Materiale editoriale', quantity: '1.000',
      unitPrice: '50.00', vatRate: '2.6', vatSourceUrl: sourceUrl,
      vatSourceTitle: 'Eidgenössische Steuerverwaltung — Schweizer Mehrwertsteuersätze',
      vatCheckedAt: '2026-07-27', netAmount: '50.00', vatAmount: '1.30', totalAmount: '51.30',
    },
  ];
  const items = rows === 2 ? base : Array.from({ length: rows }, (_, index) => ({
    ...base[0], lineNumber: index + 1,
    description: `Voce ${index + 1}: consulenza con una descrizione sufficientemente lunga per verificare a capo e paginazione`,
  }));
  return {
    quoteNumber: 'P-000123', version: 2, language,
    issuedOn: '2026-08-31', validUntil: '2026-09-30', currency: 'CHF',
    title: language === 'de' ? 'Digitale Beratung' : language === 'fr' ? 'Conseil numérique' : 'Consulenza digitale',
    introduction: 'Documento preparato per il progetto CRM.',
    notes: 'Pagamento entro trenta giorni.', subtotal: rows === 2 ? '250.00' : String(rows * 200),
    vatTotal: rows === 2 ? '17.50' : String(rows * 16.2),
    total: rows === 2 ? '267.50' : String(rows * 216.2),
    company: {
      legalName: 'Ai-Swisse SA', uidChe: 'CHE-123.456.789', street: 'Via Centrale 1',
      postalCode: '6900', city: 'Lugano', countryCode: 'CH',
    },
    customer: {
      legalName: 'Cliente Esempio SA', vatNumber: 'CHE-987.654.321 IVA', street: 'Rue du Lac 8',
      postalCode: '1201', city: 'Genève', countryCode: 'CH',
    },
    items,
  };
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
      text: content.items.map((item) => 'str' in item ? item.str : '').join(' '),
    });
  }
  return { pageCount: doc.numPages, pages, text: pages.map((page) => page.text).join(' ') };
}

console.log('Preventivi CRM — PDF e contratto offline\n');

const expected: Record<QuoteLanguage, string[]> = {
  it: ['Preventivo', 'Valido fino al', 'Destinatario', 'IVA totale'],
  de: ['Offerte', 'Gültig bis', 'Empfänger', 'MWST total'],
  fr: ['Devis', "Valable jusqu'au", 'Destinataire', 'TVA totale'],
};
for (const language of ['it', 'de', 'fr'] as const) {
  const pdf = await createQuotePdf(fixture(language));
  const parsed = await inspect(pdf);
  ok(pdf.byteLength > 4_000, `${language}: produce un PDF non vuoto`);
  ok(expected[language].every((needle) => parsed.text.includes(needle)),
    `${language}: il testo estratto usa la lingua del documento`, parsed.text.slice(0, 500));
  ok(parsed.text.includes('P-000123') && parsed.text.includes('Ai-Swisse SA')
    && parsed.text.includes('Cliente Esempio SA'), `${language}: conserva identità e numero`);
  ok(parsed.text.includes('267.50') && parsed.text.includes('CHF'),
    `${language}: stampa totale e valuta senza sommarle nell’interfaccia`, parsed.text.slice(-500));
  ok(parsed.text.includes('estv.admin.ch') && parsed.text.includes('27.'),
    `${language}: dichiara fonte e data delle aliquote IVA`);
}

const longPdf = await createQuotePdf(fixture('it', 34));
const longParsed = await inspect(longPdf);
ok(longParsed.pageCount >= 2, 'un preventivo lungo crea più pagine');
ok(longParsed.pages.every((page) => Math.abs(page.width - 595.28) < 0.2
  && Math.abs(page.height - 841.89) < 0.2), 'ogni pagina conserva il formato A4');
ok(longParsed.pages.every((page, index) => page.text.includes(`Pagina ${index + 1} / ${longParsed.pageCount}`)),
  'ogni pagina espone una paginazione verificabile');
ok(longParsed.text.includes('Voce 34:'), 'l’ultima voce non viene persa nel cambio pagina');

let noItems = '';
try { await createQuotePdf({ ...fixture('it'), items: [] }); } catch (error) { noItems = String(error); }
ok(noItems.includes('QUOTE_PDF_NO_ITEMS'), 'rifiuta un documento senza voci');
let invalidAmount = '';
try { await createQuotePdf({ ...fixture('it'), total: 'non-numero' }); } catch (error) { invalidAmount = String(error); }
ok(invalidAmount.includes('QUOTE_PDF_INVALID_AMOUNT'), 'rifiuta importi non numerici');
ok(pdfSafe('accettato → vinto') === 'accettato ? vinto', 'normalizza i glifi fuori da WinAnsi senza rompere il PDF');

const migration = readFileSync(join(ROOT, 'supabase/migrations/0049_crm_quotes.sql'), 'utf8');
const sendFunction = readFileSync(join(ROOT, 'supabase/functions/send-crm-email/index.ts'), 'utf8');
const registerFunction = readFileSync(join(ROOT, 'supabase/functions/generate-crm-quote/index.ts'), 'utf8');

ok(migration.includes("'draft', 'sent', 'accepted', 'rejected', 'expired'")
  && migration.includes("crm_quote_language as enum ('it', 'de', 'fr')"),
  'la migrazione enumera stati e lingue senza dipendere dalla UI');
ok(migration.includes('unique (company_id, sequence_number)')
  && migration.includes('unique (quote_id, version)'), 'numero aziendale e versione hanno vincoli univoci');
ok(migration.includes('generated always as') && migration.includes('numeric(14,2)')
  && migration.includes('total_amount = subtotal_amount + vat_amount'),
  'totali e IVA sono calcolati con numeric dal database');
ok(migration.includes('vat_rate_id') && migration.includes('vat_source_url')
  && migration.includes('vat_checked_at'), 'ogni voce conserva aliquota, fonte e data verificate');
const itemTable = migration.slice(
  migration.indexOf('create table if not exists public.crm_quote_items'),
  migration.indexOf('create table if not exists public.crm_quote_documents'),
);
ok(!itemTable.includes('currency'),
  'la valuta vive sulla versione, non sulle singole voci');
ok(migration.indexOf('revoke all on public.crm_quotes') < migration.indexOf('grant select on public.crm_quotes'),
  'revoke precede grant per le tabelle dei preventivi');
ok(migration.includes('crm_quote_cross_tenant') && migration.includes('crm_quote_version_cross_tenant')
  && migration.includes('crm_quote_item_cross_tenant'), 'le guardie ricontrollano i legami cross-tenant');
ok(migration.includes('crm_quote_version_immutable') && migration.includes('crm_quote_item_version_immutable'),
  'una versione inviata e le sue voci sono immutabili');
ok(migration.includes("status <> 'draft'") && migration.includes('crm_new_quote_version'),
  'la modifica successiva passa da una nuova versione in bozza');
ok(migration.includes('crm_mark_attached_quotes_sent') && migration.includes("delivery_status = 'sent'"),
  'lo stato inviato richiede un messaggio registrato come inviato');
ok(sendFunction.indexOf("delivery_status: null") < sendFunction.indexOf('provider.send(')
  && sendFunction.indexOf("delivery_status: 'sent'") < sendFunction.lastIndexOf("crm_mark_attached_quotes_sent"),
  'l’invio registra sent e solo dopo promuove il preventivo');
ok(sendFunction.includes('QUOTE_PDF_STALE') && sendFunction.includes('pdf_generated_at'),
  'il composer blocca un PDF diventato obsoleto dopo una modifica');
ok(registerFunction.includes("source_type: 'generated'") && registerFunction.includes('crm_register_quote_pdf'),
  'la generazione dichiara la provenienza nel modulo Documenti');

if (process.argv.includes('--sample')) {
  const out = join(ROOT, 'output/pdf/crm-quote-sample.pdf');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await createQuotePdf(fixture('it')));
  console.log(`\nCampione scritto: ${out}`);
}

console.log(`\n${passed} superati · ${failed} falliti`);
process.exit(failed ? 1 : 0);
