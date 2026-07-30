// ============================================================================
// La validazione di una regola contro il registro. Funzione PURA.
//
// ⚠️ È IL CONFINE FRA «DATI» E «CODICE».
// Tutto ciò che arriva da un browser passa di qui prima di essere scritto: un
// campo non dichiarato, un operatore non previsto, un'azione inventata, un
// segnaposto che non esiste per quell'innesco vengono RIFIUTATI, non ignorati.
// Ignorarli sarebbe la forma peggiore: la regola verrebbe salvata, comparirebbe
// attiva e non farebbe la cosa che c'è scritta sopra (§150).
//
// Gira in due posti, di proposito: nel BROWSER, perché il generatore possa dire
// subito cosa manca invece di far premere «Attiva» e mostrare un errore; e
// nella EDGE FUNCTION, perché è là che vale — la validazione del browser è una
// cortesia, quella del server è la garanzia (§106).
//
// Ritorna un elenco di problemi con una CHIAVE di traduzione e i suoi
// parametri: la frase la compone l'interfaccia nella lingua di chi legge.
//
// Modulo PORTABILE: nessun import fuori da questa cartella.
// ============================================================================
import {
  ACTION_KEYS, CURRENCIES, OPERATORS, OPERATORS_BY_TYPE,
  UNARY_OPERATORS, actionsForTrigger, findAction, findField, findTrigger,
  isAutoExecutable, triggerHasOwner,
  type ActionKey, type AddDocumentTagConfig, type AssignTaskConfig,
  type CreateNotificationConfig, type CreateTaskConfig, type SetDocumentCategoryConfig,
  type SetTaskPriorityConfig, type TriggerDef, type WorkflowAction,
  type WorkflowCondition, type WorkflowConfig,
} from './registry.ts';
import {
  MAX_ACTIONS, MAX_CONDITIONS, MAX_DESCRIPTION_TEMPLATE_LENGTH, MAX_TEMPLATE_LENGTH,
} from './contract.ts';
import { placeholdersIn } from './templates.ts';

export interface ValidationIssue {
  /** Chiave di traduzione sotto `automations.validation.*`. */
  key: string;
  /** Parametri della frase: nomi tecnici, numeri. Mai testo già tradotto. */
  params?: Record<string, string | number>;
  /** Dove sta il problema: serve al generatore per evidenziare il punto giusto. */
  where?: { section: 'trigger' | 'condition' | 'action'; index?: number };
}

const issue = (
  key: string,
  params?: Record<string, string | number>,
  where?: ValidationIssue['where'],
): ValidationIssue => ({ key, params, where });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isUuid = (v: unknown): v is string =>
  typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Valida l'intera configurazione.
 *
 * `forActivation` distingue due domande diverse: «questa bozza si può salvare?»
 * e «questa regola si può accendere?». Una bozza senza azioni è un lavoro a
 * metà ed è legittima; una regola ATTIVA senza azioni è una promessa che non
 * verrà mantenuta, e il database stesso la rifiuta (§54).
 */
export function validateWorkflow(
  config: Partial<WorkflowConfig> & { name?: string },
  options: { forActivation?: boolean } = {},
): ValidationIssue[] {
  const out: ValidationIssue[] = [];

  const name = (config.name ?? '').trim();
  if (config.name !== undefined && (name.length < 1 || name.length > 80)) {
    out.push(issue('nameLength', { max: 80 }));
  }

  const trigger = findTrigger(String(config.triggerType ?? ''));
  if (!trigger) {
    out.push(issue('unknownTrigger', { value: String(config.triggerType ?? '') }, { section: 'trigger' }));
    // Senza innesco non si può dire niente di sensato su condizioni e azioni:
    // i campi ammessi dipendono da lui. Si ferma qui invece di produrre dieci
    // errori derivati che nascondono l'unico vero.
    return out;
  }

  if (config.conditionMatch !== undefined
      && config.conditionMatch !== 'all' && config.conditionMatch !== 'any') {
    out.push(issue('unknownMatch', { value: String(config.conditionMatch) }));
  }

  const conditions = config.conditions ?? [];
  if (!Array.isArray(conditions)) {
    out.push(issue('conditionsNotArray'));
  } else {
    if (conditions.length > MAX_CONDITIONS) {
      out.push(issue('tooManyConditions', { max: MAX_CONDITIONS }));
    }
    conditions.forEach((c, i) => out.push(...validateCondition(trigger, c, i)));
  }

  const actions = config.actions ?? [];
  if (!Array.isArray(actions)) {
    out.push(issue('actionsNotArray'));
  } else {
    if (actions.length > MAX_ACTIONS) {
      out.push(issue('tooManyActions', { max: MAX_ACTIONS }));
    }
    if (options.forActivation && actions.length === 0) {
      out.push(issue('noActions'));
    }
    actions.forEach((a, i) => out.push(...validateAction(trigger, a, i)));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Condizioni
// ---------------------------------------------------------------------------

function validateCondition(
  trigger: TriggerDef, raw: unknown, index: number,
): ValidationIssue[] {
  const where = { section: 'condition' as const, index };
  if (!isPlainObject(raw)) return [issue('conditionNotObject', { index: index + 1 }, where)];

  const c = raw as unknown as WorkflowCondition;
  const field = findField(trigger, String(c.field ?? ''));
  if (!field) {
    return [issue('unknownField', { value: String(c.field ?? ''), trigger: trigger.key }, where)];
  }

  const operator = String(c.operator ?? '');
  if (!(OPERATORS as readonly string[]).includes(operator)) {
    return [issue('unknownOperator', { value: operator }, where)];
  }
  const allowed = OPERATORS_BY_TYPE[field.type];
  if (!allowed.includes(operator as (typeof OPERATORS)[number])) {
    return [issue('operatorNotForType', { operator, field: field.path, type: field.type }, where)];
  }

  const out: ValidationIssue[] = [];
  const unary = (UNARY_OPERATORS as readonly string[]).includes(operator);

  if (unary) {
    // Un valore accanto a «esiste» non è un errore innocuo: è un valore che
    // qualcuno crede venga confrontato e che non verrà guardato da nessuno.
    if (c.value !== undefined && c.value !== null && c.value !== '') {
      out.push(issue('valueOnUnary', { operator }, where));
    }
    return out;
  }

  if (c.value === undefined || c.value === null || c.value === '') {
    return [issue('valueRequired', { field: field.path }, where)];
  }

  if (operator === 'in') {
    if (!Array.isArray(c.value) || c.value.length === 0) {
      out.push(issue('inNeedsList', { field: field.path }, where));
    } else if (c.value.length > 20) {
      out.push(issue('inTooLong', { max: 20 }, where));
    } else if (field.options) {
      const bad = c.value.filter((v) => !field.options!.includes(String(v)));
      if (bad.length) out.push(issue('valueNotAllowed', { value: bad.join(', '), field: field.path }, where));
    }
    return out;
  }

  switch (field.type) {
    case 'enum':
      if (field.options && !field.options.includes(String(c.value))) {
        out.push(issue('valueNotAllowed', { value: String(c.value), field: field.path }, where));
      }
      break;

    case 'number': {
      const n = typeof c.value === 'number' ? c.value : Number(String(c.value).replace(',', '.'));
      if (!Number.isFinite(n)) {
        out.push(issue('valueNotNumber', { value: String(c.value), field: field.path }, where));
      }
      // ⚠️ §27 — CHF 5'000 non è EUR 5'000, e non lo diventa convertendo.
      // Un confronto su un importo senza valuta è una domanda incompleta, e
      // rispondere «sì» a una domanda incompleta è il modo in cui si assegna
      // lavoro sbagliato a qualcuno.
      if (field.hasCurrency) {
        const cur = String(c.currency ?? '');
        if (!cur) out.push(issue('currencyRequired', { field: field.path }, where));
        else if (!(CURRENCIES as readonly string[]).includes(cur)) {
          out.push(issue('unknownCurrency', { value: cur }, where));
        }
      }
      break;
    }

    case 'date':
      // L'unico operatore con valore è `within_days`: un numero di giorni.
      if (operator === 'within_days') {
        const n = Number(c.value);
        if (!Number.isInteger(n) || n < 0 || n > 365) {
          out.push(issue('daysOutOfRange', { min: 0, max: 365 }, where));
        }
      }
      break;

    case 'boolean':
      if (c.value !== true && c.value !== false && c.value !== 'true' && c.value !== 'false') {
        out.push(issue('valueNotBoolean', { field: field.path }, where));
      }
      break;

    case 'user':
      if (!isUuid(c.value)) out.push(issue('valueNotUser', { field: field.path }, where));
      break;

    case 'string':
      if (typeof c.value !== 'string' || c.value.length > 200) {
        out.push(issue('valueTooLong', { max: 200, field: field.path }, where));
      }
      break;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Azioni
// ---------------------------------------------------------------------------

function validateAction(
  trigger: TriggerDef, raw: unknown, index: number,
): ValidationIssue[] {
  const where = { section: 'action' as const, index };
  if (!isPlainObject(raw)) return [issue('actionNotObject', { index: index + 1 }, where)];

  const key = String((raw as { key?: unknown }).key ?? '');
  if (!(ACTION_KEYS as readonly string[]).includes(key)) {
    return [issue('unknownAction', { value: key }, where)];
  }
  const def = findAction(key as ActionKey)!;

  if (!actionsForTrigger(trigger).some((a) => a.key === def.key)) {
    return [issue('actionNotForTrigger', { action: def.key, trigger: trigger.key }, where)];
  }

  // ⚠️ §19 — il motore esegue automaticamente solo le azioni a basso rischio.
  // Oggi lo sono tutte, quindi questo controllo non scatta mai: c'è perché il
  // giorno in cui ne verrà aggiunta una di rischio superiore, il rifiuto sia
  // già scritto e non da ricordarsi.
  if (!isAutoExecutable(def)) {
    return [issue('actionNeedsApproval', { action: def.key }, where)];
  }

  const config = (raw as { config?: unknown }).config;
  if (!isPlainObject(config)) return [issue('actionConfigMissing', { action: def.key }, where)];

  switch (def.key) {
    case 'create_task':   return validateCreateTask(trigger, config as unknown as CreateTaskConfig, where);
    case 'assign_task':   return validateAssign(config as unknown as AssignTaskConfig, where);
    case 'set_task_priority': return validatePriority(config as unknown as SetTaskPriorityConfig, where);
    case 'set_document_category': return validateCategory(config as unknown as SetDocumentCategoryConfig, where);
    case 'add_document_tag': return validateTag(config as unknown as AddDocumentTagConfig, where);
    case 'create_notification': return validateNotification(trigger, config as unknown as CreateNotificationConfig, where);
  }
}

/** I segnaposto usati devono essere fra quelli ammessi PER QUESTO innesco (§30). */
function checkTemplate(
  trigger: TriggerDef, text: string, max: number, where: ValidationIssue['where'],
  fieldKey: string,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (text.length > max) out.push(issue('templateTooLong', { max, field: fieldKey }, where));
  for (const p of placeholdersIn(text)) {
    if (!trigger.templates.includes(p)) {
      out.push(issue('unknownPlaceholder', { value: p, trigger: trigger.key }, where));
    }
  }
  return out;
}

function validateCreateTask(
  trigger: TriggerDef, c: CreateTaskConfig, where: ValidationIssue['where'],
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const title = String(c.titleTemplate ?? '').trim();
  if (!title) out.push(issue('titleRequired', undefined, where));
  else out.push(...checkTemplate(trigger, title, MAX_TEMPLATE_LENGTH, where, 'title'));

  if (c.descriptionTemplate) {
    out.push(...checkTemplate(trigger, String(c.descriptionTemplate),
      MAX_DESCRIPTION_TEMPLATE_LENGTH, where, 'description'));
  }

  const priority = String(c.priority ?? '');
  if (!['low', 'medium', 'high', 'from_urgency'].includes(priority)) {
    out.push(issue('unknownPriority', { value: priority }, where));
  }
  // «Dall'urgenza» ha senso solo dove l'urgenza esiste: è un campo dell'analisi
  // di un documento. Offrirla su un'attività significherebbe dedurre l'urgenza
  // da qualcosa che non c'è, cioè inventarla.
  if (priority === 'from_urgency' && !trigger.fields.some((f) => f.path === 'analysis.urgency')) {
    out.push(issue('urgencyNotAvailable', { trigger: trigger.key }, where));
  }

  const due = String(c.dueDate ?? 'none');
  if (!['none', 'from_deadline', 'before_deadline', 'in_days',
        'from_finance_due_date', 'before_finance_due_date'].includes(due)) {
    out.push(issue('unknownDueMode', { value: due }, where));
  }
  if ((due === 'from_deadline' || due === 'before_deadline')
      && !trigger.fields.some((f) => f.path === 'analysis.deadline')) {
    out.push(issue('deadlineNotAvailable', { trigger: trigger.key }, where));
  }
  // La scadenza di PAGAMENTO esiste solo dove l'innesco parla di una fattura:
  // offrirla altrove significherebbe far configurare una regola che non potrà
  // mai produrre una data.
  if ((due === 'from_finance_due_date' || due === 'before_finance_due_date')
      && !trigger.fields.some((f) => f.path === 'finance.due_date')) {
    out.push(issue('financeDueDateNotAvailable', { trigger: trigger.key }, where));
  }
  if (due === 'before_deadline' || due === 'in_days') {
    const n = Number(c.dueDateDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      out.push(issue('daysOutOfRange', { min: 0, max: 365 }, where));
    }
  }

  if (c.assigneeUserId !== undefined && c.assigneeUserId !== null && !isUuid(c.assigneeUserId)) {
    out.push(issue('assigneeInvalid', undefined, where));
  }
  return out;
}

function validateAssign(c: AssignTaskConfig, where: ValidationIssue['where']): ValidationIssue[] {
  return isUuid(c.assigneeUserId) ? [] : [issue('assigneeRequired', undefined, where)];
}

function validatePriority(c: SetTaskPriorityConfig, where: ValidationIssue['where']): ValidationIssue[] {
  return ['low', 'medium', 'high'].includes(String(c.priority))
    ? [] : [issue('unknownPriority', { value: String(c.priority ?? '') }, where)];
}

function validateCategory(
  c: SetDocumentCategoryConfig, where: ValidationIssue['where'],
): ValidationIssue[] {
  const field = findField(findTrigger('document_analysis_completed')!, 'document.category')!;
  return field.options!.includes(String(c.category))
    ? [] : [issue('unknownCategory', { value: String(c.category ?? '') }, where)];
}

function validateTag(c: AddDocumentTagConfig, where: ValidationIssue['where']): ValidationIssue[] {
  // Che l'etichetta ESISTA ANCORA non si può sapere qui: è una domanda al
  // database, e la fa `checkReferences` prima di ogni attivazione e prima di
  // ogni esecuzione (§56). Qui si verifica solo che sia un identificativo.
  return isUuid(c.tagId) ? [] : [issue('tagRequired', undefined, where)];
}

function validateNotification(
  trigger: TriggerDef, c: CreateNotificationConfig, where: ValidationIssue['where'],
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const recipient = String(c.recipient ?? '');
  if (!['assignee', 'admins', 'user'].includes(recipient)) {
    out.push(issue('unknownRecipient', { value: recipient }, where));
  }
  // «Il responsabile» esiste solo dove l'entità ne ha uno: l'assegnatario di
  // un'attività, il responsabile di un contratto, di una controparte o di una
  // trattativa. Su un documento e su una comunicazione non c'è nessuno da
  // avvisare, e una regola che lo dicesse non avviserebbe mai nessuno.
  if (recipient === 'assignee' && !triggerHasOwner(trigger)) {
    out.push(issue('recipientNotAvailable', { trigger: trigger.key }, where));
  }
  if (recipient === 'user' && !isUuid(c.userId)) {
    out.push(issue('recipientRequired', undefined, where));
  }
  const text = String(c.messageTemplate ?? '').trim();
  if (!text) out.push(issue('messageRequired', undefined, where));
  else out.push(...checkTemplate(trigger, text, MAX_TEMPLATE_LENGTH, where, 'message'));
  return out;
}
