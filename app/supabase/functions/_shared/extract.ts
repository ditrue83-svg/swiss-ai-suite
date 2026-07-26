// ============================================================================
// Estrazione del testo da un file. Modulo portabile, con dependency injection.
//
// Perché esiste (2026-07-26): questa logica viveva dentro `analyze-document`.
// Con l'arrivo dell'Inbox serve anche alla sincronizzazione della posta, che
// deve leggere un PDF allegato senza passare da una richiesta HTTP con il JWT di
// un utente — un utente che, in una sincronizzazione automatica, non c'è.
//
// Copiarla sarebbe stato più veloce e sbagliato: due copie della trascrizione
// divergono, e il giorno in cui una delle due migliora l'altra resta indietro
// senza che nessuno se ne accorga. Vale qui la stessa scelta già fatta per
// `pipeline.ts`: un solo cervello, due chiamanti.
//
// ⚠️ `analyze-document` va RIDEPLOYATA insieme a questo file: importa da qui la
// funzione che prima aveva in casa. Il comportamento è identico.
// ============================================================================
import type { ExtractionResult } from './validate.ts';
import type { ModelMessage } from './pipeline.ts';

/** Limite di dimensione del file sottoposto a trascrizione (§28). */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export const OCR_MODEL = 'claude-opus-4-8';

const OCR_SYSTEM =
  'Trascrivi FEDELMENTE tutto il testo del documento, senza correggere né riassumere. ' +
  'Restituisci solo un oggetto JSON {"pages":[{"pageNumber":1,"text":"…"}],"fullText":"…"} ' +
  'con il testo per pagina. Nessun testo attorno al JSON.';

/** Il client AI del runtime chiamante: Edge Function o test. */
export type CreateVisionMessage = (request: unknown) => Promise<ModelMessage>;

/**
 * Base64 a blocchi. Concatenare carattere per carattere su file da megabyte
 * saturava la memoria dell'isolate: il problema era reale, la soluzione resta.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function buildOcrRequest(base64: string, mimeType: string | null) {
  const mt = mimeType ?? 'application/octet-stream';
  const isPdf = mt.includes('pdf');
  const source = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mt.startsWith('image/') ? mt : 'image/png', data: base64 } };

  return {
    model: OCR_MODEL,
    max_tokens: 8000,
    output_config: { effort: 'low' },
    system: OCR_SYSTEM,
    messages: [{ role: 'user', content: [source, { type: 'text', text: 'Trascrivi il testo di questo documento, pagina per pagina.' }] }],
  };
}

export function parseOcrResponse(msg: ModelMessage): ExtractionResult {
  const block = msg.content.find((b) => b.type === 'text' && typeof b.text === 'string');
  const raw = block?.text ?? '';
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  const pages = (Array.isArray(parsed.pages) ? parsed.pages : []).map((p: { pageNumber?: number; text?: string }, i: number) => ({
    pageNumber: typeof p.pageNumber === 'number' ? p.pageNumber : i + 1,
    text: String(p.text ?? ''),
  }));
  const fullText = typeof parsed.fullText === 'string' && parsed.fullText.trim()
    ? parsed.fullText
    : pages.map((p: { text: string }) => p.text).join('\n\n');
  return { fullText, pages: pages.length ? pages : [{ pageNumber: 1, text: fullText }], extractionMethod: 'ocr' };
}

/** Trascrizione via modello di un PDF o di un'immagine. */
export async function ocrExtract(input: {
  bytes: Uint8Array;
  mimeType: string | null;
  createMessage: CreateVisionMessage;
  maxBytes?: number;
}): Promise<ExtractionResult> {
  const limit = input.maxBytes ?? MAX_FILE_BYTES;
  // Il limite si applica ai byte REALI: `documents.file_size` lo scrive il
  // browser e non è una fonte attendibile.
  if (input.bytes.byteLength > limit) {
    const err = new Error('file troppo grande') as Error & { code?: string };
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
  const msg = await input.createMessage(buildOcrRequest(bytesToBase64(input.bytes), input.mimeType));
  return parseOcrResponse(msg);
}

/**
 * Estrazione da testo già disponibile (corpo di una email, allegato `text/plain`).
 * Non c'è nulla da trascrivere: il testo è già il testo, e dichiararlo con
 * `extractionMethod: 'text'` mantiene onesta la provenienza — non si spaccia per
 * OCR ciò che OCR non è.
 */
export function textExtraction(text: string): ExtractionResult {
  return { fullText: text, pages: [{ pageNumber: 1, text }], extractionMethod: 'text' };
}
