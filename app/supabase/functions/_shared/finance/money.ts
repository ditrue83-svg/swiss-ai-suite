// ============================================================================
// Importi monetari ESATTI. Nessun numero in virgola mobile, mai.
//
// ⚠️ PERCHÉ NON `number`. In JavaScript `0.1 + 0.2` non fa `0.3`, e su una
// fattura questo non è un dettaglio accademico: sommare l'imponibile e l'IVA per
// controllare che diano il totale è ESATTAMENTE l'operazione che il modulo deve
// fare, e farla in virgola mobile produce differenze di un centesimo su importi
// perfettamente corretti. Il risultato sarebbe una fattura giusta segnalata come
// incoerente — cioè il prodotto che dice il falso su un documento vero.
//
// Qui un importo è una coppia (cifre intere, posizione della virgola) su
// `bigint`: `1234.50` è `{ v: 123450n, scale: 2 }`. Le somme sono esatte per
// costruzione, il confronto pure, e verso il database si scrive una STRINGA
// decimale che Postgres riceve in una colonna `numeric` — anch'essa esatta.
// In nessun punto della catena esiste un `double`.
//
// ⚠️ NON SI CONVERTONO VALUTE (§22/§27). Due importi di valuta diversa non si
// sommano e non si confrontano: la funzione restituisce `null`, che chi chiama
// deve trattare come «non determinabile», non come zero.
//
// Modulo PORTABILE: solo funzioni pure, nessun import, nessun accesso al
// database. Lo leggono il worker (Deno), i test (Node) e il browser (Vite).
// ============================================================================

/** Un importo esatto: `v` sono le cifre, `scale` quante stanno dopo la virgola. */
export interface Decimal {
  v: bigint;
  scale: number;
}

/** Quante cifre decimali si accettano. Oltre, il numero non è un importo. */
const MAX_SCALE = 6;

export function decimal(v: bigint, scale: number): Decimal {
  return { v, scale };
}

export const ZERO: Decimal = { v: 0n, scale: 0 };

function pow10(n: number): bigint {
  let out = 1n;
  for (let i = 0; i < n; i++) out *= 10n;
  return out;
}

/** Porta due importi alla stessa scala senza perdere cifre: si sale, non si taglia. */
function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.v * pow10(scale - a.scale), b.v * pow10(scale - b.scale), scale];
}

export function add(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { v: x + y, scale };
}

export function sub(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { v: x - y, scale };
}

/** -1, 0, +1. Esatto: nessuna tolleranza implicita. */
export function cmp(a: Decimal, b: Decimal): number {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isZero(a: Decimal): boolean {
  return a.v === 0n;
}

export function isNegative(a: Decimal): boolean {
  return a.v < 0n;
}

export function abs(a: Decimal): Decimal {
  return { v: a.v < 0n ? -a.v : a.v, scale: a.scale };
}

export function negate(a: Decimal): Decimal {
  return { v: -a.v, scale: a.scale };
}

/**
 * Moltiplicazione per una percentuale, usata SOLO per ricalcolare un'IVA di
 * controllo. Il risultato NON viene arrotondato qui: chi confronta decide la
 * tolleranza, e arrotondare in silenzio nasconderebbe proprio la differenza che
 * si vuole misurare.
 */
export function mulRate(base: Decimal, ratePercent: Decimal): Decimal {
  return { v: base.v * ratePercent.v, scale: base.scale + ratePercent.scale + 2 };
}

/** Rappresentazione decimale canonica. È ciò che si scrive nel database. */
export function toString(a: Decimal): string {
  const neg = a.v < 0n;
  let digits = (neg ? -a.v : a.v).toString();
  if (a.scale === 0) return (neg ? '-' : '') + digits;
  while (digits.length <= a.scale) digits = '0' + digits;
  const whole = digits.slice(0, digits.length - a.scale);
  const frac = digits.slice(digits.length - a.scale);
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/**
 * Solo per la VISUALIZZAZIONE e per i confronti con soglie configurate.
 * ⚠️ Non usarlo per sommare: reintrodurrebbe il virgola mobile che questo
 * modulo esiste per evitare.
 */
export function toNumber(a: Decimal): number {
  return Number(toString(a));
}

// ---------------------------------------------------------------------------
// Lettura di un importo scritto da un essere umano
//
// ⚠️ IL PROBLEMA VERO SONO I SEPARATORI (§116). Sulle fatture che una PMI
// svizzera riceve convivono almeno tre convenzioni:
//
//     1'234.50     svizzera        apostrofo per le migliaia, punto decimale
//     1 234,50     francese        spazio (anche unificatore) per le migliaia
//     1.234,50     tedesca/italiana punto per le migliaia, virgola decimale
//     1,234.50     anglosassone    virgola per le migliaia, punto decimale
//
// Leggere `1.234` come «uno virgola duecentotrentaquattro» invece di
// «milleduecentotrentaquattro» sbaglia l'importo di un fattore mille, e lo
// sbaglia in modo PLAUSIBILE: nessuno se ne accorge guardando la schermata.
//
// La regola: l'ULTIMO separatore che compare decide, e solo se ciò che lo segue
// può essere una parte decimale (1 o 2 cifre, oppure 3 cifre ma allora è una
// migliaia). Dove resta ambiguo si restituisce `null`, che vuol dire «non l'ho
// letto», non «zero».
// ---------------------------------------------------------------------------

/** Separatori di migliaia ammessi, compresi gli spazi unificatori e stretti. */
const GROUP_CHARS = "'’    .,";

export interface ParsedAmount {
  amount: Decimal;
  /** Il testo esatto da cui è stato letto: serve alla citazione (§66). */
  raw: string;
}

/**
 * Legge un importo da un testo. Restituisce `null` quando non è determinabile:
 * mai un ripiego a zero, che sarebbe un importo inventato.
 */
export function parseAmount(input: string | null | undefined): ParsedAmount | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Si tiene solo la parte numerica: sigle di valuta, `CHF`, `Fr.`, `–` finali
  // dei prezzi svizzeri e spazi attorno non fanno parte del numero.
  let s = raw
    .replace(/[A-Za-z¤$€£]/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();

  // Un meno o un più iniziale, oppure un importo fra parentesi (negativo nella
  // convenzione contabile anglosassone).
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) { negative = true; s = paren[1].trim(); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim(); }
  else if (s.startsWith('+')) { s = s.slice(1).trim(); }

  // Il trattino finale della convenzione svizzera («1'234.–») vale «zero
  // centesimi», non un segno. ⚠️ Va risolto PRIMA di ripulire la coda: fatto
  // dopo, il separatore decimale è già stato tolto e questa riga non fa niente
  // — è stata scritta nell'ordine sbagliato una volta, e il numero tornava
  // senza i suoi due decimali.
  s = s.replace(/([.,])\s*-\s*$/, '$100');
  // Un separatore rimasto in coda non appartiene al numero.
  s = s.replace(/[-.,\s]+$/, '');

  if (!/[0-9]/.test(s)) return null;
  // Un testo che contiene qualcosa che non è cifra o separatore non è un importo.
  for (const ch of s) {
    if (!/[0-9]/.test(ch) && !GROUP_CHARS.includes(ch)) return null;
  }

  // Posizione dell'ultimo separatore: è quello che può essere il decimale.
  let lastSep = -1;
  let lastSepChar = '';
  for (let i = 0; i < s.length; i++) {
    if (GROUP_CHARS.includes(s[i])) { lastSep = i; lastSepChar = s[i]; }
  }

  let intPart: string;
  let fracPart: string;

  if (lastSep < 0) {
    intPart = s;
    fracPart = '';
  } else {
    const after = s.slice(lastSep + 1);
    if (!/^[0-9]*$/.test(after)) return null;

    // Uno spazio o un apostrofo non sono MAI separatori decimali: nessuna
    // convenzione li usa così.
    const canBeDecimal = lastSepChar === '.' || lastSepChar === ',';
    // Tre cifre dopo l'ultimo separatore = migliaia, a meno che quel separatore
    // sia l'unico e il numero sia corto (es. «0,123» non è un importo comune;
    // resta trattato come migliaia, ed è la lettura prudente).
    const decimalLike = canBeDecimal && after.length >= 1 && after.length <= 2;

    if (decimalLike) {
      intPart = s.slice(0, lastSep);
      fracPart = after;
    } else {
      intPart = s;
      fracPart = '';
    }
  }

  const digitsInt = intPart.replace(new RegExp(`[${GROUP_CHARS.replace(/[.\\\]^-]/g, '\\$&')}]`, 'g'), '');
  if (!/^[0-9]+$/.test(digitsInt)) return null;
  if (fracPart && !/^[0-9]+$/.test(fracPart)) return null;
  if (fracPart.length > MAX_SCALE) return null;

  const all = digitsInt + fracPart;
  // Numeri assurdamente lunghi non sono importi: è più probabile un numero di
  // riferimento letto male.
  if (all.length > 20) return null;

  const v = BigInt(all) * (negative ? -1n : 1n);
  return { amount: { v, scale: fracPart.length }, raw };
}

/**
 * Legge un importo E la sua valuta da un testo tipo «CHF 1'234.50» o
 * «1 234,50 EUR». La valuta si restituisce solo se è scritta: NON si presume
 * franchi perché il prodotto è svizzero (§49).
 */
export interface ParsedMoney extends ParsedAmount {
  currency: string | null;
}

/** Codici ISO 4217 in tre lettere, più le sigle comuni sulle fatture svizzere. */
const CURRENCY_WORDS: Record<string, string> = {
  CHF: 'CHF', FR: 'CHF', 'FR.': 'CHF', SFR: 'CHF', 'SFR.': 'CHF', FRS: 'CHF',
  EUR: 'EUR', '€': 'EUR', USD: 'USD', $: 'USD', USL: 'USD',
  GBP: 'GBP', '£': 'GBP',
};

export function parseMoney(input: string | null | undefined): ParsedMoney | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  let currency: string | null = null;
  const upper = raw.toUpperCase();
  for (const [word, iso] of Object.entries(CURRENCY_WORDS)) {
    // Confine di parola per non riconoscere «FR» dentro «FRANCHIGIA».
    const re = new RegExp(`(^|[^A-Z])${word.replace(/[.$€£]/g, '\\$&')}([^A-Z]|$)`);
    if (re.test(upper)) { currency = iso; break; }
  }

  const parsed = parseAmount(raw);
  if (!parsed) return null;
  return { ...parsed, currency };
}

/** Un codice valuta valido è tre lettere maiuscole. Non si inventa un ripiego. */
export function normalizeCurrency(input: string | null | undefined): string | null {
  const s = String(input ?? '').trim().toUpperCase();
  if (CURRENCY_WORDS[s]) return CURRENCY_WORDS[s];
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Coerenza degli importi (§51)
// ---------------------------------------------------------------------------

/**
 * La tolleranza ammessa nel confronto «imponibile + IVA = totale».
 *
 * ⚠️ NON È UN NUMERO SCELTO A CASO e non è una tolleranza «di sicurezza».
 * Su una fattura con più aliquote ogni riga viene arrotondata al centesimo, e la
 * somma delle righe arrotondate può discostarsi dal totale di qualche centesimo
 * senza che nulla sia sbagliato. Un centesimo per aliquota è la differenza che
 * l'arrotondamento può davvero produrre; oltre, è un dato letto male o un
 * documento incoerente — e in entrambi i casi va dichiarato, non nascosto.
 */
export function roundingTolerance(vatLineCount: number): Decimal {
  const lines = Math.max(1, Math.min(vatLineCount || 1, 10));
  return { v: BigInt(lines), scale: 2 };
}

export type AmountCheck =
  | { outcome: 'ok' }
  | { outcome: 'mismatch'; difference: Decimal }
  /** Manca un pezzo: NON è un errore della fattura, è un dato che non abbiamo. */
  | { outcome: 'not_determinable'; reason: 'missing_net' | 'missing_vat' | 'missing_gross' };

/**
 * Verifica `netto + IVA = lordo` entro la tolleranza di arrotondamento.
 *
 * ⚠️ Un dato mancante NON è una discordanza. §51 avverte esplicitamente di non
 * rifiutare documenti validi: una fattura senza IVA esposta (esente, estera,
 * fornitore non assoggettato) è perfettamente legittima, e segnalarla come
 * incoerente insegnerebbe a ignorare le segnalazioni.
 */
export function checkAmounts(input: {
  net: Decimal | null;
  vat: Decimal | null;
  gross: Decimal | null;
  vatLineCount?: number;
}): AmountCheck {
  if (!input.gross) return { outcome: 'not_determinable', reason: 'missing_gross' };
  if (!input.net) return { outcome: 'not_determinable', reason: 'missing_net' };
  if (!input.vat) return { outcome: 'not_determinable', reason: 'missing_vat' };

  const difference = sub(input.gross, add(input.net, input.vat));
  const tolerance = roundingTolerance(input.vatLineCount ?? 1);
  return cmp(abs(difference), tolerance) <= 0
    ? { outcome: 'ok' }
    : { outcome: 'mismatch', difference };
}

/** Somma di importi della STESSA valuta. Valute diverse → `null` (§22). */
export function sumSameCurrency(
  items: { amount: Decimal; currency: string | null }[],
): { amount: Decimal; currency: string } | null {
  const withCurrency = items.filter((i) => i.currency);
  if (!withCurrency.length) return null;
  const currency = withCurrency[0].currency as string;
  if (withCurrency.some((i) => i.currency !== currency)) return null;
  return {
    amount: withCurrency.reduce<Decimal>((acc, i) => add(acc, i.amount), ZERO),
    currency,
  };
}
