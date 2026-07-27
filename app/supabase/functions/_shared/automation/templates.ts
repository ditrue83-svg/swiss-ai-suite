// ============================================================================
// I modelli di testo: `Verifica {{document.title}}`.
//
// ⚠️ NON È UN MOTORE DI TEMPLATE, ED È LA COSA PIÙ IMPORTANTE DI QUESTO FILE.
// Non c'è valutazione di espressioni, non c'è accesso a proprietà arbitrarie,
// non ci sono cicli, condizioni, filtri o funzioni. C'è una SOSTITUZIONE di
// segnaposto presi da un elenco chiuso, dichiarato per ciascun innesco. Un
// `{{qualcosa.di.strano}}` non viene interpretato: viene rifiutato dal
// validatore prima che la regola possa essere salvata (§29/§105/§119).
//
// Il risultato è TESTO SEMPLICE. Non viene mai interpretato come markup, né qui
// né al render: è la stessa scelta fatta per il corpo delle email e per i
// commenti delle attività. Non esiste HTML da sanificare perché non esiste
// HTML, quindi non esiste il difetto «mi sono dimenticato di sanificare».
//
// ⚠️ E NON SI INVENTA NIENTE (§31).
// Se un segnaposto non ha valore — il mittente non è stato riconosciuto, la
// scadenza non c'è — il testo NON diventa «Verifica undefined» e nemmeno
// «Verifica ». Il modello dichiara quali segnaposto non ha potuto risolvere, e
// chi lo usa decide: per il TITOLO di un'attività l'azione viene saltata e lo
// storico lo dice, perché un titolo che ha perso il pezzo che lo rendeva
// riconoscibile non è più quel titolo.
//
// Modulo PORTABILE: nessun import fuori da questa cartella.
// ============================================================================
import type { Facts } from './facts.ts';

/** `{{ ... }}` con dentro solo lettere, punti e trattini bassi. Nient'altro. */
const PLACEHOLDER = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/gi;

/** I segnaposto presenti in un testo, in forma canonica `{{a.b}}`. */
export function placeholdersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(PLACEHOLDER)) {
    const canonical = `{{${m[1].toLowerCase()}}}`;
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}

export interface RenderResult {
  text: string;
  /** I segnaposto che non si sono potuti risolvere. Vuoto = tutto risolto. */
  missing: string[];
}

/**
 * Una data come la scrive una PMI svizzera: `31.08.2026`.
 *
 * Uguale in italiano, tedesco e francese — è la ragione per cui i segnaposto
 * ammessi sono solo valori che non hanno bisogno di essere tradotti.
 */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
}

/**
 * Un importo con l'apostrofo delle migliaia, come sugli avvisi svizzeri:
 * `5'000.00`. La valuta la aggiunge chi chiama, se ce l'ha.
 */
export function formatAmount(value: number, currency?: string | null): string {
  const fixed = Math.abs(value % 1) > 0 ? value.toFixed(2) : String(Math.trunc(value));
  const [intPart, decimals] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  const number = decimals ? `${grouped}.${decimals}` : grouped;
  return currency ? `${currency} ${number}` : number;
}

function renderValue(path: string, facts: Facts): string | null {
  const fact = facts[path];
  if (!fact || !fact.known || fact.value === null || fact.value === '') return null;

  if (typeof fact.value === 'number') return formatAmount(fact.value, fact.currency ?? null);
  if (typeof fact.value === 'boolean') return null;   // un booleano non è un testo per una persona

  const text = String(fact.value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return formatDate(text);
  return text;
}

/**
 * Sostituisce i segnaposto e dice quali non ha potuto risolvere.
 *
 * Il testo viene troncato alla lunghezza massima DOPO la sostituzione: un
 * titolo di documento lungo trecento caratteri non deve poter produrre un
 * titolo di attività lungo trecento caratteri.
 */
export function renderTemplate(
  template: string, facts: Facts, maxLength = 200,
): RenderResult {
  const missing: string[] = [];
  const text = String(template ?? '').replace(PLACEHOLDER, (_all, path: string) => {
    const key = String(path).toLowerCase();
    const value = renderValue(key, facts);
    if (value === null) {
      const canonical = `{{${key}}}`;
      if (!missing.includes(canonical)) missing.push(canonical);
      return '';
    }
    return value;
  });

  // Gli spazi lasciati da un segnaposto vuoto si richiudono: «Verifica  ·  »
  // non è un testo che qualcuno vorrebbe leggere. Serve anche a riconoscere che
  // non è rimasto niente di significativo.
  const cleaned = text.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  return { text: cleaned.slice(0, maxLength), missing };
}

/**
 * Il testo di un campo OBBLIGATORIO (il titolo di un'attività, il messaggio di
 * una notifica).
 *
 * Ritorna `null` quando un segnaposto non si è risolto o quando non è rimasto
 * testo utile: chi chiama SALTA l'azione e lo dichiara nello storico. È la
 * differenza fra «non l'ho fatto, ed ecco perché» e «l'ho fatto con un titolo
 * che non significa niente» — la seconda è un fallimento travestito da
 * successo, e questo progetto li considera il difetto peggiore.
 */
export function renderRequired(
  template: string, facts: Facts, maxLength = 200,
): { text: string } | { missing: string[] } {
  const result = renderTemplate(template, facts, maxLength);
  if (result.missing.length) return { missing: result.missing };
  // Un testo senza lettere non è un titolo: è quello che resta di un titolo.
  if (!/\p{L}|\p{N}/u.test(result.text)) return { missing: placeholdersIn(template) };
  return { text: result.text };
}
