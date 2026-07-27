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
// ============================================================================
import { analysisService, type AnalyzeOutcome } from '@/services/analysisService';
import { documentService } from '@/services/documentService';
import type { ClientExtraction } from './pdf';
import type { DocumentRecord } from '@/types/models';

export interface AnalyzeStoredInput {
  document: DocumentRecord;
  companyName: string | null;
  /** Lingua dell'interfaccia: i testi generati la seguono (§42). */
  outputLanguage: string;
  onProgress?: (step: string) => void;
}

export async function analyzeStoredDocument(input: AnalyzeStoredInput): Promise<AnalyzeOutcome> {
  const ext = await documentService.getExtraction(input.document.id);
  const extraction: ClientExtraction | null = ext?.fullText
    ? { fullText: ext.fullText, pages: ext.pages, extractionMethod: 'text' }
    : null;
  return await analysisService.analyzeAndPersist({
    document: input.document,
    extraction,
    companyName: input.companyName,
    outputLanguage: input.outputLanguage,
    onProgress: input.onProgress,
  });
}
