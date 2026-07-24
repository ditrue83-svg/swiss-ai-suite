// Estrazione testo lato client (pdf.js). Restituisce il testo PER PAGINA (§4), così
// la pipeline server-side può ancorare le citazioni alla pagina giusta.
// Scansioni/foto (PDF senza testo, immagini) NON si estraggono qui: si inviano al
// server per l'OCR (§4), segnalando `needs_ocr`.
import * as pdfjsLib from 'pdfjs-dist';
// Worker servito da Vite come URL (bundle self-contained).
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface ExtractionPage { pageNumber: number; text: string }
export interface ClientExtraction {
  fullText: string;
  pages: ExtractionPage[];
  extractionMethod: 'native_pdf' | 'text';
}

/** Esito dell'estrazione da un file: testo estratto, oppure "serve OCR server-side". */
export type ExtractOutcome =
  | { kind: 'extraction'; extraction: ClientExtraction }
  | { kind: 'needs_ocr'; reason: 'pdf_scan' | 'image' };

/** Estrae il testo pagina per pagina da un PDF. */
async function extractPdfPages(data: ArrayBuffer): Promise<ExtractionPage[]> {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: ExtractionPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => {
        const maybe = it as { str?: string };
        return typeof maybe.str === 'string' ? maybe.str : '';
      })
      .join(' ');
    pages.push({ pageNumber: i, text });
  }
  return pages;
}

/** Testo semplice (incollato / .txt / .eml) → una sola "pagina". */
export function fromPlainText(text: string): ClientExtraction {
  const clean = text ?? '';
  return { fullText: clean, pages: [{ pageNumber: 1, text: clean }], extractionMethod: 'text' };
}

/**
 * Estrae dal file dell'utente:
 *  - PDF con testo    → { extraction, native_pdf }
 *  - PDF scansione    → { needs_ocr } (poco/niente testo estraibile)
 *  - immagine         → { needs_ocr }
 *  - txt / eml / md   → { extraction, text }
 */
export async function extractFromFile(file: File): Promise<ExtractOutcome> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const pages = await extractPdfPages(await file.arrayBuffer());
    const fullText = pages.map((p) => p.text).join('\n').trim();
    if (fullText.length < 40) return { kind: 'needs_ocr', reason: 'pdf_scan' };
    return { kind: 'extraction', extraction: { fullText, pages, extractionMethod: 'native_pdf' } };
  }
  if (file.type.startsWith('image/')) return { kind: 'needs_ocr', reason: 'image' };
  return { kind: 'extraction', extraction: fromPlainText(await file.text()) };
}

/** Ricostruisce il testo originale scaricando il file da Storage (per il viewer). */
export async function reconstructText(blob: Blob, mimeType: string | null): Promise<string> {
  const isPdf = (mimeType ?? '').includes('pdf');
  if (isPdf) {
    try {
      return (await extractPdfPages(await blob.arrayBuffer())).map((p) => p.text).join('\n');
    } catch {
      return '';
    }
  }
  return await blob.text();
}
