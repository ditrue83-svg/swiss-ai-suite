// ============================================================================
// crmFields — la logica PURA dei campi personalizzati (migrazione 0047).
//
// I campi personalizzati sono ATTRIBUTI, non identità: un «numero cliente»
// uguale su due schede non le rende doppioni, e nessuna funzione qui dentro
// alimenta la deduplicazione o l'abbinamento automatico. L'identità restano
// l'IDI e l'email, come dichiara il modello (§25).
//
// ⚠️ LE REGOLE STANNO IN DUE POSTI, E DEVONO DIRE LA STESSA COSA. Il tipo di
// un valore lo pretende il DATABASE (`crm_field_value_problem`, 0047): ciò che
// controlla solo la schermata non è controllato. Le stesse regole stanno anche
// qui, perché il modulo che le subisce al salvataggio deve poterle SPIEGARE
// mentre si scrive — «non è un numero» sotto il campo, non un rifiuto dopo il
// clic su Salva. `test:crm-unit` prova che le due copie non divergono
// (gli enum TS contro quelli della migrazione, letti dal file SQL).
//
// ⚠️ NESSUN `tr()` A LIVELLO DI MODULO: le etichette si risolvono al render,
// nella lingua del momento. Chi ha bisogno di un testo riceve un CODICE
// (`'number'`, `'date'`, `'option'`) e lo traduce con le chiavi di
// `crm.fields`.
// ============================================================================
import type { CrmFieldEntity, CrmFieldType } from '@/types/database';
import type { CrmFieldDefinition } from '@/types/models';
import { giornoLocale, sembraDataPura } from '@/lib/calendarDays';
import { formatDate } from '@/lib/format';
import { getCurrentLocaleTag } from '@/i18n';

/** I tipi ammessi. DEVONO combaciare con l'enum `crm_field_type` della 0047:
 *  il test offline li confronta leggendo la migrazione — chi aggiunge un tipo
 *  qui senza migrare il database rompe la suite, ed è ciò che si vuole. */
export const CRM_FIELD_TYPES: readonly CrmFieldType[] = ['text', 'number', 'date', 'select'];

/** Le entità che possono portare campi personalizzati (Fase 0.4: SOLO queste). */
export const CRM_FIELD_ENTITIES: readonly CrmFieldEntity[] = ['organization', 'opportunity'];

/** Il tetto alle voci di una lista: lo stesso che il guardiano della 0047
 *  pretende (`crm_field_options_problem`). */
export const CRM_FIELD_OPTIONS_MAX = 200;

// ---------------------------------------------------------------------------
// Le OPZIONI di una lista, dal testo del modulo (una voce per riga).
//
// Il database NORMALIZZA (btrim a ogni voce) e RIFIUTA i doppioni con
// `crm_field_options_duplicate`: due «Altro» renderebbero il valore salvato
// ambiguo a schermo. Qui si fa la stessa distinzione: le righe vuote si
// ignorano (sono il modo in cui un testo si scrive, non una voce), ma il
// doppione è un ERRORE da mostrare, non qualcosa da togliere in silenzio —
// chi l'ha scritto due volte deve accorgersene.
// ---------------------------------------------------------------------------
export type FieldOptionsParse =
  | { kind: 'ok'; options: string[] }
  | { kind: 'empty' }
  | { kind: 'tooMany' }
  | { kind: 'duplicate'; value: string };

export function parseFieldOptions(raw: string): FieldOptionsParse {
  const options = raw.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (options.length === 0) return { kind: 'empty' };
  if (options.length > CRM_FIELD_OPTIONS_MAX) return { kind: 'tooMany' };
  const viste = new Set<string>();
  for (const option of options) {
    if (viste.has(option)) return { kind: 'duplicate', value: option };
    viste.add(option);
  }
  return { kind: 'ok', options };
}

// ---------------------------------------------------------------------------
// Il VALORE grezzo del modulo, verso ciò che il database accetta.
//
// `empty` NON è un errore: è «nessun valore», e al salvataggio cancella la
// riga (la riga esiste solo se porta un valore — 0047, sezione 3). L'errore è
// un valore presente ma non del tipo: porta il codice, la traduzione è della
// schermata.
// ---------------------------------------------------------------------------
export type FieldValueParse =
  | { kind: 'empty' }
  | { kind: 'ok'; value: string | number }
  | { kind: 'error'; code: 'number' | 'date' | 'option' };

export function parseFieldValue(
  def: Pick<CrmFieldDefinition, 'fieldType' | 'options'>,
  raw: string,
): FieldValueParse {
  const trimmed = raw.trim();
  switch (def.fieldType) {
    case 'text':
      return trimmed === '' ? { kind: 'empty' } : { kind: 'ok', value: trimmed };
    case 'number': {
      if (trimmed === '') return { kind: 'empty' };
      // La virgola decimale è un numero: «12,5» si scrive così in tutte e tre
      // le lingue dell'app. Stessa disciplina del modulo trattativa.
      const n = Number(trimmed.replace(',', '.'));
      return Number.isFinite(n) ? { kind: 'ok', value: n } : { kind: 'error', code: 'number' };
    }
    case 'date': {
      if (trimmed === '') return { kind: 'empty' };
      // Solo la data pura YYYY-MM-DD, e solo se esiste nel calendario:
      // «2026-02-30» non è una data difficile, è una data che non c'è — e
      // `giornoLocale` la riconosce invece di traboccare al 2 marzo.
      return sembraDataPura(trimmed) && giornoLocale(trimmed) !== null
        ? { kind: 'ok', value: trimmed }
        : { kind: 'error', code: 'date' };
    }
    case 'select':
      if (trimmed === '') return { kind: 'empty' };
      // La lista accetta solo ciò che elenca, come il guardiano del database:
      // un'opzione scritta a mano fuori dall'elenco renderebbe il filtro
      // futuro una bugia.
      return def.options.includes(trimmed)
        ? { kind: 'ok', value: trimmed }
        : { kind: 'error', code: 'option' };
  }
}

/** Le tre colonne tipate della 0047, di cui ESATTAMENTE una piena. È la forma
 *  in cui il servizio scrive: la scelta della colonna non si rifà a mano in
 *  due posti (inserimento e aggiornamento). */
export function valueColumns(
  def: Pick<CrmFieldDefinition, 'fieldType'>,
  value: string | number,
): { value_text: string | null; value_number: number | null; value_date: string | null } {
  if (def.fieldType === 'number') {
    return { value_text: null, value_number: typeof value === 'number' ? value : Number(value), value_date: null };
  }
  if (def.fieldType === 'date') {
    return { value_text: null, value_number: null, value_date: String(value) };
  }
  return { value_text: String(value), value_number: null, value_date: null };
}

/** Il valore come si MOSTRA. Il numero segue la lingua dell'interfaccia, con
 *  il raggruppamento SEMPRE acceso: il difetto misurato in `formatCurrency`
 *  (il separatore italiano che compariva solo da cinque cifre in su) qui non
 *  può rinascere. La data passa da `formatDate`, che delle date pure sa già
 *  tutto. */
export function formatFieldValue(
  def: Pick<CrmFieldDefinition, 'fieldType'>,
  value: string | number | null,
): string {
  if (value === null || value === '') return '—';
  if (def.fieldType === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return '—';
    // Nessun tetto ai decimali mostrati: il dato è dell'azienda e la
    // formattazione non deve arrotondarlo a una precisione scelta qui.
    return new Intl.NumberFormat(getCurrentLocaleTag(), {
      useGrouping: true, maximumFractionDigits: 20,
    }).format(n);
  }
  if (def.fieldType === 'date') return formatDate(String(value));
  return String(value);
}

/** L'ordine di comparsa in scheda: `position`, e a parità — due campi nati
 *  nello stesso secondo — l'istante di creazione e l'id. Lo stesso scioglimento
 *  della lettura nel database: due ordini diversi sulla stessa schermata
 *  sarebbero un enigma, non un dettaglio. */
export function sortFieldDefinitions(
  defs: readonly CrmFieldDefinition[],
): CrmFieldDefinition[] {
  return [...defs].sort((a, b) =>
    a.position - b.position
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id));
}

/** La posizione del prossimo campo creato: in fondo agli altri. */
export function nextFieldPosition(defs: readonly CrmFieldDefinition[]): number {
  return defs.reduce((max, d) => Math.max(max, d.position), -1) + 1;
}
