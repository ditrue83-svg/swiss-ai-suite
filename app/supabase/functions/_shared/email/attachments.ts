// ============================================================================
// Politica sugli allegati: cosa entra nella pipeline documentale e cosa no.
//
// «Non fidarsi dell'estensione, del MIME dichiarato dal provider, del filename»
// (§15). Qui la fiducia è ordinata così:
//   1. i BYTE — la firma iniziale del file dice cosa il file è davvero;
//   2. il MIME dichiarato — usato solo per decidere se vale la pena scaricarlo;
//   3. il nome — non usato per decidere NULLA. Serve solo a mostrare qualcosa
//      all'utente, e viene sanificato prima di toccare un percorso di storage.
//
// La politica è DETERMINISTICA e dichiarata: per ogni allegato non importato
// resta scritto il perché, così l'utente sa che quel PDF non è stato letto e
// non lo scopre dall'assenza di una scadenza.
//
// Modulo puro e portabile.
// ============================================================================
import {
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE, MIN_IMAGE_ATTACHMENT_BYTES,
} from './contract.ts';
import type { NormalizedAttachment } from './types.ts';

/** Tipi che la pipeline sa trattare davvero (allineati al bucket, migrazione 0009). */
export const SUPPORTED_MIME = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/tiff',
  'text/plain',
]);

export type SkipReason =
  | 'inline'                  // immagine incorporata: firma, logo, tracciamento
  | 'unsupported_type'
  | 'too_large'
  | 'too_many'
  | 'empty'
  | 'content_mismatch';       // i byte non corrispondono al tipo dichiarato

export interface AttachmentDecision {
  attachment: NormalizedAttachment;
  accepted: boolean;
  reason: SkipReason | null;
  /** MIME normalizzato che si userà se accettato. */
  mimeType: string | null;
}

function normalizeMime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(';')[0]!.trim().toLowerCase();
  if (base === 'image/jpg') return 'image/jpeg';                  // alias diffuso, non standard
  if (base === 'text/plain') return 'text/plain';
  return base || null;
}

/**
 * Decide, PRIMA di scaricare, quali allegati vale la pena prendere. Non è una
 * garanzia sul contenuto — quella arriva dopo, guardando i byte — ma evita di
 * scaricare 40 MB di video per poi scartarli.
 */
export function planAttachments(attachments: NormalizedAttachment[]): AttachmentDecision[] {
  const out: AttachmentDecision[] = [];
  let accepted = 0;

  for (const attachment of attachments) {
    const mimeType = normalizeMime(attachment.declaredMimeType);
    const size = attachment.sizeBytes ?? 0;

    const decide = (reason: SkipReason | null): AttachmentDecision => {
      const ok = reason === null;
      if (ok) accepted++;
      return { attachment, accepted: ok, reason, mimeType: ok ? mimeType : null };
    };

    if (attachment.isInline) { out.push(decide('inline')); continue; }
    if (!mimeType || !SUPPORTED_MIME.has(mimeType)) { out.push(decide('unsupported_type')); continue; }
    if (size > MAX_ATTACHMENT_BYTES) { out.push(decide('too_large')); continue; }
    if (size === 0) { out.push(decide('empty')); continue; }
    // Un'immagine piccola in un'email è quasi sempre un logo. Il PDF non ha
    // questa soglia: un PDF di 3 KB può benissimo essere una lettera vera.
    if (mimeType.startsWith('image/') && size < MIN_IMAGE_ATTACHMENT_BYTES) {
      out.push(decide('inline'));
      continue;
    }
    if (accepted >= MAX_ATTACHMENTS_PER_MESSAGE) { out.push(decide('too_many')); continue; }
    out.push(decide(null));
  }

  return out;
}

/**
 * Riconosce il tipo dai BYTE. È il controllo che conta: un eseguibile rinominato
 * `fattura.pdf` e dichiarato `application/pdf` supera i due controlli precedenti
 * e si ferma qui.
 *
 * Non si tenta di riconoscere «tutto»: si verifica che i byte corrispondano al
 * tipo che ci si aspetta. Un tipo non confermato viene RIFIUTATO, non indovinato.
 */
export function sniffMatches(bytes: Uint8Array, expectedMime: string): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);

  switch (expectedMime) {
    case 'application/pdf':
      return starts(0x25, 0x50, 0x44, 0x46);                       // %PDF
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/webp':
      return starts(0x52, 0x49, 0x46, 0x46) &&                     // RIFF
             bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    case 'image/tiff':
      return starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a);
    case 'image/heic':
      // ISO-BMFF: `ftyp` in posizione 4, marca heic/heix/mif1.
      return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    case 'text/plain':
      // Un file di testo non contiene byte nulli. Il controllo è debole per
      // costruzione, ed è la ragione per cui `text/plain` non viene mai eseguito
      // né interpretato: viene letto come testo e basta.
      return !bytes.subarray(0, 4096).includes(0x00);
    default:
      return false;
  }
}

/**
 * Nome di file utilizzabile in un percorso di storage. L'input arriva dal
 * mittente dell'email, cioè da un estraneo: `../../altra-azienda/segreto.pdf` è
 * un nome perfettamente valido per un allegato (§28).
 *
 * Si tiene solo un insieme ristretto di caratteri e si toglie qualunque
 * separatore di percorso. Il risultato non è il nome originale — che resta nel
 * database, come dato — ma un nome sicuro da usare come chiave.
 */
export function safeAttachmentName(raw: string | null | undefined, fallbackExtension = ''): string {
  const base = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\\/]/g, '_')                       // separatori di percorso
    .replace(/\.{2,}/g, '.')                      // risalita di directory
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^[._-]+/, '')                       // niente file nascosti né nomi che iniziano per punto
    .slice(0, 120)
    .trim();
  if (base && base !== '.') return base;
  return `allegato${fallbackExtension}`;
}

/** Estensione coerente con il MIME accettato, per un nome leggibile. */
export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'application/pdf': return '.pdf';
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/webp': return '.webp';
    case 'image/heic': return '.heic';
    case 'image/tiff': return '.tiff';
    case 'text/plain': return '.txt';
    default: return '';
  }
}

/**
 * Sceglie l'allegato PRINCIPALE (§33): quello su cui vale la pena far girare
 * l'analisi documentale. Preferenza al PDF più grande, che nelle comunicazioni
 * amministrative è quasi sempre la lettera vera; le immagini vengono considerate
 * solo se non ci sono PDF.
 *
 * Restituisce null se non c'è un candidato: in quel caso l'analisi lavorerà sul
 * corpo del messaggio, che è la fonte principale.
 */
export function pickPrimaryAttachment<T extends { mimeType: string | null; sizeBytes: number | null }>(
  accepted: T[],
): T | null {
  if (!accepted.length) return null;
  const pdfs = accepted.filter((a) => a.mimeType === 'application/pdf');
  const pool = pdfs.length ? pdfs : accepted.filter((a) => a.mimeType !== 'text/plain');
  if (!pool.length) return null;
  return pool.reduce((best, current) => ((current.sizeBytes ?? 0) > (best.sizeBytes ?? 0) ? current : best));
}
