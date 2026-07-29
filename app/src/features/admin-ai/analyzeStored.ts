// ============================================================================
// Rianalisi di un documento GIÀ salvato — una sola implementazione.
//
// Serve in due punti: la schermata di Admin AI (dove si riapre un documento
// dopo un fallimento) e il dettaglio di un documento nel Document Hub. È la
// STESSA pipeline del caricamento, non una terza: si riusa il testo già
// estratto, senza nuovo upload e senza nuova estrazione. Se l'estrazione non
// c'è — una scansione mai riuscita — si passa `null` e il server rifà l'OCR.
//
// Non è un pulsante «rianalizza con l'AI» offerto senza motivo (§97): esiste
// per riprendere un lavoro che non è arrivato in fondo, e le analisi restano
// tutte, perché dalla 0010 lo snapshot è immutabile e si accumula.
//
// ⚠️ 2026-07-29 — RIUSARE IL TESTO SALVATO NON È SEMPRE GIUSTO.
// Un documento può essere in archivio proprio PERCHÉ la sua estrazione è
// marcia: la lettera della Commissione svizzera di maturità era una scansione
// da 455 KB di cui pdf.js aveva letto 44 caratteri, e rispedire quei 44
// caratteri avrebbe riprodotto la stessa analisi inutile consumando quota.
// Qui si decide se fidarsi del testo salvato, con la stessa funzione che usano
// il browser e la Edge Function al primo caricamento.
// ============================================================================
import { analysisService, type AnalyzeOutcome } from '@/services/analysisService';
import { documentService } from '@/services/documentService';
import { looksLikeScan } from '../../../supabase/functions/_shared/extractionQuality.ts';
import type { ClientExtraction } from './pdf';
import type { DocumentRecord } from '@/types/models';

export interface AnalyzeStoredInput {
  document: DocumentRecord;
  companyName: string | null;
  /** Lingua dell'interfaccia: i testi generati la seguono (§42). */
  outputLanguage: string;
  onProgress?: (step: string) => void;
  /**
   * Ignora il testo già estratto e rileggi il file con l'OCR.
   *
   * È il gesto esplicito di chi guarda l'analisi, vede che il documento non è
   * stato letto, e lo dice. Senza questo, un documento la cui estrazione è
   * andata male resta irrecuperabile: la rianalisi rimanderebbe per sempre lo
   * stesso testo sbagliato.
   */
  forceOcr?: boolean;
}

export async function analyzeStoredDocument(input: AnalyzeStoredInput): Promise<AnalyzeOutcome> {
  const ext = await documentService.getExtraction(input.document.id);
  const stored = ext?.fullText?.trim() ? ext : null;

  // Il testo salvato si butta in tre casi, e in tutti e tre il server rilegge
  // il file con l'OCR:
  //
  //  1. lo chiede l'utente (`forceOcr`);
  //  2. NON È PLAUSIBILE per la forma del file — è il caso della scansione con
  //     lo strato di testo residuo;
  //  3. veniva già dall'OCR. Qui il motivo è diverso e vale la pena dirlo: il
  //     tipo `ClientExtraction` conosce solo `native_pdf` e `text`, quindi
  //     rimandarlo indietro lo farebbe risalvare come `'text'` — e
  //     `saveExtraction` fa upsert, cioè la provenienza VERA verrebbe
  //     sovrascritta con una falsa. Rifare l'OCR costa una chiamata e tiene
  //     onesto il verbale (§28).
  const untrustworthy = !stored || !!input.forceOcr
    || looksLikeScan({
      chars: stored.fullText!.trim().length,
      pages: stored.pages.length || 1,
      bytes: input.document.fileSize,
      extractionMethod: stored.extractionMethod === 'native_pdf' ? 'native_pdf' : 'text',
    });

  // ⚠️ 2026-07-29 — NON SI RIMANDA PIÙ INDIETRO IL TESTO SALVATO: si chiede al
  // server di rileggere la PROPRIA riga (`reuseStoredExtraction`).
  //
  // Prima, un'estrazione nata da un OCR veniva trattata come inaffidabile e
  // rifatta da capo — non perché fosse cattiva, ma perché rispedirla la avrebbe
  // fatta risalvare come `'text'`: `ClientExtraction` non conosce `'ocr'`. Si
  // pagava una trascrizione OCR intera per aggirare un difetto del trasporto.
  // E su un testo già tagliato a `MAX_CHARS` il server ricalcolava `truncated`
  // confrontando 120000 con 120000, cioè riportava a `false` un'analisi parziale.
  // Nessuna delle due cose passa più dal corpo della richiesta.
  const reuseStoredExtraction = !untrustworthy && !!stored;

  return await analysisService.analyzeAndPersist({
    document: input.document,
    extraction: null,
    reuseStoredExtraction,
    companyName: input.companyName,
    outputLanguage: input.outputLanguage,
    onProgress: input.onProgress,
  });
}
