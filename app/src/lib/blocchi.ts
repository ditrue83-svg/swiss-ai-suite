// ============================================================================
// A BLOCCHI — quando un elenco di identificativi non entra in un URL.
//
// ⚠️⚠️ IL LIMITE È DEL TRASPORTO, NON DELLA QUERY. PostgREST riceve i filtri
// nella query string: un `in.("…","…")` di 200 UUID pesa da solo circa 7,8 kB,
// e un URL oltre gli 8 kB viene rifiutato dal server PRIMA di diventare
// un'interrogazione. Non è un risultato sbagliato, è un guasto secco — e tocca
// per primo chi ha più dati, cioè l'azienda a cui il prodotto serve di più.
//
// ⚠️ STA IN `lib/` E NON DENTRO IL SERVIZIO, e non è pulizia: `services/`
// importa `lib/supabase`, che legge `import.meta.env`. Un test in Node non può
// caricarlo, quindi una regola scritta là dentro non si può provare se non
// leggendone il sorgente. È la stessa ragione per cui `calendarDaysUntil` è
// uscito da `DeadlineMark`.
// ============================================================================

/**
 * Quanti identificativi stanno in UNA sola `.in(...)`.
 *
 * 80 tiene un blocco sotto i 3,2 kB: un margine largo, non un numero scelto per
 * stare appena dentro il limite.
 */
export const BLOCCO_IN = 80;

/**
 * Spezza un elenco in blocchi di al più `n`, nell'ordine di partenza.
 *
 * ⚠️ I blocchi sono DISGIUNTI e non perdono niente: è l'unica proprietà che
 * serve perché la somma dei conteggi di ciascuno sia il conteggio del tutto.
 * Un elenco vuoto dà zero blocchi — cioè nessuna richiesta a vuoto.
 */
export function aBlocchi<T>(elenco: readonly T[], n: number): T[][] {
  const blocchi: T[][] = [];
  for (let i = 0; i < elenco.length; i += n) blocchi.push(elenco.slice(i, i + n));
  return blocchi;
}
