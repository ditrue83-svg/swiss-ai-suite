// ============================================================================
// COMPANY ASSISTANT — le date, prima della domanda
//
// §21 — «questa settimana» non è una data: è un intervallo, e dipende da dove
// si trova chi chiede. Questo modulo trasforma un periodo NOMINATO in due date
// esatte PRIMA che qualsiasi interrogazione parta. Il modello non calcola mai
// una data: sceglie un'etichetta da un elenco chiuso, e il calcolo lo fa qui il
// codice — deterministico, testabile, uguale a ogni esecuzione.
//
// ⚠️ PERCHÉ NON LASCIARLO AL MODELLO. Una data sbagliata di un giorno non ha
// l'aspetto di un errore: «la fattura scade venerdì» resta una frase credibile
// anche quando venerdì è quello sbagliato. È esattamente la classe di errori
// che §19 vuole fuori dalla testa del modello.
//
// ⚠️ PERCHÉ IL FUSO CONTA. Il database vive in UTC: `current_date` su Supabase
// alle 00:30 di Zurigo (ora legale) è ancora IERI. Un'attività che scade oggi
// risulterebbe già scaduta per mezz'ora ogni notte. Qui la data «di oggi» si
// calcola nel fuso di chi legge, e solo dopo diventa un filtro.
//
// Modulo PORTABILE (Deno + Node): nessun import, solo `Intl`, che entrambi i
// runtime forniscono con il database dei fusi completo.
// ============================================================================

/** Il fuso predefinito. È quello del prodotto e delle preferenze di notifica (0018). */
export const DEFAULT_TIME_ZONE = 'Europe/Zurich';

/**
 * I periodi che il modello può nominare. Elenco CHIUSO: un'etichetta non
 * prevista non viene interpretata «alla meglio», viene rifiutata.
 * Sono i periodi che compaiono davvero nelle domande di una PMI — non un
 * calendario generico.
 */
export const NAMED_PERIODS = [
  'today',
  'tomorrow',
  'yesterday',
  'this_week',
  'next_week',
  'this_month',
  'next_month',
  'last_7_days',
  'next_7_days',
  'last_30_days',
  'next_30_days',
  'next_90_days',
  'this_quarter',
  'this_year',
] as const;
export type NamedPeriod = (typeof NAMED_PERIODS)[number];

export interface DateRange {
  /** Estremi INCLUSIVI, in forma `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** Da che cosa è stato derivato: finisce nei parametri ripuliti del log. */
  source: NamedPeriod | 'explicit';
}

// ---------------------------------------------------------------------------
// Aritmetica su date civili
//
// Si lavora su (anno, mese, giorno) e non su millisecondi: sommare 86400000 a
// un istante attraversa il cambio dell'ora legale e produce un giorno di 23 o
// 25 ore. Qui una settimana sono sette giorni civili, sempre.
// ---------------------------------------------------------------------------

interface CivilDate { y: number; m: number; d: number }

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (c: CivilDate) => `${c.y}-${pad(c.m)}-${pad(c.d)}`;

/** Giorni dall'epoca per una data civile, con l'algoritmo di Howard Hinnant. */
function toDays({ y, m, d }: CivilDate): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDays(z: number): CivilDate {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: m <= 2 ? y + 1 : y, m, d };
}

const addDays = (c: CivilDate, n: number): CivilDate => fromDays(toDays(c) + n);

/** Lunedì = 1 … domenica = 7. La settimana svizzera comincia di lunedì. */
const isoWeekday = (c: CivilDate): number => ((toDays(c) + 3) % 7 + 7) % 7 + 1;

function lastDayOfMonth(y: number, m: number): number {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function addMonths(c: CivilDate, n: number): CivilDate {
  const total = c.y * 12 + (c.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = total % 12 + 1;
  // 31 gennaio + 1 mese = 28/29 febbraio, non il 3 marzo. È la stessa
  // semantica di Postgres, verificata nella 0024 per i preavvisi.
  return { y, m, d: Math.min(c.d, lastDayOfMonth(y, m)) };
}

// ---------------------------------------------------------------------------
// Da istante a data civile, nel fuso giusto
// ---------------------------------------------------------------------------

/**
 * La data civile di `instant` nel fuso `timeZone`.
 * `en-CA` produce già `YYYY-MM-DD`: nessuna ricostruzione manuale, nessun
 * rischio di invertire giorno e mese.
 */
export function civilDateIn(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(instant);
  } catch {
    // Un fuso non valido non deve far fallire una domanda: si ripiega su
    // quello del prodotto, che è la risposta giusta per quasi tutti gli utenti.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(instant);
  }
}

function parseCivil(iso: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > lastDayOfMonth(y, mo)) return null;
  return { y, m: mo, d };
}

/** Una data ISO valida, oppure null. Non «corregge» il 31 febbraio: lo rifiuta. */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const c = parseCivil(value);
  return c ? fmt(c) : null;
}

// ---------------------------------------------------------------------------
// La risoluzione
// ---------------------------------------------------------------------------

export const isNamedPeriod = (v: unknown): v is NamedPeriod =>
  typeof v === 'string' && (NAMED_PERIODS as readonly string[]).includes(v);

/** Trasforma un periodo nominato in due date esatte nel fuso di chi chiede. */
export function resolveNamedPeriod(period: NamedPeriod, now: Date, timeZone: string): DateRange {
  const today = parseCivil(civilDateIn(now, timeZone))!;
  const mk = (from: CivilDate, to: CivilDate): DateRange => ({ from: fmt(from), to: fmt(to), source: period });

  switch (period) {
    case 'today':        return mk(today, today);
    case 'tomorrow':     { const t = addDays(today, 1); return mk(t, t); }
    case 'yesterday':    { const t = addDays(today, -1); return mk(t, t); }
    case 'this_week': {
      const monday = addDays(today, 1 - isoWeekday(today));
      return mk(monday, addDays(monday, 6));
    }
    case 'next_week': {
      const monday = addDays(today, 8 - isoWeekday(today));
      return mk(monday, addDays(monday, 6));
    }
    case 'this_month': {
      const first = { y: today.y, m: today.m, d: 1 };
      return mk(first, { y: today.y, m: today.m, d: lastDayOfMonth(today.y, today.m) });
    }
    case 'next_month': {
      const n = addMonths({ y: today.y, m: today.m, d: 1 }, 1);
      return mk(n, { y: n.y, m: n.m, d: lastDayOfMonth(n.y, n.m) });
    }
    // Gli intervalli «ultimi N» e «prossimi N» INCLUDONO oggi: è come li
    // intende chi li dice, e sono N giorni in tutto, non N+1.
    case 'last_7_days':   return mk(addDays(today, -6), today);
    case 'next_7_days':   return mk(today, addDays(today, 6));
    case 'last_30_days':  return mk(addDays(today, -29), today);
    case 'next_30_days':  return mk(today, addDays(today, 29));
    case 'next_90_days':  return mk(today, addDays(today, 89));
    case 'this_quarter': {
      const qStart = Math.floor((today.m - 1) / 3) * 3 + 1;
      const qEnd = qStart + 2;
      return mk({ y: today.y, m: qStart, d: 1 }, { y: today.y, m: qEnd, d: lastDayOfMonth(today.y, qEnd) });
    }
    case 'this_year':     return mk({ y: today.y, m: 1, d: 1 }, { y: today.y, m: 12, d: 31 });
  }
}

export interface RangeInput {
  period?: unknown;
  from?: unknown;
  to?: unknown;
}

/**
 * L'intervallo effettivo di uno strumento.
 *
 * Precedenza: date esplicite → periodo nominato → nessun filtro. Se il modello
 * manda entrambi, vincono le date esplicite: sono l'informazione più precisa e
 * l'unica che l'utente può aver dettato lui.
 *
 * ⚠️ Ritorna `null` quando non c'è alcun filtro di data. `null` NON è «da
 * sempre a sempre»: è «nessun vincolo temporale», e chi chiama deve poterlo
 * distinguere per non applicare un intervallo che nessuno ha chiesto.
 */
export function resolveRange(input: RangeInput, now: Date, timeZone: string): DateRange | null {
  const from = parseIsoDate(input.from);
  const to = parseIsoDate(input.to);
  if (from || to) {
    // Un solo estremo è legittimo: «dopo il 1° marzo» non ha una fine.
    const a = from ?? '0001-01-01';
    const b = to ?? '9999-12-31';
    // Estremi invertiti: si raddrizzano invece di restituire zero righe, che
    // sarebbe indistinguibile da «non c'è nulla» (§28).
    return a <= b ? { from: a, to: b, source: 'explicit' } : { from: b, to: a, source: 'explicit' };
  }
  if (isNamedPeriod(input.period)) return resolveNamedPeriod(input.period, now, timeZone);
  return null;
}

/** La data di oggi nel fuso dell'utente: la base di «scaduto» e «in scadenza». */
export const todayIn = (now: Date, timeZone: string): string => civilDateIn(now, timeZone);

/**
 * §22 — nella risposta si preferiscono date concrete. Questa produce la forma
 * che il modello deve usare quando nomina una data: `2026-07-31`. La resa in
 * lingua («venerdì 31 luglio 2026») la fa l'interfaccia, che conosce il locale
 * dell'utente; il modello scrive la forma non ambigua e non deve tradurre i
 * nomi dei mesi a mente.
 */
export const asConcreteDate = (iso: string): string => iso;
