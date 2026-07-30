// ============================================================================
// INCENTIVI (Subsidy AI 2.0) — la logica PURA della schermata.
//
// Sta qui e non nei componenti per la stessa ragione di `crmModel.ts` e
// `financeModel.ts`: ciò che si può sbagliare in silenzio — dire «scade fra 3
// giorni» su una call che non sappiamo se sia aperta, mostrare «pronta» una
// pratica con due passi obbligatori aperti — deve poter essere provato offline,
// senza rete e senza database.
//
// ⚠️ NESSUNA FUNZIONE DI QUESTO FILE VALUTA NIENTE. La rilevanza, l'idoneità,
//    la completezza, la tempistica, la freschezza e la prontezza le calcola il
//    motore (`_shared/subsidy/*`) e arrivano già fatte dal database. Qui si
//    decide solo COME MOSTRARLE e quando dichiarare che un dato non c'è.
//    Una seconda implementazione delle sei misure produrrebbe due risposte
//    diverse sulla stessa opportunità — la trappola che `list_documents` evita
//    facendo passare lista e dettaglio dalla stessa funzione SQL.
//
// ⚠️ L'URGENZA NON SI RICALCOLA QUI. `computeDeadline` è importata dal motore
//    condiviso: le cinque condizioni di §72 esistono in un posto solo, e una
//    copia lato browser che ne dimenticasse una — per esempio la freschezza —
//    metterebbe un rosso su una scadenza che non controlliamo da mesi.
// ============================================================================
import type { TKey } from '@/i18n';
import type {
  SubsidyCaseStatus, SubsidyCompleteness, SubsidyEligibilityStatus,
  SubsidyFreshness, SubsidyProjectStage, SubsidyReadiness, SubsidyRelevanceLevel,
  SubsidyTiming, SubsidyCallStatus, SubsidyCriterionState, SubsidyRuleHardness,
  SubsidyDismissalReason,
} from '@/types/database';
import type { IncentiveCase, IncentiveOpportunity } from '@/types/models';

// ---------------------------------------------------------------------------
// Le costanti del motore, ri-esportate
//
// Stessa scelta di `features/automations/registry.ts` e `financeModel.ts`: il
// browser legge le costanti dal modulo condiviso invece di ricopiarle. Quando
// una soglia cambia, cambia in un posto solo — e `test:subsidy-unit` verifica
// che il valore dichiarato dall'interfaccia sia quello che il motore applica.
// ---------------------------------------------------------------------------
export {
  DEADLINE_SOON_DAYS, RELEVANCE_HIGH_MIN, RELEVANCE_MEDIUM_MIN,
  SUBSIDY_PROJECT_TYPES, SUBSIDY_SECTORS, PROJECT_STAGES,
} from '../../../supabase/functions/_shared/subsidy/contract.ts';
export type {
  SubsidyProjectType, SubsidySector,
} from '../../../supabase/functions/_shared/subsidy/contract.ts';
export { computeDeadline, computeTiming } from '../../../supabase/functions/_shared/subsidy/timing.ts';

import { DEADLINE_SOON_DAYS } from '../../../supabase/functions/_shared/subsidy/contract.ts';
import { computeDeadline } from '../../../supabase/functions/_shared/subsidy/timing.ts';

// ---------------------------------------------------------------------------
// LE QUATTRO SCHEDE
//
// §1 racconta cinque entità — programma, versione, call, progetto, opportunità,
// pratica — e le schede ne raggruppano il lavoro in quattro domande:
//
//   Opportunità  «che cosa c'è per me, adesso»
//   Progetti     «di che cosa stiamo parlando»       (senza, non esiste domanda)
//   Pratiche     «a che punto sono le candidature»
//   Catalogo     «da dove viene quello che mi dite»  (fonte, versione, data)
//
// ⚠️ L'ORDINE NON È INDIFFERENTE. La scheda che si apre per prima è
//    Opportunità, perché è la risposta; Progetti viene subito dopo perché è la
//    domanda, e chi non ha ancora un progetto va accompagnato lì — non ci si
//    arriva dalla scheda giusta ma vuota.
//
// ⚠️ NON ESISTE UNA SCHEDA «PROFILO». Il modulo 1.0 ne aveva una, e i dati che
//    conteneva ora vivono in due posti veri: l'impresa in «Impostazioni
//    azienda», il progetto nella scheda Progetti. Una terza copia degli stessi
//    campi sarebbe la seconda verità che questo prodotto evita ovunque.
// ---------------------------------------------------------------------------
export const INCENTIVE_TABS = ['opportunities', 'projects', 'cases', 'catalog'] as const;
export type IncentiveTab = (typeof INCENTIVE_TABS)[number];

/**
 * I nomi nell'indirizzo sono in ITALIANO, come in Documenti, Finanze, Contratti
 * e Clienti. Un collegamento che una persona incolla in una email deve leggersi
 * allo stesso modo in tutti i moduli.
 */
export const TAB_PARAM: Record<IncentiveTab, string> = {
  opportunities: 'opportunita',
  projects: 'progetti',
  cases: 'pratiche',
  catalog: 'catalogo',
};

export const TAB_KEY: Record<IncentiveTab, TKey> = {
  opportunities: 'incentives.tabs.opportunities',
  projects: 'incentives.tabs.projects',
  cases: 'incentives.tabs.cases',
  catalog: 'incentives.tabs.catalog',
};

export function tabFromParam(value: string | null): IncentiveTab {
  for (const tab of INCENTIVE_TABS) if (TAB_PARAM[tab] === value) return tab;
  return 'opportunities';
}

// ---------------------------------------------------------------------------
// Le viste delle opportunità
//
// ⚠️ SONO GLI STESSI SETTE VALORI CHE `list_subsidy_opportunities` ACCETTA nel
//    parametro `p_view`. Un valore in più qui produrrebbe il ramo `else` della
//    funzione SQL — cioè «tutte» — sotto un'etichetta che promette un filtro:
//    un elenco non filtrato presentato come filtrato è esattamente il tipo di
//    bugia silenziosa che questo modulo vieta. Il test lo confronta con l'SQL.
// ---------------------------------------------------------------------------
export const OPPORTUNITY_VIEWS = [
  'all', 'new', 'high', 'to_verify', 'deadline', 'saved', 'dismissed',
] as const;
export type OpportunityView = (typeof OPPORTUNITY_VIEWS)[number];

export const VIEW_KEY: Record<OpportunityView, TKey> = {
  all: 'incentives.views.all',
  new: 'incentives.views.new',
  high: 'incentives.views.high',
  to_verify: 'incentives.views.toVerify',
  deadline: 'incentives.views.deadline',
  saved: 'incentives.views.saved',
  dismissed: 'incentives.views.dismissed',
};

/** Quante opportunità per pagina. Il database ne rende al massimo 200. */
export const OPPORTUNITY_PAGE_SIZE = 25;

export interface IncentiveFilters {
  tab: IncentiveTab;
  view: OpportunityView;
  /** `null` = tutti i progetti. Un identificativo = solo quel progetto (§61). */
  projectId: string | null;
  /** Progetti e pratiche archiviati. */
  archived: boolean;
  offset: number;
}

export const EMPTY_FILTERS: IncentiveFilters = {
  tab: 'opportunities', view: 'all', projectId: null, archived: false, offset: 0,
};

export function filtersFromParams(params: URLSearchParams): IncentiveFilters {
  const view = params.get('vista');
  const offset = Number(params.get('da') ?? '0');
  return {
    tab: tabFromParam(params.get('scheda')),
    view: OPPORTUNITY_VIEWS.includes(view as OpportunityView) ? (view as OpportunityView) : 'all',
    projectId: params.get('progetto') || null,
    archived: params.get('archiviati') === '1',
    // Un valore non numerico NON diventa una pagina qualsiasi: diventa la
    // prima. Interpretare `?da=pippo` come «pagina 3» mostrerebbe il vuoto
    // senza che nulla lo dichiari.
    offset: Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0,
  };
}

export function paramsFromFilters(f: IncentiveFilters): URLSearchParams {
  const p = new URLSearchParams();
  // La scheda predefinita non compare nell'indirizzo: `/incentivi` è già
  // «Opportunità», e scriverlo renderebbe più lungo il collegamento più comune.
  if (f.tab !== 'opportunities') p.set('scheda', TAB_PARAM[f.tab]);
  if (f.view !== 'all') p.set('vista', f.view);
  if (f.projectId) p.set('progetto', f.projectId);
  if (f.archived) p.set('archiviati', '1');
  if (f.offset > 0) p.set('da', String(f.offset));
  return p;
}

// ---------------------------------------------------------------------------
// Le etichette delle sei misure
//
// `Record` COMPLETI e non funzioni con ripiego: se domani una migrazione
// aggiungesse un valore a uno di questi enum, il compilatore fallirebbe QUI
// invece di lasciare in pagina una pastiglia vuota. È la disciplina di
// `crmModel.ts`, e in questo modulo pesa di più: una misura senza etichetta
// diventa una misura che l'utente interpreta a modo suo.
// ---------------------------------------------------------------------------
export const RELEVANCE_KEY: Record<SubsidyRelevanceLevel, TKey> = {
  high: 'incentives.relevance.high',
  medium: 'incentives.relevance.medium',
  low: 'incentives.relevance.low',
};

export const ELIGIBILITY_KEY: Record<SubsidyEligibilityStatus, TKey> = {
  not_assessed: 'incentives.eligibility.notAssessed',
  insufficient_information: 'incentives.eligibility.insufficient',
  potentially_eligible: 'incentives.eligibility.potentially',
  likely_ineligible: 'incentives.eligibility.likelyIneligible',
  ineligible: 'incentives.eligibility.ineligible',
};

export const COMPLETENESS_KEY: Record<SubsidyCompleteness, TKey> = {
  complete: 'incentives.completeness.complete',
  minor_gaps: 'incentives.completeness.minorGaps',
  major_gaps: 'incentives.completeness.majorGaps',
};

export const TIMING_KEY: Record<SubsidyTiming, TKey> = {
  open: 'incentives.timing.open',
  upcoming: 'incentives.timing.upcoming',
  closed: 'incentives.timing.closed',
  continuous: 'incentives.timing.continuous',
  unknown: 'incentives.timing.unknown',
};

export const FRESHNESS_KEY: Record<SubsidyFreshness, TKey> = {
  fresh: 'incentives.freshness.fresh',
  aging: 'incentives.freshness.aging',
  stale: 'incentives.freshness.stale',
  // ⚠️ «Mai verificata» e «vecchia» sono due frasi diverse, e il database le
  //    distingue apposta: `unverified` non è un vecchio molto vecchio, è
  //    l'assenza di qualunque controllo.
  unverified: 'incentives.freshness.unverified',
};

export const READINESS_KEY: Record<SubsidyReadiness, TKey> = {
  not_started: 'incentives.readiness.notStarted',
  in_preparation: 'incentives.readiness.inPreparation',
  ready: 'incentives.readiness.ready',
  submitted: 'incentives.readiness.submitted',
};

export const CALL_STATUS_KEY: Record<SubsidyCallStatus, TKey> = {
  upcoming: 'incentives.callStatus.upcoming',
  open: 'incentives.callStatus.open',
  closed: 'incentives.callStatus.closed',
  continuous: 'incentives.callStatus.continuous',
  suspended: 'incentives.callStatus.suspended',
  unknown: 'incentives.callStatus.unknown',
};

export const CASE_STATUS_KEY: Record<SubsidyCaseStatus, TKey> = {
  draft: 'incentives.caseStatus.draft',
  assessing: 'incentives.caseStatus.assessing',
  collecting_documents: 'incentives.caseStatus.collecting',
  ready: 'incentives.caseStatus.ready',
  submitted: 'incentives.caseStatus.submitted',
  under_review: 'incentives.caseStatus.underReview',
  approved: 'incentives.caseStatus.approved',
  rejected: 'incentives.caseStatus.rejected',
  withdrawn: 'incentives.caseStatus.withdrawn',
  closed: 'incentives.caseStatus.closed',
};

export const STAGE_KEY: Record<SubsidyProjectStage, TKey> = {
  idea: 'incentives.stages.idea',
  planned: 'incentives.stages.planned',
  started: 'incentives.stages.started',
  completed: 'incentives.stages.completed',
  cancelled: 'incentives.stages.cancelled',
};

export const CRITERION_STATE_KEY: Record<SubsidyCriterionState, TKey> = {
  satisfied: 'incentives.criteria.satisfied',
  not_satisfied: 'incentives.criteria.notSatisfied',
  unknown: 'incentives.criteria.unknown',
  conflicting: 'incentives.criteria.conflicting',
  not_evaluable: 'incentives.criteria.notEvaluable',
};

export const HARDNESS_KEY: Record<SubsidyRuleHardness, TKey> = {
  hard: 'incentives.hardness.hard',
  soft: 'incentives.hardness.soft',
  exclusion: 'incentives.hardness.exclusion',
  informative: 'incentives.hardness.informative',
};

export const DISMISSAL_REASONS: readonly SubsidyDismissalReason[] = [
  'not_relevant', 'already_applied', 'not_now', 'project_cancelled', 'other',
];

export const DISMISSAL_KEY: Record<SubsidyDismissalReason, TKey> = {
  not_relevant: 'incentives.dismiss.notRelevant',
  already_applied: 'incentives.dismiss.alreadyApplied',
  not_now: 'incentives.dismiss.notNow',
  project_cancelled: 'incentives.dismiss.projectCancelled',
  other: 'incentives.dismiss.other',
};

// ---------------------------------------------------------------------------
// I toni
//
// ⚠️ REGOLA 8 DEL SISTEMA DI DESIGN: un solo colore forte per riga. Le sei
//    misure sono sei, e se ognuna portasse il suo rosso una riga con quattro
//    problemi diventerebbe illeggibile — «due avvisi rossi affiancati non
//    dicono due volte urgente, dicono non guardare».
//
//    Quindi: il colore lo porta SOLO l'idoneità, che è la misura che cambia
//    quello che fai. Tutte le altre sono testo neutro con la loro etichetta.
//    Il secondo colore forte della riga è riservato alla scadenza, e solo
//    quando `computeDeadline` la dichiara urgente — cioè quasi mai.
// ---------------------------------------------------------------------------
export const ELIGIBILITY_TONE: Record<SubsidyEligibilityStatus, string> = {
  not_assessed: 'badge-neutral',
  insufficient_information: 'badge-media',
  potentially_eligible: 'badge-blue',
  likely_ineligible: 'badge-media',
  ineligible: 'badge-neutral',
};

export const CRITERION_TONE: Record<SubsidyCriterionState, string> = {
  satisfied: 'badge-bassa',
  not_satisfied: 'badge-alta',
  unknown: 'badge-neutral',
  conflicting: 'badge-media',
  not_evaluable: 'badge-neutral',
};

// ---------------------------------------------------------------------------
// La scadenza
// ---------------------------------------------------------------------------

export interface DeadlineNotice {
  /** Giorni residui, `null` quando non esiste una scadenza strutturata. */
  daysLeft: number | null;
  /** Vero solo con le cinque condizioni di §72. Lo decide il motore condiviso. */
  urgent: boolean;
  expired: boolean;
  /** §7 — l'ora è nota? Nessun 23:59 dedotto da una data. */
  hasExactTime: boolean;
  /**
   * ⚠️ Vero quando esiste una scadenza ma la fonte è vecchia o mai controllata:
   * la schermata dice «verifica la finestra sulla pagina ufficiale» invece di
   * mostrare un conto alla rovescia. Un promemoria su una data che non
   * controlliamo da mesi è peggio di nessun promemoria (§26).
   */
  verifyOnSource: boolean;
}

/**
 * La scadenza di un'opportunità, con l'urgenza calcolata DAL MOTORE.
 *
 * `today` è un parametro e non `new Date()` dentro la funzione: è ciò che rende
 * il comportamento provabile senza congelare l'orologio, ed è la stessa scelta
 * di `taskFormat` e `contractModel`.
 */
export function deadlineNotice(opp: IncentiveOpportunity, today: string): DeadlineNotice {
  const info = computeDeadline(
    opp.callDeadlineOn
      ? {
        status: opp.callStatus ?? 'unknown',
        opensOn: null,
        deadlineOn: opp.callDeadlineOn,
        deadlineAt: opp.callDeadlineAt,
        continuous: opp.callContinuous,
        // ⚠️ `checkedAt` NON serve a `computeDeadline` — la freschezza gliela
        //    passa il chiamante come parametro a sé — e `list_subsidy_opportunities`
        //    non lo rende. Si dichiara `null`, che è la verità su ciò che
        //    sappiamo, invece di inventare una data di controllo.
        checkedAt: null,
      }
      : null,
    today,
    opp.sourceFreshness,
    { dismissed: opp.dismissedAt !== null, submitted: opp.readiness === 'submitted' },
  );
  const staleSource = opp.sourceFreshness === 'stale' || opp.sourceFreshness === 'unverified';
  return {
    daysLeft: info.daysLeft,
    urgent: info.urgent,
    expired: info.expired,
    hasExactTime: info.hasExactTime,
    verifyOnSource: info.daysLeft !== null && !info.expired && staleSource,
  };
}

/**
 * La scadenza di una PRATICA. Due date e non una (§118): quella ufficiale è
 * della call e non si tocca, quella interna la sceglie l'impresa.
 *
 * ⚠️ Si guarda la PIÙ VICINA fra le due, ma si dichiara SEMPRE quale delle due
 *    è: dire «fra 5 giorni» senza dire «interna» farebbe credere che l'autorità
 *    chiuda fra cinque giorni.
 */
export interface CaseDeadline {
  kind: 'official' | 'internal';
  date: string;
  daysLeft: number;
  expired: boolean;
}

export function caseDeadline(item: IncentiveCase, today: string): CaseDeadline | null {
  const options: CaseDeadline[] = [];
  for (const [kind, date] of [
    ['official', item.officialDeadline] as const,
    ['internal', item.internalDeadline] as const,
  ]) {
    if (!date) continue;
    const days = daysBetweenDates(today, date);
    if (days === null) continue;
    options.push({ kind, date, daysLeft: days, expired: days < 0 });
  }
  if (options.length === 0) return null;
  // ⚠️ Una scadenza già passata vince su una futura: è quella su cui bisogna
  //    fare qualcosa. Ordinare solo per «più vicina nel tempo» metterebbe in
  //    evidenza la prossima settimana e nasconderebbe il termine mancato ieri.
  options.sort((a, b) => a.daysLeft - b.daysLeft);
  return options[0] ?? null;
}

/** Giorni di CALENDARIO fra due date `YYYY-MM-DD`, non millisecondi diviso 86400000. */
export function daysBetweenDates(fromISO: string, toISO: string): number | null {
  const a = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** La data di oggi in `YYYY-MM-DD`, ora locale. Un solo posto che legge l'orologio. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// «Che cosa devo fare adesso»
//
// §43 — è la domanda a cui il modulo 1.0 non rispondeva. Le sei misure dicono
// come sta un'opportunità; questa funzione dice qual è il gesto successivo.
//
// ⚠️ L'ORDINE È UNA GERARCHIA DI CAUSE, non una scaletta di comodo. Un
//    programma non concedibile oggi rende inutile parlare di criteri; una call
//    chiusa rende inutile parlare di documenti. Si dice la cosa che, se
//    ignorata, rende false tutte le altre.
//
// ⚠️ NON esiste il ramo «candidati adesso»: il prodotto non invia domande. Il
//    massimo che dice è «apri una pratica», che è lavoro di preparazione.
// ---------------------------------------------------------------------------
export type NextStep =
  | 'suspended'      // il programma esiste ma oggi non viene concesso
  | 'retired'        // lo strumento non esiste più
  | 'closed'         // la finestra è chiusa
  | 'ineligible'     // i criteri escludono
  | 'stale'          // la valutazione è da aggiornare
  | 'answer'         // ci sono criteri aperti: rispondere
  | 'complete'       // mancano dati del progetto o del profilo
  | 'verifySource'   // la fonte è vecchia: controllare sulla pagina ufficiale
  | 'openCase'       // si può aprire una pratica
  | 'inCase'         // la pratica esiste già
  | 'watch';         // niente da fare adesso

export const NEXT_STEP_KEY: Record<NextStep, TKey> = {
  suspended: 'incentives.next.suspended',
  retired: 'incentives.next.retired',
  closed: 'incentives.next.closed',
  ineligible: 'incentives.next.ineligible',
  stale: 'incentives.next.stale',
  answer: 'incentives.next.answer',
  complete: 'incentives.next.complete',
  verifySource: 'incentives.next.verifySource',
  openCase: 'incentives.next.openCase',
  inCase: 'incentives.next.inCase',
  watch: 'incentives.next.watch',
};

export function nextStep(opp: IncentiveOpportunity, today: string): NextStep {
  if (opp.programAvailability === 'suspended') return 'suspended';
  if (opp.programLifecycle === 'retired') return 'retired';
  if (opp.caseId) return 'inCase';
  if (opp.eligibilityStatus === 'ineligible') return 'ineligible';
  // ⚠️ «Chiusa» viene DOPO l'esclusione e PRIMA dei criteri: a una finestra
  //    chiusa non serve rispondere a nulla, ma un'impresa esclusa deve saperlo
  //    anche se la finestra è aperta.
  const notice = deadlineNotice(opp, today);
  if (opp.timing === 'closed' || notice.expired) return 'closed';
  if (opp.assessmentStale) return 'stale';
  if (opp.openCriteriaCount > 0) return 'answer';
  if (opp.missingFactCount > 0) return 'complete';
  if (notice.verifyOnSource) return 'verifySource';
  if (opp.eligibilityStatus === 'potentially_eligible'
      && (opp.timing === 'open' || opp.timing === 'continuous')) return 'openCase';
  return 'watch';
}

// ---------------------------------------------------------------------------
// La checklist di una pratica
// ---------------------------------------------------------------------------

export interface ChecklistProgress {
  total: number;
  done: number;
  /** Passi OBBLIGATORI ancora aperti. È il numero che decide se si è pronti. */
  requiredOpen: number;
  /** Percentuale intera 0–100. `null` quando non c'è nessun passo. */
  percent: number | null;
}

/**
 * ⚠️ A ZERO PASSI LA PERCENTUALE È `null`, NON 0 e NON 100.
 *
 * È la regola grafica del sistema di design applicata a un numero: una barra a
 * valore zero non disegna niente, e «0%» su una checklist vuota racconta un
 * lavoro appena cominciato dove invece non è stato ancora definito. `null`
 * lascia la schermata libera di dire «nessun passo definito», che è la verità.
 */
export function checklistProgress(item: IncentiveCase): ChecklistProgress {
  const total = item.itemsTotal;
  const done = Math.min(item.itemsDone, total);
  return {
    total,
    done,
    requiredOpen: item.itemsRequiredOpen,
    percent: total === 0 ? null : Math.round((done / total) * 100),
  };
}

/**
 * ⚠️ «Pronta» NON è «tutti i passi spuntati»: è «nessun passo OBBLIGATORIO
 *    aperto». Un passo facoltativo lasciato indietro non impedisce di
 *    candidarsi, e pretenderlo bloccherebbe una pratica completa.
 *
 * ⚠️ E soprattutto NON dichiara pronta una pratica senza passi: una checklist
 *    vuota non è una checklist finita. §115 — dedurre il completamento
 *    dall'assenza di lavoro è il modo più elegante di dichiarare pronta una
 *    pratica che non lo è.
 */
export function canMarkReady(item: IncentiveCase): boolean {
  return item.itemsTotal > 0 && item.itemsRequiredOpen === 0;
}

// ---------------------------------------------------------------------------
// Gli stati di una pratica
//
// §106 — non è una macchina a stati rigida: una PMI torna indietro, sospende,
// ritira. Ma alcune transizioni sono FALSE, e quelle non si offrono:
//
//   · da `submitted` non si torna a `draft`: l'invio è un fatto registrato con
//     data e persona, e cancellarlo riscriverebbe la storia. Si ritira.
//   · un esito (`approved`/`rejected`) richiede una pratica inviata: lo impone
//     anche il trigger `subsidy_case_guard`, e offrirlo dall'interfaccia
//     produrrebbe un errore del database invece di un'azione impossibile.
//   · `withdrawn` e `closed` sono terminali: da lì si archivia, non si prosegue.
//
// ⚠️ Questa funzione NON è la garanzia: la garanzia è il trigger. Serve a non
//    offrire un pulsante che il database rifiuterebbe — che è una cosa diversa
//    e altrettanto necessaria.
// ---------------------------------------------------------------------------
const CASE_FLOW: Record<SubsidyCaseStatus, readonly SubsidyCaseStatus[]> = {
  draft: ['assessing', 'collecting_documents', 'withdrawn'],
  assessing: ['collecting_documents', 'draft', 'withdrawn'],
  collecting_documents: ['ready', 'assessing', 'withdrawn'],
  ready: ['submitted', 'collecting_documents', 'withdrawn'],
  submitted: ['under_review', 'approved', 'rejected', 'withdrawn'],
  under_review: ['approved', 'rejected', 'withdrawn'],
  approved: ['closed'],
  rejected: ['closed'],
  withdrawn: ['closed'],
  closed: [],
};

export function nextStatuses(item: IncentiveCase): readonly SubsidyCaseStatus[] {
  const allowed = CASE_FLOW[item.status];
  // «Pronta» si offre solo quando lo è davvero: proporla con tre documenti
  // obbligatori mancanti farebbe della checklist un ornamento.
  if (!canMarkReady(item)) return allowed.filter((s) => s !== 'ready');
  return allowed;
}

/** Gli stati in cui una pratica è ancora lavoro aperto, per i conteggi. */
export function isOpenCase(status: SubsidyCaseStatus): boolean {
  return status !== 'closed' && status !== 'submitted'
    && status !== 'approved' && status !== 'rejected' && status !== 'withdrawn';
}

// ---------------------------------------------------------------------------
// Le validazioni del modulo progetto
//
// ⚠️ SONO LE STESSE DEL TRIGGER `subsidy_projects_guard`, e la ragione per cui
//    esistono due volte è dichiarata: il database GARANTISCE, l'interfaccia
//    SPIEGA. Senza il controllo qui, un importo senza valuta arriverebbe al
//    server e tornerebbe come `23514` — un codice, in italiano, dentro
//    un'interfaccia tedesca. Senza il controllo là, basterebbe una chiamata
//    diretta per scriverlo comunque.
// ---------------------------------------------------------------------------
export interface ProjectDraft {
  title: string;
  budgetAmount: number | null;
  budgetCurrency: string | null;
  estimatedStartDate: string | null;
  estimatedEndDate: string | null;
}

export function validateProject(draft: ProjectDraft): TKey | null {
  const title = draft.title.trim();
  if (title.length < 1) return 'incentives.errors.titleRequired';
  if (title.length > 200) return 'incentives.errors.titleTooLong';
  // §67 — un importo senza valuta non è un importo: non si assume CHF perché
  // l'app è svizzera.
  if (draft.budgetAmount !== null && !draft.budgetCurrency) return 'incentives.errors.currencyRequired';
  if (draft.budgetAmount !== null && draft.budgetAmount < 0) return 'incentives.errors.amountNegative';
  if (draft.estimatedStartDate && draft.estimatedEndDate
      && draft.estimatedEndDate < draft.estimatedStartDate) return 'incentives.errors.datesInverted';
  return null;
}

/**
 * I codici che i guardiani della 0032 sollevano → una chiave di traduzione.
 *
 * ⚠️ Senza questa mappatura `subsidy_project_currency_required` arriverebbe a
 *    schermo così com'è: `toUserMessage` non conosce `23514`. È la stessa
 *    funzione che il CRM ha dovuto scrivere per le proprie guardie, e la stessa
 *    trappola che i Contratti hanno documentato senza chiuderla.
 *
 * Per i codici che non conosciamo si torna `null` e il chiamante mostra il
 * messaggio del server — il valore GREZZO, non una categoria inventata.
 */
export function subsidyErrorKey(error: unknown): TKey | null {
  const raw = error as { message?: string; hint?: string; details?: string } | null;
  const text = `${raw?.message ?? ''} ${raw?.hint ?? ''} ${raw?.details ?? ''}`;
  if (text.includes('subsidy_project_owner_not_member')) return 'incentives.errors.ownerNotMember';
  if (text.includes('subsidy_case_owner_not_member')) return 'incentives.errors.ownerNotMember';
  if (text.includes('subsidy_project_dates_inverted')) return 'incentives.errors.datesInverted';
  if (text.includes('subsidy_project_currency_required')) return 'incentives.errors.currencyRequired';
  if (text.includes('subsidy_case_currency_required')) return 'incentives.errors.currencyRequired';
  if (text.includes('subsidy_case_outcome_without_submission')) return 'incentives.errors.outcomeWithoutSubmission';
  if (text.includes('subsidy_project_cross_tenant')) return 'incentives.errors.crossTenant';
  if (text.includes('subsidy_opportunity_cross_tenant')) return 'incentives.errors.crossTenant';
  if (text.includes('subsidy_link_cross_tenant')) return 'incentives.errors.crossTenant';
  if (text.includes('subsidy_case_missing')) return 'incentives.errors.caseMissing';
  return null;
}

// ---------------------------------------------------------------------------
// Il riassunto in cima
//
// I numeri arrivano da `subsidy_home_summary`. Qui si decide soltanto QUALI
// mostrare e su quale vista puntano: guardare e agire sono lo stesso gesto,
// come nei quattro numeri del CRM.
// ---------------------------------------------------------------------------
export interface SummaryTile {
  key: TKey;
  value: number;
  /** La vista su cui il riquadro porta. `null` = non è un filtro. */
  view: OpportunityView | null;
  tab: IncentiveTab;
}

export function summaryTiles(s: {
  newOpportunities: number; highRelevance: number; staleAssessments: number;
  openCases: number; deadlinesSoon: number; casesWithSourceChange: number;
  activeProjects: number;
}): SummaryTile[] {
  return [
    { key: 'incentives.summary.new', value: s.newOpportunities, view: 'new', tab: 'opportunities' },
    { key: 'incentives.summary.high', value: s.highRelevance, view: 'high', tab: 'opportunities' },
    { key: 'incentives.summary.deadlines', value: s.deadlinesSoon, view: null, tab: 'cases' },
    { key: 'incentives.summary.openCases', value: s.openCases, view: null, tab: 'cases' },
  ];
}

/**
 * Gli avvisi che NON sono numeri da cliccare ma frasi da leggere: una
 * valutazione da aggiornare e un catalogo cambiato sotto una pratica aperta
 * cambiano il significato di ciò che si sta guardando.
 *
 * ⚠️ Restituisce l'elenco VUOTO quando non c'è niente da dire. Un riquadro
 *    «tutto in ordine» sempre presente si smette di leggere, e il giorno in cui
 *    dice qualcosa non lo nota nessuno.
 */
export function summaryNotices(s: { staleAssessments: number; casesWithSourceChange: number }): TKey[] {
  const out: TKey[] = [];
  if (s.staleAssessments > 0) out.push('incentives.summary.staleNotice');
  if (s.casesWithSourceChange > 0) out.push('incentives.summary.sourceChangedNotice');
  return out;
}

/**
 * La chiave giusta fra singolare e plurale.
 *
 * ⚠️ NESSUNA LIBRERIA DI PLURALI, e nessun `n === 1 ? '' : 'i'` costruito a
 * pezzi: la convenzione di questo progetto è UNA CHIAVE PER FORMA
 * (`overdueByOne` / `overdueByDays` nello scadenziario), perché comporre una
 * desinenza in italiano funziona e in tedesco no. Qui si sceglie la chiave, e
 * il dizionario resta l'unico posto in cui una frase è scritta per intero.
 *
 * Difetto trovato APRENDO LA SCHERMATA, non rileggendo il codice: una pratica
 * con il termine il giorno dopo diceva «fra 1 giorni».
 */
export function plural(n: number, one: TKey, many: TKey): TKey {
  return Math.abs(n) === 1 ? one : many;
}

/** Quante opportunità entrano nella vista «scadenze». Dichiarato, non magico. */
export const DEADLINE_WINDOW_DAYS = DEADLINE_SOON_DAYS;
