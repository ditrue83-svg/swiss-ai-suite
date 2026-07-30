// ============================================================================
// TEMPISTICA E FRESCHEZZA — due misure che il modulo 1.0 non aveva affatto.
//
// ⚠️ LA TEMPISTICA DIPENDE DALLA CALL, NON DAL PROGRAMMA (§2). Un programma
// esiste per anni; ci si candida solo quando una finestra è aperta. Tenerle
// insieme in un campo di testo — `application_window = "vedi sito"` — rendeva
// impossibile sia ordinare per scadenza sia avvisare qualcuno.
//
// ⚠️ L'URGENZA NON SI DEDUCE DAL TESTO (§73). «Presentare presto» scritto in
// una pagina non produce alcuna urgenza: servono una call realmente aperta,
// una scadenza strutturata e una fonte non scaduta. Questo file è il posto in
// cui quella regola diventa codice.
//
// Modulo PORTABILE: nessun import di runtime.
// ============================================================================

import type { CallStatus, FreshnessLevel, TimingState } from './contract.ts';
import { DEADLINE_SOON_DAYS, FRESHNESS_DAYS } from './contract.ts';

export interface CallLike {
  status: CallStatus;
  opensOn: string | null;
  deadlineOn: string | null;
  deadlineAt: string | null;
  continuous: boolean;
  checkedAt: string | null;
}

/** Giorni interi di CALENDARIO fra due date ISO, non millisecondi diviso 86400. */
export function daysBetween(fromISO: string, toISO: string): number | null {
  const a = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Lo stato temporale di un'opportunità.
 *
 * ⚠️ SENZA CALL LO STATO È `unknown`, NON `open`. Il modulo 1.0 presentava ogni
 * programma come sempre candidabile perché non aveva il concetto di finestra:
 * dire «aperto» quando non lo sappiamo è la bugia più costosa che questo
 * modulo possa raccontare, perché porta qualcuno a preparare una domanda per
 * una call chiusa.
 */
export function computeTiming(call: CallLike | null, today: string): TimingState {
  if (!call) return 'unknown';
  if (call.continuous || call.status === 'continuous') return 'continuous';
  if (call.status === 'closed') return 'closed';
  if (call.status === 'suspended') return 'unknown';
  if (call.status === 'upcoming') return 'upcoming';
  if (call.status === 'unknown') return 'unknown';

  // `open` dichiarato dalla fonte: si controlla comunque contro la scadenza,
  // perché una pagina può restare ferma dopo che il termine è passato.
  if (call.status === 'open') {
    if (call.deadlineOn) {
      const left = daysBetween(today, call.deadlineOn);
      if (left !== null && left < 0) return 'closed';
    }
    if (call.opensOn) {
      const toOpen = daysBetween(today, call.opensOn);
      if (toOpen !== null && toOpen > 0) return 'upcoming';
    }
    return 'open';
  }
  return 'unknown';
}

export interface DeadlineInfo {
  /** Giorni residui. `null` quando non esiste una scadenza strutturata. */
  daysLeft: number | null;
  /** Vero solo con una scadenza VERIFICATA e una call davvero aperta (§72). */
  urgent: boolean;
  /** L'ora esatta è nota? §7: nessun 23:59 dedotto da una data. */
  hasExactTime: boolean;
  /** La scadenza è già passata. */
  expired: boolean;
}

/**
 * ⚠️ L'URGENZA HA CINQUE CONDIZIONI (§72), e bastano quattro perché sia falsa:
 * call realmente aperta, scadenza verificata, fonte non scaduta, opportunità
 * non messa da parte, pratica non già inviata. Le ultime due le conosce il
 * chiamante e le passa: qui si controllano le prime tre.
 */
export function computeDeadline(
  call: CallLike | null,
  today: string,
  freshness: FreshnessLevel,
  opts: { dismissed?: boolean; submitted?: boolean } = {},
): DeadlineInfo {
  if (!call || !call.deadlineOn) {
    return { daysLeft: null, urgent: false, hasExactTime: false, expired: false };
  }
  const left = daysBetween(today, call.deadlineOn);
  const expired = left !== null && left < 0;
  const timing = computeTiming(call, today);

  const urgent =
    left !== null
    && left >= 0
    && left <= DEADLINE_SOON_DAYS
    && timing === 'open'
    // ⚠️ §26 — con una fonte scaduta non si crea urgenza certa: si dice di
    //    verificare la finestra sulla pagina ufficiale. Un promemoria basato
    //    su una data che non controlliamo da mesi è peggio di nessun promemoria.
    && freshness !== 'stale'
    && freshness !== 'unverified'
    && !opts.dismissed
    && !opts.submitted;

  return {
    daysLeft: left,
    urgent,
    hasExactTime: call.deadlineAt != null,
    expired,
  };
}

// ---------------------------------------------------------------------------
// Freschezza
// ---------------------------------------------------------------------------

export type FreshnessKind = keyof typeof FRESHNESS_DAYS;

/**
 * Quanto è aggiornato un dato, per TIPO di dato (§24).
 *
 * ⚠️ NON UNA SOGLIA UNICA. Con una sola soglia si finisce per allarmare su una
 * base legale in vigore da anni oppure per presentare come fresca la scadenza
 * di una call vecchia di tre mesi. Sono errori opposti e la causa è la stessa.
 *
 * ⚠️ `unverified` NON è «vecchio»: è «non l'abbiamo mai controllato». Le due
 * cose portano a due frasi diverse in interfaccia, e confonderle farebbe
 * sembrare verificato ciò che non lo è mai stato.
 */
export function computeFreshness(checkedAt: string | null, kind: FreshnessKind, today: string): FreshnessLevel {
  if (!checkedAt) return 'unverified';
  const age = daysBetween(checkedAt, today);
  if (age === null) return 'unverified';
  const t = FRESHNESS_DAYS[kind];
  if (age <= t.fresh) return 'fresh';
  if (age <= t.aging) return 'aging';
  return 'stale';
}

/**
 * La freschezza complessiva di un'opportunità: la PEGGIORE fra quelle dei dati
 * che la compongono.
 *
 * ⚠️ La peggiore e non la media: se la scadenza non è verificata da tre mesi,
 * il fatto che i requisiti siano freschi non rende affidabile la scadenza. Una
 * media direbbe «abbastanza aggiornato» proprio sul dato che porta qualcuno a
 * perdere un termine.
 */
export function worstFreshness(levels: readonly FreshnessLevel[]): FreshnessLevel {
  const order: FreshnessLevel[] = ['fresh', 'aging', 'stale', 'unverified'];
  let worst: FreshnessLevel = 'fresh';
  for (const l of levels) {
    if (order.indexOf(l) > order.indexOf(worst)) worst = l;
  }
  return levels.length ? worst : 'unverified';
}

/** Quando tocca ricontrollare una fonte, dato l'ultimo controllo riuscito. */
export function nextCheckAt(lastSuccessISO: string | null, frequencyDays: number, nowISO: string): string {
  if (!lastSuccessISO) return nowISO;
  const t = Date.parse(lastSuccessISO);
  if (!Number.isFinite(t)) return nowISO;
  return new Date(t + frequencyDays * 86_400_000).toISOString();
}
