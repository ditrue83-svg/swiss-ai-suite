// ============================================================================
// Registro attività — le funzioni PURE della schermata (0039).
//
// Stanno qui e non nella pagina perché sono le uniche parti in cui un errore
// non si vede: un filtro di periodo che sbaglia il confine mostra un elenco
// PIÙ CORTO senza dire niente, e chi guarda un registro incompleto crede di
// aver visto tutto. `npm run test:audit-unit` le prova offline.
//
// ⚠️ Gli elenchi qui sotto sono la copia TypeScript degli enum della 0039.
// Due copie divergono sempre: il confronto con la migrazione lo fa il test
// unitario, non il typecheck — che vede solo il TypeScript.
// ============================================================================
import type { AuditAction, AuditEntityType } from '@/types/database';
import type { AuditChanges, AuditEntry } from '@/types/models';
import type { TKey } from '@/i18n';

export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'document_uploaded', 'document_deleted',
  'analysis_started', 'analysis_completed', 'analysis_failed',
  'correction_saved', 'reply_generated',
  'task_created', 'task_updated',
  'member_added', 'member_removed', 'member_role_changed',
] as const;

export const AUDIT_ENTITY_TYPES: readonly AuditEntityType[] = [
  'document', 'analysis', 'correction', 'reply', 'task', 'membership',
] as const;

/**
 * I periodi offerti dal filtro. `all` non è «nessun filtro per pigrizia»: è una
 * scelta esplicita, e la pagina dichiara quante righe sta mostrando su quante.
 */
export const AUDIT_PERIODS = ['7d', '30d', '90d', 'all'] as const;
export type AuditPeriod = (typeof AUDIT_PERIODS)[number];

export const DEFAULT_PERIOD: AuditPeriod = '30d';
/** Quante righe per pagina. Il resto si chiede: non si tronca in silenzio. */
export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilters {
  period: AuditPeriod;
  /** null = tutti i tipi. */
  action: AuditAction | null;
}

export const EMPTY_FILTERS: AuditFilters = { period: DEFAULT_PERIOD, action: null };

export const isAuditAction = (v: unknown): v is AuditAction =>
  typeof v === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(v);

export const isAuditPeriod = (v: unknown): v is AuditPeriod =>
  typeof v === 'string' && (AUDIT_PERIODS as readonly string[]).includes(v);

/**
 * ⚠️ Un valore assurdo NON diventa un filtro invisibile.
 *
 * `?tipo=pippo` non può restituire l'elenco filtrato per un tipo inesistente
 * (elenco vuoto senza spiegazione) né essere silenziosamente interpretato come
 * un tipo vero. Diventa «tutti i tipi», che è ciò che la pagina mostra anche
 * nella tendina: l'interfaccia e l'indirizzo dicono la stessa cosa.
 * Stessa scelta di `crmModel.filtersFromParams`.
 */
export function filtersFromParams(params: URLSearchParams): AuditFilters {
  const period = params.get('periodo');
  const action = params.get('tipo');
  return {
    period: isAuditPeriod(period) ? period : DEFAULT_PERIOD,
    action: isAuditAction(action) ? action : null,
  };
}

export function paramsFromFilters(f: AuditFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.period !== DEFAULT_PERIOD) p.set('periodo', f.period);
  if (f.action) p.set('tipo', f.action);
  return p;
}

/**
 * Istante da cui leggere, in ISO. `null` per «tutto».
 *
 * ⚠️ Si sottraggono GIORNI INTERI dall'istante attuale, e il confine è quindi
 * mobile: «7 giorni» significa «le ultime 168 ore», non «dal lunedì». È la
 * lettura che una persona si aspetta da un registro, e soprattutto è quella che
 * non cambia risultato a seconda del fuso orario in cui gira il browser.
 */
export function periodStart(period: AuditPeriod, now: Date): string | null {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null;
  if (days === null) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Chiave di traduzione dell'azione. Nessuna etichetta scritta a mano. */
export const actionLabelKey = (a: AuditAction): TKey => `audit.action.${a}` as TKey;

/** Chiave di traduzione del campo dentro `changes`. */
export const fieldLabelKey = (field: string): TKey => `audit.field.${field}` as TKey;

/**
 * CHI ha agito — e i casi sono QUATTRO, non due.
 *
 * ⚠️⚠️ IL DIFETTO CHE QUESTA FUNZIONE CHIUDE, visto in produzione il
 * 2026-08-09 sul dominio: il registro diceva «di una persona non più in
 * azienda» di gente che in azienda c'era, seduta accanto. Il ripiego era
 * `if (name) … else «non più in azienda»`, e `name` arriva da
 * `company_member_directory` come **stringa vuota** quando il profilo non ha né
 * nome né cognome (`memberService`: `display_name ?? ''`). Vuoto e assente
 * finivano nello stesso ramo.
 *
 * Non è una sfumatura di cortesia: il registro esiste per non confondere i
 * fatti, e «questa persona ha lasciato l'azienda» è un fatto — falso — su una
 * persona reale. Un titolare che legge chi ha cancellato un documento
 * concluderebbe che è stato qualcuno che se n'è andato.
 *
 * I quattro casi, con quattro risposte diverse:
 *   · nessun autore          → l'ha fatto il sistema (un trigger, un worker);
 *   · autore in rubrica, con nome  → il nome;
 *   · autore IN RUBRICA, senza nome → è in azienda, il suo profilo è vuoto;
 *   · autore non in rubrica  → non è più fra i membri di questa azienda.
 *
 * ⚠️ La rubrica va passata per intero e non come funzione «dammi il nome»:
 * la differenza fra «c'è ed è vuoto» e «non c'è» sopravvive solo se chi decide
 * può vedere le CHIAVI, ed è esattamente la differenza che si era persa.
 */
export type AuditActor =
  | { kind: 'name'; name: string }
  | { kind: 'system' }
  | { kind: 'noProfileName' }
  | { kind: 'former' };

export function actorOf(
  actorUserId: string | null,
  rubrica: Record<string, string>,
): AuditActor {
  if (actorUserId === null) return { kind: 'system' };
  if (!Object.prototype.hasOwnProperty.call(rubrica, actorUserId)) return { kind: 'former' };
  const nome = (rubrica[actorUserId] ?? '').trim();
  return nome ? { kind: 'name', name: nome } : { kind: 'noProfileName' };
}

/** La chiave di traduzione dei tre casi senza nome. `null` per il nome vero. */
export function actorLabelKey(actor: AuditActor): TKey | null {
  switch (actor.kind) {
    case 'system': return 'audit.actor.system' as TKey;
    case 'noProfileName': return 'audit.actor.noProfileName' as TKey;
    case 'former': return 'audit.actor.former' as TKey;
    default: return null;
  }
}

/**
 * I campi noti che i trigger della 0039 possono scrivere in `changes`.
 * Serve a due cose: dare un'etichetta tradotta, e accorgersi che ne è comparso
 * uno nuovo — nel test unitario, non davanti a un cliente con una chiave i18n
 * stampata in mezzo alla pagina.
 */
export const AUDIT_FIELDS: readonly string[] = [
  'title', 'filename', 'mime_type', 'file_size', 'source_type',
  'status', 'engine', 'provider', 'model', 'error_code',
  'field', 'language', 'tone',
  'priority', 'due_date', 'assignee', 'archived_at',
  'user', 'role',
] as const;

/**
 * `changes` arriva dal database come JSON generico: qui diventa un elenco
 * ordinato e prevedibile.
 *
 * ⚠️ Tollerante sulla FORMA, mai sul CONTENUTO: una voce che non ha la coppia
 * {before, after} viene SCARTATA invece di essere mostrata a metà. Una riga di
 * registro mostrata a metà è indistinguibile da un cambiamento che è avvenuto a
 * metà, e sono due cose molto diverse.
 */
export function changeEntries(changes: unknown): { field: string; before: string | null; after: string | null }[] {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return [];
  const out: { field: string; before: string | null; after: string | null }[] = [];
  for (const [field, raw] of Object.entries(changes as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const pair = raw as Record<string, unknown>;
    if (!('before' in pair) || !('after' in pair)) continue;
    const before = typeof pair.before === 'string' ? pair.before : pair.before === null ? null : String(pair.before);
    const after = typeof pair.after === 'string' ? pair.after : pair.after === null ? null : String(pair.after);
    // Entrambi nulli non è un cambiamento: è rumore, e in un registro il rumore
    // costa più di quanto renda.
    if (before === null && after === null) continue;
    out.push({ field, before, after });
  }
  // Ordine stabile: l'elenco non deve ballare fra due caricamenti della stessa
  // pagina solo perché il JSON ha restituito le chiavi in un altro ordine.
  return out.sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * Dove porta la riga.
 *
 * `correlationId` e non `entityId`: il filo di un'analisi, di una correzione o
 * di una risposta è il DOCUMENTO, che è l'unica di quelle cose che abbia una
 * schermata propria. Per un documento eliminato non si torna indietro: il
 * collegamento è `null`, perché una pagina che non esiste più non si offre.
 */
export function entryHref(entry: Pick<AuditEntry, 'action' | 'entityType' | 'correlationId'>): string | null {
  if (entry.action === 'document_deleted') return null;
  switch (entry.entityType) {
    case 'document':
    case 'analysis':
    case 'correction':
    case 'reply':
      return `/documenti/${entry.correlationId}`;
    case 'task':
      return `/attivita/${entry.correlationId}`;
    case 'membership':
      return '/azienda';
    default:
      return null;
  }
}

/** Le righe raggruppate per giorno, nell'ordine in cui arrivano (più recenti prima). */
export function groupByDay(entries: AuditEntry[]): { day: string; entries: AuditEntry[] }[] {
  const groups: { day: string; entries: AuditEntry[] }[] = [];
  for (const e of entries) {
    const day = e.createdAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(e);
    else groups.push({ day, entries: [e] });
  }
  return groups;
}

/** Forma di dominio a partire dalla riga del database. */
export function toChanges(raw: unknown): AuditChanges {
  const out: AuditChanges = {};
  for (const c of changeEntries(raw)) out[c.field] = { before: c.before, after: c.after };
  return out;
}
