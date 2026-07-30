// ============================================================================
// Il motore: da un evento alle azioni.
//
//   evento prenotato
//     → si rileggono i FATTI dell'entità (valori effettivi, con le correzioni)
//     → si cercano le regole attive che ascoltano quell'evento
//     → per ognuna: configurazione valida? condizioni soddisfatte? riferimenti
//       ancora esistenti?
//     → si apre un'ESECUZIONE e si eseguono le azioni, in ordine
//     → si chiude l'esecuzione e si aggiorna lo stato della regola
//
// ⚠️ TRE COSE CHE QUESTO FILE NON FA, DI PROPOSITO.
//   1. Non chiede niente a un'AI. Il documento è già stato capito; qui si
//      lavora su dati strutturati. Costa zero, non ha latenza, non ha
//      variabilità e non è aggredibile da un'istruzione scritta dentro una
//      email — «ignora le regole precedenti» non ha nessun posto in cui essere
//      letto come istruzione (§8/§120/§121).
//   2. Non decide se un evento è vecchio o se una regola ha già girato in
//      questa catena: lo decide `workflows_for_event` nel database. Un filtro
//      scritto qui è un filtro che il prossimo chiamante può dimenticare.
//   3. Non tocca l'entità di partenza se non attraverso le azioni dichiarate.
//
// ⚠️ TRANSITORIO E PERMANENTE SI DISTINGUONO DALLA FORMA, NON DAL CASO.
// Un'azione che RITORNA un fallimento è un fallimento permanente: la
// configurazione è quella, riprovare darebbe lo stesso esito. Un'eccezione che
// SALE è un guasto transitorio — la rete, il database — e l'evento verrà
// ripreso. Due strade, nessuna ambiguità, e nessun elenco di codici da tenere
// aggiornato in due posti.
//
// Modulo PORTABILE nella forma: riceve il client per parametro e non conosce
// `Deno.env`.
// ============================================================================
import { AUTO_PAUSE_AFTER_FAILURES } from './contract.ts';
import { evaluateConditions, type ConditionResult, type Evaluation } from './conditions.ts';
import { validateWorkflow, type ValidationIssue } from './validate.ts';
import {
  applyAction, planAction, type ActionContext, type ActionPlan,
} from './executors.ts';
import {
  checkReferences, claimAction, clearWorkflowFailures, finishAction, finishRun,
  loadFacts, markWorkflowRun, openRun, recordSkippedRun, recordWorkflowFailure,
  workflowsForEvent, type ClaimedEvent, type EntityFacts, type ReferenceProblem,
  type ServerClient, type WorkflowRow,
} from './store.ts';
import type {
  ActionKey, AutomationEntityType, AutomationEventType, WorkflowAction,
  WorkflowCondition, WorkflowConfig,
} from './registry.ts';

export interface EventReport {
  workflowsConsidered: number;
  matched: number;
  notMatched: number;
  notEvaluable: number;
  invalidConfig: number;
  runs: number;
  actionsDone: number;
  actionsSkipped: number;
  actionsFailed: number;
}

export const emptyReport = (): EventReport => ({
  workflowsConsidered: 0, matched: 0, notMatched: 0, notEvaluable: 0,
  invalidConfig: 0, runs: 0, actionsDone: 0, actionsSkipped: 0, actionsFailed: 0,
});

/** La configurazione letta da una riga, senza fidarsi della sua forma. */
function configOf(row: WorkflowRow): WorkflowConfig {
  return {
    triggerType: row.trigger_type,
    conditionMatch: row.condition_match === 'any' ? 'any' : 'all',
    conditions: Array.isArray(row.conditions) ? (row.conditions as WorkflowCondition[]) : [],
    actions: Array.isArray(row.actions) ? (row.actions as WorkflowAction[]) : [],
  };
}

function contextFor(
  event: ClaimedEvent, entity: EntityFacts, row: WorkflowRow, runId: string | null, now: Date,
): ActionContext {
  return {
    companyId: event.company_id,
    runId,
    workflowId: row.id,
    workflowName: row.name,
    facts: entity.facts,
    entityType: event.entity_type,
    entityId: event.entity_id,
    documentId: entity.documentId,
    emailMessageId: entity.emailMessageId,
    taskId: entity.taskId,
    contractId: entity.contractId,
    contractMilestoneId: entity.contractMilestoneId,
    crmOrganizationId: entity.crmOrganizationId,
    crmOpportunityId: entity.crmOpportunityId,
    assigneeUserId: entity.assigneeUserId,
    now,
  };
}

export interface ProcessOutcome {
  /** `done` = trattato; `failed` = guasto permanente, riprovare non servirebbe. */
  outcome: 'done' | 'failed';
  code?: string;
  report: EventReport;
}

/**
 * Tratta un evento: tutte le regole che lo ascoltano, in ordine di creazione.
 *
 * Un guasto su UNA regola non ferma le altre — sono regole diverse di aziende
 * che lavorano, e una configurazione sbagliata in fondo all'elenco non deve
 * impedire alle prime di funzionare.
 */
export async function processEvent(
  sb: ServerClient, event: ClaimedEvent, now: Date = new Date(),
): Promise<ProcessOutcome> {
  const report = emptyReport();

  const entity = await loadFacts(sb, event, now);
  if (!entity) {
    // Il documento è stato cancellato, l'attività non c'è più, oppure l'entità
    // non è di questa azienda. Nessuna delle tre si risolve riprovando, e la
    // prima è una cosa che succede normalmente.
    return { outcome: 'failed', code: 'entity_missing', report };
  }

  const workflows = await workflowsForEvent(sb, event);
  report.workflowsConsidered = workflows.length;

  for (const row of workflows) {
    await processOne(sb, event, entity, row, now, report);
  }

  return { outcome: 'done', report };
}

async function processOne(
  sb: ServerClient, event: ClaimedEvent, entity: EntityFacts, row: WorkflowRow,
  now: Date, report: EventReport,
): Promise<void> {
  const config = configOf(row);
  const snapshot = {
    name: row.name, version: row.version, triggerType: row.trigger_type,
    conditionMatch: config.conditionMatch, conditions: config.conditions, actions: config.actions,
  };
  const common = {
    companyId: event.company_id, workflowId: row.id, workflowVersion: row.version,
    eventId: event.id, entityType: event.entity_type, entityId: event.entity_id,
    snapshot,
  };

  // (1) La configurazione è ancora leggibile dal registro?
  const issues = validateWorkflow({ ...config, name: row.name }, { forActivation: true });
  if (issues.length) {
    report.invalidConfig++;
    await recordSkippedRun(sb, {
      ...common, conditionResults: [], errorCode: 'config_invalid', status: 'failed',
    });
    await recordWorkflowFailure(sb, row.id, 'config_invalid', AUTO_PAUSE_AFTER_FAILURES);
    await markWorkflowRun(sb, row.id, 'failed');
    return;
  }

  // (2) Le condizioni.
  const evaluation = evaluateConditions(config.conditions, config.conditionMatch, entity.facts, now);

  if (!evaluation.evaluable) {
    // §26 — in caso di ambiguità NON SI ESEGUE, e lo si scrive. Questa è una
    // delle poche run che vale la pena conservare anche senza azioni: dice a
    // chi ha scritto la regola che il dato su cui si basa non è affidabile.
    report.notEvaluable++;
    await recordSkippedRun(sb, {
      ...common, conditionResults: evaluation.results,
      errorCode: 'condition_not_evaluable', status: 'skipped',
    });
    return;
  }

  if (!evaluation.matched) {
    // §101 — nessuna riga. Una regola su «categoria = Imposte» vedrebbe passare
    // ogni documento dell'azienda, e le run «non corrisponde» seppellirebbero
    // quelle in cui ha davvero agito. Resta il contatore nel rapporto del
    // worker, che è dove serve.
    report.notMatched++;
    return;
  }

  report.matched++;

  // (3) I riferimenti esistono ancora? (§56)
  const problems = await checkReferences(sb, event.company_id, config.actions);
  if (problems.length) {
    await recordSkippedRun(sb, {
      ...common, conditionResults: evaluation.results,
      errorCode: problems[0].code, status: 'failed',
    });
    await recordWorkflowFailure(sb, row.id, problems[0].code, AUTO_PAUSE_AFTER_FAILURES);
    await markWorkflowRun(sb, row.id, 'failed');
    return;
  }

  // (4) L'esecuzione.
  const run = await openRun(sb, { ...common, conditionResults: evaluation.results });
  report.runs++;

  const ctx = contextFor(event, entity, row, run.id, now);
  let done = 0, skipped = 0, failed = 0;

  for (let i = 0; i < config.actions.length; i++) {
    const action = config.actions[i];
    const claim = await claimAction(sb, {
      companyId: event.company_id, runId: run.id, actionKey: action.key,
      position: i, eventId: event.id, workflowId: row.id,
    });
    // Già trattata da un'esecuzione precedente dello stesso evento: non si
    // rifà. È il caso normale di un ritentativo, e il motivo per cui lo stesso
    // evento consegnato due volte non crea due attività (§43/§141).
    if (!claim.proceed) { skipped++; continue; }

    const plan = await planAction(sb, ctx, action);
    const result = await applyAction(sb, ctx, plan);
    await finishAction(sb, claim.id, {
      status: result.status, errorCode: result.errorCode ?? null,
      outputEntityType: result.outputEntityType ?? null,
      outputEntityId: result.outputEntityId ?? null,
    });

    if (result.status === 'succeeded') done++;
    else if (result.status === 'failed') failed++;
    else skipped++;
  }

  report.actionsDone += done;
  report.actionsSkipped += skipped;
  report.actionsFailed += failed;

  // Un'azione saltata non è un fallimento: «l'etichetta c'era già» è l'esito
  // voluto. Solo un fallimento vero degrada lo stato dell'esecuzione (§135).
  const status = failed === 0 ? 'succeeded' : (done > 0 ? 'partial' : 'failed');
  await finishRun(sb, run.id, { status });
  await markWorkflowRun(sb, row.id, status);
  if (failed === 0) await clearWorkflowFailures(sb, row.id);
  else await recordWorkflowFailure(sb, row.id, 'action_failed', AUTO_PAUSE_AFTER_FAILURES);
}

// ---------------------------------------------------------------------------
// La prova a vuoto (§51/§52/§53)
//
// ⚠️ ZERO SCRITTURE. Nessuna attività, nessuna notifica, nessuna categoria,
// nessuna riga di esecuzione — nemmeno di audit. Una prova che lascia tracce
// non è più una prova, e la promessa «puoi provarla senza conseguenze» va
// mantenuta alla lettera.
//
// ⚠️ E LO STESSO VALUTATORE DELLE ESECUZIONI VERE. Non c'è una «simulazione»
// che ragiona per conto proprio: cambiano i due tempi dell'azione — si esegue
// il primo, quello che decide, e non il secondo, quello che scrive.
// ---------------------------------------------------------------------------

export interface DryRunAction {
  key: ActionKey;
  outcome: 'ready' | 'skip';
  errorCode?: string;
  preview: Record<string, string | number | boolean | null>;
}

export interface DryRunResult {
  /** L'entità esiste ed è di questa azienda. */
  found: boolean;
  matched: boolean;
  evaluable: boolean;
  conditions: ConditionResult[];
  actions: DryRunAction[];
  /** Riferimenti scomparsi: responsabile uscito, etichetta cancellata. */
  referenceProblems: ReferenceProblem[];
  validation: ValidationIssue[];
}

export async function dryRun(
  sb: ServerClient,
  input: {
    companyId: string;
    name: string;
    config: WorkflowConfig;
    entityType: AutomationEntityType;
    entityId: string;
    eventType: AutomationEventType;
  },
  now: Date = new Date(),
): Promise<DryRunResult> {
  const validation = validateWorkflow({ ...input.config, name: input.name }, { forActivation: true });

  const synthetic: ClaimedEvent = {
    id: '00000000-0000-0000-0000-000000000000',
    company_id: input.companyId,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    // ⚠️ Un valore PRECEDENTE — la categoria di prima, lo stato di prima — non
    // esiste in una prova: non è mai successo niente. Le condizioni su quei
    // campi risulteranno «non determinabili», e la schermata lo dice invece di
    // fingere un passato che non c'è.
    payload: {},
    occurred_at: now.toISOString(),
    origin: 'system',
    correlation_id: '00000000-0000-0000-0000-000000000000',
    root_event_id: null,
    chain_depth: 0,
    attempts: 0,
    lock_id: '00000000-0000-0000-0000-000000000000',
  };

  const entity = await loadFacts(sb, synthetic, now);
  if (!entity) {
    return {
      found: false, matched: false, evaluable: false,
      conditions: [], actions: [], referenceProblems: [], validation,
    };
  }

  const evaluation: Evaluation = evaluateConditions(
    input.config.conditions, input.config.conditionMatch, entity.facts, now,
  );

  const referenceProblems = await checkReferences(sb, input.companyId, input.config.actions);

  const actions: DryRunAction[] = [];
  if (evaluation.matched && evaluation.evaluable) {
    const ctx = contextFor(
      synthetic, entity,
      { id: 'dry', name: input.name, version: 0, trigger_type: input.eventType,
        condition_match: input.config.conditionMatch, conditions: [], actions: [] },
      null, now,
    );
    for (const action of input.config.actions) {
      const plan: ActionPlan = await planAction(sb, ctx, action);
      actions.push(plan.outcome === 'ready'
        ? { key: plan.key, outcome: 'ready', preview: plan.preview }
        : { key: plan.key, outcome: 'skip', errorCode: plan.errorCode, preview: plan.preview });
    }
  }

  return {
    found: true,
    matched: evaluation.matched,
    evaluable: evaluation.evaluable,
    conditions: evaluation.results,
    actions,
    referenceProblems,
    validation,
  };
}

/**
 * «Negli ultimi N giorni questa regola avrebbe corrisposto a X elementi» (§165).
 *
 * ⚠️ NESSUNA AZIONE, NEMMENO SIMULATA: si valutano solo le condizioni. È una
 * domanda sul PASSATO, e le azioni sul passato sono esattamente il backfill che
 * §164 vieta.
 *
 * ⚠️ IL LIMITE È DICHIARATO, NON NASCOSTO. Si esaminano al massimo `limit`
 * elementi recenti, e il risultato riporta quanti ne ha guardati: «7 su 25
 * esaminati» è un'informazione, «7» da solo lascerebbe credere che siano stati
 * guardati tutti.
 */
export async function simulateRecent(
  sb: ServerClient,
  input: {
    companyId: string;
    config: WorkflowConfig;
    entityType: AutomationEntityType;
    eventType: AutomationEventType;
    days?: number;
    limit?: number;
  },
  now: Date = new Date(),
): Promise<{ examined: number; matched: number; notEvaluable: number; limit: number; days: number }> {
  const days = Math.min(Math.max(input.days ?? 30, 1), 90);
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();

  const table = input.entityType === 'document' ? 'documents'
    : input.entityType === 'email_message' ? 'email_messages'
    : input.entityType === 'contract' ? 'contracts' : 'tasks';
  const timeColumn = input.entityType === 'email_message' ? 'received_at' : 'created_at';

  const { data } = await sb.from(table)
    .select('id').eq('company_id', input.companyId)
    .gte(timeColumn, since)
    .order(timeColumn, { ascending: false }).limit(limit);

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  let matched = 0, notEvaluable = 0;

  for (const id of ids) {
    const synthetic: ClaimedEvent = {
      id: '00000000-0000-0000-0000-000000000000',
      company_id: input.companyId, event_type: input.eventType,
      entity_type: input.entityType, entity_id: id, payload: {},
      occurred_at: now.toISOString(), origin: 'system',
      correlation_id: '00000000-0000-0000-0000-000000000000',
      root_event_id: null, chain_depth: 0, attempts: 0,
      lock_id: '00000000-0000-0000-0000-000000000000',
    };
    const entity = await loadFacts(sb, synthetic, now);
    if (!entity) continue;
    const evaluation = evaluateConditions(
      input.config.conditions, input.config.conditionMatch, entity.facts, now,
    );
    if (!evaluation.evaluable) notEvaluable++;
    else if (evaluation.matched) matched++;
  }

  return { examined: ids.length, matched, notEvaluable, limit, days };
}
