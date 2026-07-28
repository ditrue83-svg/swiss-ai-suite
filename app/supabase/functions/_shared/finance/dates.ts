// ============================================================================
// Lettura delle date di una fattura.
//
// ⚠️ IL PROBLEMA È `02.03.2026` (§118).
// In Svizzera, Germania, Francia e Italia significa 2 marzo. Nella convenzione
// anglosassone significa 3 febbraio. Le due letture differiscono di ventinove
// giorni, sono entrambe date valide, ed è impossibile distinguerle guardando il
// numero: nessun formato è «sbagliato», e una scadenza di pagamento letta con un
// mese di anticipo o di ritardo è esattamente il tipo di errore che questo
// prodotto esiste per non commettere.
//
// La regola qui:
//   · se una delle due componenti è > 12, non c'è ambiguità e si legge;
//   · se il mese è scritto in lettere (in una delle quattro lingue), non c'è
//     ambiguità e si legge;
//   · se il formato è ISO `AAAA-MM-GG`, non c'è ambiguità;
//   · se entrambe le componenti sono ≤ 12 si applica la convenzione EUROPEA
//     (giorno.mese) — ma la data torna con `ambiguous: true`, e chi la usa deve
//     dichiararlo. Una data ambigua che si presenta come certa è peggio di una
//     data mancante.
//
// Modulo PORTABILE: funzioni pure, nessun import, nessun accesso al database.
// ============================================================================

export interface ParsedDate {
  /** `AAAA-MM-GG`. È il formato con cui si scrive in una colonna `date`. */
  iso: string;
  /** Le due componenti erano entrambe ≤ 12: la lettura è una CONVENZIONE. */
  ambiguous: boolean;
  /** Il testo esatto da cui è stata letta, per la citazione (§66). */
  raw: string;
}

const MONTH_WORDS: Record<string, number> = {
  // italiano
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12,
  // tedesco
  januar: 1, februar: 2, marz: 3, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  jan: 1, mrz: 3, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, okt: 10, dez: 12,
  // francese — ⚠️ SOLO «novembre» si scrive identico all'italiano, e va quindi
  // dichiarato una volta sola (TS1117). «avril», «septembre» e «octobre» sono
  // parole DIVERSE da «aprile»/«april», «settembre»/«september» e
  // «ottobre»/«oktober»: toglierle renderebbe illeggibile una data francese.
  janvier: 1, fevrier: 2, mars: 3, avril: 4, juin: 6, juillet: 7,
  aout: 8, septembre: 9, octobre: 10, decembre: 12,
  janv: 1, fevr: 2, avr: 4, juil: 7, dec: 12,
  // inglese (fatture estere)
  january: 1, february: 2, march: 3, may: 5, june: 6, july: 7,
  october: 10, december: 12, oct: 10,
};

/** Toglie accenti e maiuscole: «Février» e «fevrier» sono lo stesso mese. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase();
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Anno a due cifre. `26` è il 2026, `98` il 1998.
 * La soglia è a 70 e vale finché il prodotto non incontra fatture di prima —
 * un limite dichiarato, non una scelta destinata a durare per sempre.
 */
function expandYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/**
 * Legge una data da un testo. `null` quando non è determinabile: non si
 * ripiega mai sulla data di oggi né su quella del documento.
 */
export function parseDate(input: string | null | undefined): ParsedDate | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  // (1) ISO — non ambiguo per definizione.
  const isoMatch = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (isoMatch) {
    const y = Number(isoMatch[1]), m = Number(isoMatch[2]), d = Number(isoMatch[3]);
    if (isValidYmd(y, m, d)) return { iso: iso(y, m, d), ambiguous: false, raw };
  }

  // (2) Mese in lettere: «12 agosto 2026», «12. August 2026», «August 12, 2026».
  const folded = fold(raw);
  for (const [word, month] of Object.entries(MONTH_WORDS)) {
    const idx = folded.indexOf(word);
    if (idx < 0) continue;
    // Confine di parola a destra: «mar» non deve riconoscersi dentro «martedi».
    const after = folded.slice(idx + word.length);
    if (/^[a-z]/.test(after)) continue;

    const before = folded.slice(0, idx);
    const dayBefore = /(\d{1,2})\.?\s*$/.exec(before);
    const dayAfter = /^\.?\s*(\d{1,2})(?!\d)/.exec(after);
    const yearMatch = /(\d{4})/.exec(after) ?? /(\d{4})/.exec(before);
    if (!yearMatch) continue;

    const day = dayBefore ? Number(dayBefore[1]) : dayAfter ? Number(dayAfter[1]) : NaN;
    const year = Number(yearMatch[1]);
    if (!Number.isFinite(day) || !isValidYmd(year, month, day)) continue;
    return { iso: iso(year, month, day), ambiguous: false, raw };
  }

  // (3) Numerica con separatori: `02.03.2026`, `02/03/26`, `2-3-2026`.
  const num = /(\d{1,4})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{1,4})/.exec(raw);
  if (!num) return null;
  const a = Number(num[1]), b = Number(num[2]), c = Number(num[3]);

  // `AAAA.MM.GG` con separatori diversi dal trattino.
  if (num[1].length === 4) {
    return isValidYmd(a, b, c) ? { iso: iso(a, b, c), ambiguous: false, raw } : null;
  }

  const year = expandYear(c);

  // Una delle due componenti supera 12: la lettura è FORZATA, quindi certa.
  if (a > 12 && b <= 12) {
    return isValidYmd(year, b, a) ? { iso: iso(year, b, a), ambiguous: false, raw } : null;
  }
  if (b > 12 && a <= 12) {
    // Solo la convenzione anglosassone mette il mese per primo. Il fatto che
    // qui sia l'unica lettura possibile la rende certa.
    return isValidYmd(year, a, b) ? { iso: iso(year, a, b), ambiguous: false, raw } : null;
  }

  // Entrambe ≤ 12: si applica la convenzione europea e SI DICHIARA l'ambiguità.
  if (!isValidYmd(year, b, a)) return null;
  return { iso: iso(year, b, a), ambiguous: true, raw };
}

/**
 * Una data di scadenza deve venire DOPO la data della fattura.
 *
 * ⚠️ Non «corregge» niente: dice soltanto se le due date, così come sono state
 * lette, si contraddicono. Invertirle d'ufficio sarebbe scegliere in silenzio
 * fra due letture, che è precisamente ciò che il capitolato vieta (§39/§47).
 */
export function dueAfterInvoice(invoiceDate: string | null, dueDate: string | null): boolean | null {
  if (!invoiceDate || !dueDate) return null;
  return dueDate >= invoiceDate;
}

/** Giorni di calendario da `fromIso` a `toIso`. Nessun fuso: sono date, non istanti. */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
