// ============================================================================
// §4 — «Il testo estratto è compatibile con il file da cui dice di venire?»
//
// Perché esiste (2026-07-29). Un PDF di 455 KB, una pagina, ha prodotto lato
// browser 44 caratteri — «2.5 2.0   7.5  3.5   4   8.0  5.5   5   15.0» — ed è
// stato spedito al modello come «PDF con testo». Era una scansione: una lettera
// raccomandata della Commissione svizzera di maturità, con una scadenza di due
// anni, un riferimento normativo e le soglie di superamento. Il modello ha
// risposto, correttamente, che non poteva concludere nulla (affidabilità 0.08).
//
// La guardia che avrebbe dovuto fermarlo era `fullText.length < 40`. Non ha
// fermato niente perché i caratteri erano 44, e soprattutto perché rispondeva
// alla domanda sbagliata: chiedeva QUANTO TESTO C'È, mentre la domanda utile è
// QUANTO TESTO DOVREBBE ESSERCI in un file di quella forma.
//
// ⚠️⚠️ LE DUE CONDIZIONI VALGONO SOLO INSIEME, MAI DA SOLE.
//   una ricevuta legittima  = corta E LEGGERA   (80 caratteri, 12 KB)
//   una scansione           = corta E PESANTE   (44 caratteri, 445 KB)
// Un solo criterio boccerebbe la ricevuta, che è un documento letto benissimo.
// È questo AND — non una costante più alta — a togliere il falso positivo.
//
// ⚠️ Lato server `bytes` viene da `documents.file_size`, che scrive il browser.
// Questa NON è una difesa contro un client malevolo: è una difesa contro un
// degrado ONESTO — pdf.js che non mente ma non trova testo. Chi volesse
// aggirarla dichiarerebbe un file più piccolo, e non ci sarebbe nulla da
// proteggere: il danno sarebbe suo.
//
// ⚠️ NESSUN IMPORT, per scelta: questo modulo è importato TALE E QUALE dal
// browser (`src/features/admin-ai/pdf.ts`), come già fa `automation/registry`.
// Aggiungerci un import di Deno o di npm romperebbe `npm run build`.
// ============================================================================

/** Una pagina di prosa vera ne contiene 1500–3000: sotto 150 non c'è una riga. */
export const MIN_CHARS_PER_PAGE = 150;

/** Un carattere ogni 2 KB di file. Un PDF di testo ne ha centinaia per KB. */
export const MIN_CHARS_PER_KB = 0.5;

/**
 * Pavimento assoluto, invariato dal 2026-07-25: sotto questa soglia non c'è
 * documento, qualunque sia la forma del file. Serve al PDF vuoto da 2 KB, dove
 * la densità non discrimina, e al testo incollato, dove pagine e byte non
 * significano nulla.
 */
export const MIN_CHARS_ABSOLUTE = 40;

export interface ExtractionShape {
  /** Caratteri di testo estratto (già ripuliti dagli spazi ai bordi). */
  chars: number;
  /** Pagine del documento. Minimo 1. */
  pages: number;
  /** Dimensione del file in byte; null o 0 = ignota → non si giudica. */
  bytes: number | null;
  extractionMethod: 'native_pdf' | 'text' | 'ocr';
}

/**
 * `true` quando il testo estratto NON è compatibile con il file da cui dice di
 * venire — praticamente sempre una scansione letta come se avesse uno strato di
 * testo. Chi chiama non deve rifiutare il documento: deve rileggerlo con l'OCR.
 *
 * Conservativa per costruzione: in caso di dubbio (metodo diverso da
 * `native_pdf`, dimensione ignota) risponde `false` e lascia passare. Un falso
 * negativo costa un'analisi mediocre; un falso positivo costerebbe una chiamata
 * OCR inutile su un documento che era già stato letto bene.
 */
export function looksLikeScan(s: ExtractionShape): boolean {
  // Solo il PDF nativo può mentire sulla propria forma: `text` (incollato,
  // .txt, corpo di un'email) non ha pagine né byte confrontabili, e `ocr` ha
  // già fatto l'unica cosa che questa funzione saprebbe consigliare.
  if (s.extractionMethod !== 'native_pdf') return false;
  if (!s.bytes || s.bytes <= 0) return false;

  const charsPerPage = s.chars / Math.max(1, s.pages);
  const charsPerKb = s.chars / (s.bytes / 1024);
  return charsPerPage < MIN_CHARS_PER_PAGE && charsPerKb < MIN_CHARS_PER_KB;
}
