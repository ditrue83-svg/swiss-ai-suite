// ============================================================================
// Come si LEGGE un'automazione: funzioni PURE, senza React e senza rete.
//
// Stanno qui perché sono decisioni di prodotto — quale frase corrisponde a
// quale regola, che cosa si scrive quando un'azione viene saltata — e le
// decisioni di prodotto vanno provate. Un codice senza etichetta comparirebbe
// grezzo in pagina, che è esattamente il difetto trovato nella 0017 con le
// categorie e nella 0018 con la campanella.
//
// ⚠️ LA FRASE RIASSUNTIVA NON LA SCRIVE UN'AI (§160).
// «Quando viene analizzato un documento classificato come Imposte e con urgenza
// alta, crea un'attività assegnata ad Andrea» si COMPONE dalla configurazione,
// deterministicamente. Chiederlo a un modello vorrebbe dire pagare, aspettare,
// e soprattutto rischiare che la frase mostrata prima di attivare non descriva
// la regola che verrà attivata.
// ============================================================================
import type { TFunction, TKey } from '@/i18n';
import {
  ACTIONS, DOCUMENT_CATEGORIES, TRIGGERS, findAction, findField, findTrigger,
  type ActionKey, type AutomationEventType, type CreateNotificationConfig,
  type CreateTaskConfig, type Operator, type TriggerDef, type WorkflowAction,
  type WorkflowCondition,
} from './registry';
import type {
  Workflow, WorkflowActionStatus, WorkflowAuditKind, WorkflowConditionResult,
  WorkflowRunStatus, WorkflowStatus,
} from '@/types/models';

export { TRIGGERS, ACTIONS, findAction, findField, findTrigger };

/**
 * Risolve `percorso.valore` nei dizionari. Se la chiave non esiste torna il
 * valore GREZZO, non un'etichetta inventata: meglio vedere `contract_related` e
 * accorgersi che manca una traduzione, che leggere una categoria plausibile e
 * sbagliata. È la stessa regola di `useLabels`.
 */
export function pickLabel(t: TFunction, path: string, value: string | null | undefined): string {
  if (!value) return '—';
  const key = `${path}.${value}` as TKey;
  const out = t(key);
  return out === key ? value : out;
}

// ---------------------------------------------------------------------------
// Etichette di stato
// ---------------------------------------------------------------------------

export function statusLabelKey(status: WorkflowStatus): TKey {
  switch (status) {
    case 'draft': return 'automations.status.draft';
    case 'active': return 'automations.status.active';
    case 'paused': return 'automations.status.paused';
    case 'archived': return 'automations.status.archived';
  }
}

export function runStatusLabelKey(status: WorkflowRunStatus): TKey {
  switch (status) {
    case 'pending': return 'automations.runStatus.pending';
    case 'running': return 'automations.runStatus.running';
    case 'succeeded': return 'automations.runStatus.succeeded';
    case 'partial': return 'automations.runStatus.partial';
    case 'failed': return 'automations.runStatus.failed';
    case 'skipped': return 'automations.runStatus.skipped';
  }
}

export function actionStatusLabelKey(status: WorkflowActionStatus): TKey {
  switch (status) {
    case 'pending': return 'automations.actionStatus.pending';
    case 'succeeded': return 'automations.actionStatus.succeeded';
    case 'skipped': return 'automations.actionStatus.skipped';
    case 'failed': return 'automations.actionStatus.failed';
  }
}

export function auditLabelKey(kind: WorkflowAuditKind): TKey {
  switch (kind) {
    case 'created': return 'automations.audit.created';
    case 'updated': return 'automations.audit.updated';
    case 'activated': return 'automations.audit.activated';
    case 'paused': return 'automations.audit.paused';
    case 'archived': return 'automations.audit.archived';
    case 'restored': return 'automations.audit.restored';
    case 'retried': return 'automations.audit.retried';
    case 'auto_paused': return 'automations.audit.autoPaused';
    case 'chain_depth_exceeded': return 'automations.audit.chainDepth';
  }
}

/**
 * Perché un'azione è stata saltata o è fallita, in una frase.
 *
 * ⚠️ §50 — non si mostra mai un codice tecnico. «L'attività esisteva già,
 * quindi non è stata duplicata» dice a una persona ciò che è successo;
 * `PGRST23505` le dice soltanto che il sistema parla un'altra lingua. Un codice
 * che non conosciamo diventa il messaggio generico, non il codice stesso.
 */
export function actionOutcomeKey(errorCode: string | null | undefined): TKey | null {
  switch (errorCode) {
    case null: case undefined: case '': return null;
    case 'already_set': return 'automations.outcome.alreadySet';
    case 'duplicate': return 'automations.outcome.duplicate';
    case 'manual_category': return 'automations.outcome.manualCategory';
    case 'template_value_missing': return 'automations.outcome.templateMissing';
    case 'value_not_derivable': return 'automations.outcome.valueNotDerivable';
    case 'no_recipient': return 'automations.outcome.noRecipient';
    case 'assignee_not_member': return 'automations.outcome.assigneeNotMember';
    case 'tag_missing': return 'automations.outcome.tagMissing';
    case 'entity_missing': return 'automations.outcome.entityMissing';
    case 'condition_not_evaluable': return 'automations.outcome.notEvaluable';
    case 'config_invalid': return 'automations.outcome.configInvalid';
    default: return 'automations.outcome.generic';
  }
}

/** Perché una condizione non è determinabile (§26). */
export function conditionReasonKey(reason: WorkflowConditionResult['reason']): TKey | null {
  switch (reason) {
    case 'missing': return 'automations.reason.missing';
    case 'low_confidence': return 'automations.reason.lowConfidence';
    case 'unverified_quote': return 'automations.reason.unverifiedQuote';
    case 'currency_mismatch': return 'automations.reason.currencyMismatch';
    case 'unknown_field': return 'automations.reason.unknownField';
    default: return null;
  }
}

/** Il motivo per cui una regola «richiede attenzione» (§103/§171). */
export function attentionKey(code: string | null | undefined): TKey | null {
  switch (code) {
    case null: case undefined: case '': return null;
    case 'assignee_not_member': return 'automations.attention.assigneeNotMember';
    case 'tag_missing': return 'automations.attention.tagMissing';
    case 'config_invalid': return 'automations.attention.configInvalid';
    case 'action_failed': return 'automations.attention.actionFailed';
    default: return 'automations.attention.generic';
  }
}

// ---------------------------------------------------------------------------
// Come si legge una condizione
// ---------------------------------------------------------------------------

export function operatorLabelKey(operator: Operator): TKey {
  switch (operator) {
    case 'equals': return 'automations.operators.equals';
    case 'not_equals': return 'automations.operators.notEquals';
    case 'contains': return 'automations.operators.contains';
    case 'not_contains': return 'automations.operators.notContains';
    case 'starts_with': return 'automations.operators.startsWith';
    case 'exists': return 'automations.operators.exists';
    case 'not_exists': return 'automations.operators.notExists';
    case 'greater_than': return 'automations.operators.greaterThan';
    case 'greater_or_equal': return 'automations.operators.greaterOrEqual';
    case 'less_than': return 'automations.operators.lessThan';
    case 'less_or_equal': return 'automations.operators.lessOrEqual';
    case 'in': return 'automations.operators.in';
    case 'within_days': return 'automations.operators.withinDays';
  }
}

export interface NameResolver {
  /** Come si chiama una persona. Mai un identificativo in pagina. */
  member: (userId: string | null | undefined) => string;
  /** Come si chiama un'etichetta documentale. */
  tag: (tagId: string | null | undefined) => string;
}

/** Il valore ATTESO di una condizione, già leggibile. */
export function describeValue(
  t: TFunction, trigger: TriggerDef, condition: WorkflowCondition, names: NameResolver,
): string {
  const field = findField(trigger, condition.field);
  if (!field) return String(condition.value ?? '');

  if (condition.operator === 'exists' || condition.operator === 'not_exists') return '';
  if (condition.operator === 'within_days') {
    return t('automations.describe.days', { n: Number(condition.value ?? 0) });
  }

  const one = (v: unknown): string => {
    if (field.type === 'user') return names.member(String(v));
    if (field.optionsLabelPath) return pickLabel(t, field.optionsLabelPath, String(v));
    if (field.type === 'boolean') {
      return String(v) === 'true' ? t('common.yes') : t('common.no');
    }
    return String(v);
  };

  if (Array.isArray(condition.value)) return condition.value.map(one).join(', ');
  const base = one(condition.value);
  return field.hasCurrency && condition.currency ? `${condition.currency} ${base}` : base;
}

/** «Categoria è Imposte». Una riga, leggibile, senza gergo. */
export function describeCondition(
  t: TFunction, trigger: TriggerDef, condition: WorkflowCondition, names: NameResolver,
): string {
  const field = findField(trigger, condition.field);
  const label = field ? t(field.labelKey as TKey) : condition.field;
  const operator = t(operatorLabelKey(condition.operator));
  const value = describeValue(t, trigger, condition, names);
  return value ? `${label} ${operator} ${value}` : `${label} ${operator}`;
}

/** «Crea attività · Alta · Andrea». Quello che l'azione FA, in breve. */
export function describeAction(
  t: TFunction, action: WorkflowAction, names: NameResolver,
): string {
  const def = findAction(action.key);
  const label = def ? t(def.labelKey as TKey) : action.key;
  const config = action.config as unknown as Record<string, unknown>;

  switch (action.key) {
    case 'create_task': {
      const c = action.config as CreateTaskConfig;
      const parts = [label, `«${c.titleTemplate}»`];
      if (c.priority === 'from_urgency') parts.push(t('automations.describe.priorityFromUrgency'));
      else parts.push(pickLabel(t, 'automations.values.taskPriority', c.priority));
      if (c.assigneeUserId) parts.push(names.member(c.assigneeUserId));
      return parts.join(' · ');
    }
    case 'assign_task':
      return `${label} · ${names.member(String(config.assigneeUserId ?? ''))}`;
    case 'set_task_priority':
      return `${label} · ${pickLabel(t, 'automations.values.taskPriority', String(config.priority ?? ''))}`;
    case 'set_document_category':
      return `${label} · ${pickLabel(t, 'labels.categories', String(config.category ?? ''))}`;
    case 'add_document_tag':
      return `${label} · ${names.tag(String(config.tagId ?? ''))}`;
    case 'create_notification': {
      const c = action.config as CreateNotificationConfig;
      const who = c.recipient === 'assignee' ? t('automations.recipients.assignee')
        : c.recipient === 'admins' ? t('automations.recipients.admins')
        : names.member(c.userId ?? '');
      return `${label} · ${who}`;
    }
    default:
      return label;
  }
}

// ---------------------------------------------------------------------------
// La frase riassuntiva (§160/§161)
// ---------------------------------------------------------------------------

export interface SummaryInput {
  triggerType: AutomationEventType;
  conditionMatch: 'all' | 'any';
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
}

/**
 * «Quando viene analizzato un documento, se Categoria è Imposte e Urgenza è
 * alta, allora crea un'attività assegnata ad Andrea.»
 *
 * Si compone da tre pezzi tradotti e dalla configurazione. Nessuna AI, nessun
 * costo, nessuna variabilità: la frase che una persona legge PRIMA di attivare
 * descrive esattamente la regola che verrà attivata.
 */
export function summarySentence(
  t: TFunction, input: SummaryInput, names: NameResolver,
): string {
  const trigger = findTrigger(input.triggerType);
  if (!trigger) return '';

  const when = t(trigger.labelKey as TKey);

  const conditions = input.conditions
    .map((c) => describeCondition(t, trigger, c, names))
    .filter(Boolean);
  const joiner = input.conditionMatch === 'any'
    ? ` ${t('automations.describe.or')} ` : ` ${t('automations.describe.and')} `;

  const actions = input.actions.map((a) => describeAction(t, a, names)).filter(Boolean);

  const clauses = [t('automations.describe.when', { trigger: when })];
  if (conditions.length) {
    clauses.push(t('automations.describe.if', { conditions: conditions.join(joiner) }));
  } else {
    // ⚠️ Va DETTO, non lasciato dedurre: una regola senza condizioni si applica
    // a tutto ciò che passa, e chi la attiva deve saperlo prima e non dopo.
    clauses.push(t('automations.describe.always'));
  }
  clauses.push(actions.length
    ? t('automations.describe.then', { actions: actions.join('; ') })
    : t('automations.describe.noActions'));

  return `${clauses.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Dove porta il collegamento di un'entità
//
// Non viene mai da un URL salvato: si costruisce dal tipo e dall'identificativo.
// Un indirizzo conservato mesi fa punterebbe a un dominio che nel frattempo può
// essere cambiato (stessa regola delle notifiche).
// ---------------------------------------------------------------------------
export function entityLink(
  entityType: string | null | undefined, entityId: string | null | undefined,
): string | null {
  if (!entityId) return null;
  if (entityType === 'document') return `/documenti/${entityId}`;
  if (entityType === 'task') return `/attivita/${entityId}`;
  // Le comunicazioni non hanno una pagina propria con indirizzo: si aprono
  // dalla lista. Portare a `/inbox` è la verità; inventare `/inbox/<id>` no.
  if (entityType === 'email_message') return '/inbox';
  // 0026 — le entità del CRM. ⚠️ `crm_opportunity` non ha un indirizzo che si
  // possa comporre dal solo id: la scheda vive sotto la sua organizzazione
  // (`/clienti/:org/opportunita/:id`) e quell'id non è in `entity_id`. Portare
  // all'elenco è la verità; comporre un percorso con un'organizzazione
  // indovinata sarebbe un collegamento rotto travestito da collegamento.
  if (entityType === 'crm_organization') return `/clienti/${entityId}`;
  if (entityType === 'crm_opportunity') return '/clienti?vista=pipeline';
  // ⚠️ `contract` manca ancora, ed è un difetto di questo file annotato e non
  // corretto qui: cambiare il comportamento dei Contratti mentre si costruisce
  // il CRM sarebbe una modifica di straforo a un altro modulo.
  return null;
}

// ---------------------------------------------------------------------------
// I modelli iniziali (§75–§81)
//
// Cinque, non venti. Ognuno risponde a una situazione che una PMI svizzera
// riconosce senza doversela far spiegare.
//
// ⚠️ NESSUNO DI QUESTI VIENE INSTALLATO O ATTIVATO DA SOLO (§81/§82).
// «Usa modello» crea una BOZZA, che l'utente rilegge, completa dove serve e
// attiva lui. Un'automazione che comincia a lavorare senza che nessuno l'abbia
// accesa è la cosa che questo capitolato vieta con più insistenza.
// ---------------------------------------------------------------------------

export interface AutomationTemplate {
  id: string;
  nameKey: TKey;
  descriptionKey: TKey;
  triggerType: AutomationEventType;
  conditionMatch: 'all' | 'any';
  conditions: WorkflowCondition[];
  /** L'azione, già pronta. `needsTag` = va scelta o creata un'etichetta. */
  actions: WorkflowAction[];
  needsTag?: boolean;
  /** Il modello lascia un importo da decidere: la cifra la mette l'azienda. */
  needsAmount?: boolean;
}

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: 'urgent_admin',
    nameKey: 'automations.templates.urgentName',
    descriptionKey: 'automations.templates.urgentDesc',
    triggerType: 'document_analysis_completed',
    conditionMatch: 'all',
    conditions: [{ field: 'analysis.urgency', operator: 'equals', value: 'alta' }],
    actions: [{
      key: 'create_task',
      config: {
        titleTemplate: '{{document.title}}',
        priority: 'high',
        dueDate: 'from_deadline',
        linkEntity: true,
      } as CreateTaskConfig,
    }],
  },
  {
    id: 'tax_authority',
    nameKey: 'automations.templates.taxName',
    descriptionKey: 'automations.templates.taxDesc',
    triggerType: 'document_analysis_completed',
    conditionMatch: 'all',
    // ⚠️ Sul TIPO DI ENTE, non sul nome del mittente. «Il mittente contiene
    // AFC» sembra più diretto e sbaglia in due modi: non trova
    // «Amministrazione federale delle contribuzioni» scritta per esteso, e
    // trova qualunque mittente che quella sigla se la sia messa nel nome.
    conditions: [
      { field: 'analysis.sender_authority_type', operator: 'in', value: ['federal', 'cantonal'] },
      { field: 'document.category', operator: 'equals', value: 'taxes' },
    ],
    actions: [{
      key: 'create_task',
      config: {
        titleTemplate: '{{document.title}}',
        priority: 'from_urgency',
        dueDate: 'from_deadline',
        linkEntity: true,
      } as CreateTaskConfig,
    }],
  },
  {
    id: 'large_invoice',
    nameKey: 'automations.templates.invoiceName',
    descriptionKey: 'automations.templates.invoiceDesc',
    triggerType: 'document_analysis_completed',
    conditionMatch: 'all',
    conditions: [
      { field: 'document.category', operator: 'equals', value: 'invoices' },
      { field: 'analysis.amount', operator: 'greater_than', value: 5000, currency: 'CHF' },
    ],
    // ⚠️ VERIFICARE, NON PAGARE. Nessuna azione di questo prodotto muove
    // denaro, e questo modello è il posto in cui la distinzione si vede meglio.
    actions: [{
      key: 'create_task',
      config: {
        titleTemplate: '{{analysis.sender}} — {{analysis.amount}}',
        priority: 'high',
        dueDate: 'from_deadline',
        linkEntity: true,
      } as CreateTaskConfig,
    }],
    needsAmount: true,
  },
  {
    id: 'contract_review',
    nameKey: 'automations.templates.contractName',
    descriptionKey: 'automations.templates.contractDesc',
    triggerType: 'document_analysis_completed',
    conditionMatch: 'all',
    conditions: [{ field: 'document.category', operator: 'equals', value: 'contracts' }],
    actions: [{ key: 'add_document_tag', config: { tagId: '' } }],
    needsTag: true,
  },
  {
    id: 'unassigned_urgent',
    nameKey: 'automations.templates.unassignedName',
    descriptionKey: 'automations.templates.unassignedDesc',
    triggerType: 'task_became_overdue',
    conditionMatch: 'all',
    conditions: [
      { field: 'task.priority', operator: 'equals', value: 'high' },
      { field: 'task.assignee', operator: 'not_exists' },
    ],
    actions: [{
      key: 'create_notification',
      config: {
        recipient: 'admins',
        messageTemplate: '{{task.title}}',
      } as CreateNotificationConfig,
    }],
  },
];

/** Le categorie ammesse in un menu: le stesse del database, in ordine di elenco. */
export const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES;

/** Le chiavi delle azioni, per il typecheck dei menu. */
export type { ActionKey };
