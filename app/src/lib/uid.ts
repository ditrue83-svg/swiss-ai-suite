// ============================================================================
// Numero IDI / UID svizzero (CHE-123.456.789).
// Formattazione + verifica della CIFRA DI CONTROLLO (mod-11), per intercettare
// errori di battitura e trasposizioni già in fase di inserimento.
//
// Algoritmo ufficiale: le prime 8 cifre sono pesate [5,4,3,2,7,6,5,4]; la somma
// dei prodotti mod 11 dà r; la cifra di controllo è 11-r (r=0 → 0). Se 11-r=10
// il numero non è valido (combinazione non attribuibile).
//
// NB: la verifica dice solo che il numero è FORMALMENTE coerente, NON che
// l'azienda esista (per quello serve il Registro IDI/Zefix).
// ============================================================================

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4];

/** Estrae le 9 cifre da un IDI scritto in qualunque forma; null se non plausibile. */
export function uidDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[\s.\-_/]/g, '');
  const m = cleaned.match(/^(?:CHE|CH)?(\d{9})$/);
  return m ? m[1] : null;
}

/** Cifra di controllo attesa per le prime 8 cifre; null se non attribuibile. */
export function expectedCheckDigit(first8: string): number | null {
  if (!/^\d{8}$/.test(first8)) return null;
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(first8[i]), 0);
  const check = 11 - (sum % 11);
  if (check === 10) return null;      // combinazione non valida
  return check === 11 ? 0 : check;
}

/** true se l'IDI è formalmente valido (9 cifre + cifra di controllo corretta). */
export function isValidUid(raw: string | null | undefined): boolean {
  const d = uidDigits(raw);
  if (!d) return false;
  const expected = expectedCheckDigit(d.slice(0, 8));
  return expected != null && expected === Number(d[8]);
}

/** Normalizza in "CHE-123.456.789"; null se non riconoscibile come IDI. */
export function formatUid(raw: string | null | undefined): string | null {
  const d = uidDigits(raw);
  return d ? `CHE-${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}` : null;
}
