// ============================================================================
// Le azioni: che cosa una regola può fare davvero.
//
// ⚠️ OGNI AZIONE È IN DUE TEMPI, E NON È UN VEZZO ARCHITETTURALE.
//   `planAction`  decide cosa si farebbe, legge ciò che serve per deciderlo e
//                 non scrive NIENTE;
//   `applyAction` scrive.
// La prova a vuoto (§51/§52) esegue solo il primo tempo, e per questo mostra
// esattamente ciò che accadrebbe: non c'è una «logica di simulazione» accanto a
// quella vera che prima o poi racconta un'altra storia. È lo stesso principio
// per cui il pulsante «Sincronizza ora» del calendario non ha un proprio
// percorso di scrittura.
//
// ⚠️ TUTTE LE AZIONI PASSANO DALLE TABELLE E DAI TRIGGER NORMALI.
// Un'attività creata da una regola nasce con `tasks.insert`: prende lo stesso
// guardiano (assegnatario membro dell'azienda, timbri scritti dal database), lo
// stesso storico, la stessa coda del calendario, la stessa notifica di
// assegnazione. Nessuna scorciatoia SQL che ricopia le regole di un dominio
// altrui — sarebbe la copia che diverge (§87).
//
// ⚠️ CIÒ CHE NON C'È, E NON PER DIMENTICANZA (§18/§191): inviare o rispondere a
// email, pagare, cambiare coordinate bancarie, cancellare documenti o messaggi,
// accettare o firmare contratti, trasmettere a un'autorità, toccare la casella
// presso il provider, chiamare un indirizzo esterno, eseguire SQL o
// JavaScript. Automatizzare il lavoro, non automatizzare il rischio.
// ============================================================================
import { MAX_DESCRIPTION_TEMPLATE_LENGTH, MAX_TEMPLATE_LENGTH } from './contract.ts';
import { renderRequired, renderTemplate } from './templates.ts';
import { companyLeaders, type ServerClient } from './store.ts';
import type { Facts } from './facts.ts';
import type {
  ActionKey, AddDocumentTagConfig, AssignTaskConfig, AutomationEntityType,
  CreateNotificationConfig, CreateTaskConfig, SetDocumentCategoryConfig,
  SetTaskPriorityConfig, WorkflowAction,
} from './registry.ts';

export interface ActionContext {
  companyId: string;
  /** L'esecuzione in corso. `null` durante una prova a vuoto. */
  runId: string | null;
  workflowName: string;
  workflowId: string;
  facts: Facts;
  entityType: AutomationEntityType;
  entityId: string;
  documentId: string | null;
  emailMessageId: string | null;
  taskId: string | null;
  assigneeUserId: string | null;
  now: Date;
}

/** Che cosa una riga dell'anteprima dice a chi legge (§53). Testo già pronto. */
export type PreviewFields = Record<string, string | number | boolean | null>;

export type ActionPlan =
  | { key: ActionKey; outcome: 'ready'; preview: PreviewFields; write: WritePlan }
  | { key: ActionKey; outcome: 'skip'; errorCode: string; preview: PreviewFields };

type WritePlan =
  | { kind: 'create_task'; row: Record<string, unknown> }
  | { kind: 'update_task'; taskId: string; patch: Record<string, unknown> }
  | { kind: 'update_document'; documentId: string; patch: Record<string, unknown> }
  | { kind: 'tag_document'; documentId: string; tagId: string }
  | { kind: 'notify'; userIds: string[]; text: string };

export interface ApplyResult {
  status: 'succeeded' | 'skipped' | 'failed';
  errorCode?: string;
  outputEntityType?: string;
  outputEntityId?: string;
}

const skip = (key: ActionKey, errorCode: string, preview: PreviewFields = {}): ActionPlan =>
  ({ key, outcome: 'skip', errorCode, preview });

// ---------------------------------------------------------------------------
// PRIMO TEMPO — che cosa si farebbe
// ---------------------------------------------------------------------------

export async function planAction(
  sb: ServerClient, ctx: ActionContext, action: WorkflowAction,
): Promise<ActionPlan> {
  switch (action.key) {
    case 'create_task':           return planCreateTask(ctx, action.config as CreateTaskConfig);
    case 'assign_task':           return await planAssign(sb, ctx, action.config as AssignTaskConfig);
    case 'set_task_priority':     return await planPriority(sb, ctx, action.config as SetTaskPriorityConfig);
    case 'set_document_category': return await planCategory(sb, ctx, action.config as SetDocumentCategoryConfig);
    case 'add_document_tag':      return await planTag(sb, ctx, action.config as AddDocumentTagConfig);
    case 'create_notification':   return await planNotification(sb, ctx, action.config as CreateNotificationConfig);
    default:
      // Una chiave fuori dal registro non viene interpretata. Il validatore
      // l'avrebbe fermata: se arriva qui è un guasto, e si dichiara.
      return skip(action.key, 'config_invalid');
  }
}

const PRIORITY_FROM_URGENCY: Record<string, 'high' | 'medium' | 'low'> = {
  alta: 'high', media: 'medium', bassa: 'low',
};

function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

function todayISO(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString().slice(0, 10);
}

function planCreateTask(ctx: ActionContext, config: CreateTaskConfig): ActionPlan {
  const title = renderRequired(String(config.titleTemplate ?? ''), ctx.facts, MAX_TEMPLATE_LENGTH);
  if ('missing' in title) {
    // §31 — non si scrive «Verifica undefined» e non si scrive «Verifica».
    // Chi ha messo il mittente nel titolo lo voleva nel titolo: senza, quel
    // titolo non è più quello che aveva chiesto.
    return skip('create_task', 'template_value_missing', { placeholders: title.missing.join(' ') });
  }

  let description: string | null = null;
  if (config.descriptionTemplate) {
    // La descrizione è FACOLTATIVA: un segnaposto non risolto la accorcia, non
    // fa saltare l'azione. Il titolo identifica il lavoro, la descrizione lo
    // accompagna, e le due cose non hanno lo stesso peso.
    const rendered = renderTemplate(String(config.descriptionTemplate), ctx.facts,
      MAX_DESCRIPTION_TEMPLATE_LENGTH);
    description = rendered.text.trim() || null;
  }

  let priority: 'low' | 'medium' | 'high';
  if (config.priority === 'from_urgency') {
    const urgency = ctx.facts['analysis.urgency'];
    if (!urgency || !urgency.known || typeof urgency.value !== 'string') {
      return skip('create_task', 'value_not_derivable', { field: 'analysis.urgency' });
    }
    priority = PRIORITY_FROM_URGENCY[urgency.value] ?? 'medium';
  } else {
    priority = config.priority;
  }

  let dueDate: string | null = null;
  const deadline = ctx.facts['analysis.deadline'];
  const deadlineValue = deadline && deadline.known && typeof deadline.value === 'string'
    ? deadline.value : null;

  if (config.dueDate === 'from_deadline') {
    // Nessuna scadenza nel documento → nessuna scadenza sull'attività. Non è un
    // ripiego: è il fatto. Inventare una data per riempire il campo è
    // esattamente ciò che questo prodotto non fa.
    dueDate = deadlineValue;
  } else if (config.dueDate === 'before_deadline') {
    dueDate = deadlineValue ? addDays(deadlineValue, -Math.abs(Number(config.dueDateDays ?? 0))) : null;
  } else if (config.dueDate === 'in_days') {
    dueDate = addDays(todayISO(ctx.now), Math.abs(Number(config.dueDateDays ?? 0)));
  } else if (config.dueDate === 'from_finance_due_date'
             || config.dueDate === 'before_finance_due_date') {
    // La scadenza di PAGAMENTO della fattura, che non è il termine
    // amministrativo del documento (§47). Se non c'è, l'attività nasce senza
    // scadenza: è il fatto, non un ripiego.
    const financeDue = ctx.facts['finance.due_date'];
    const value = financeDue && financeDue.known && typeof financeDue.value === 'string'
      ? financeDue.value : null;
    dueDate = value && config.dueDate === 'before_finance_due_date'
      ? addDays(value, -Math.abs(Number(config.dueDateDays ?? 0)))
      : value;
  }

  const linkEntity = config.linkEntity !== false;

  return {
    key: 'create_task',
    outcome: 'ready',
    preview: {
      title: title.text,
      description,
      priority,
      dueDate,
      assigneeUserId: config.assigneeUserId ?? null,
      documentId: linkEntity ? ctx.documentId : null,
    },
    write: {
      kind: 'create_task',
      row: {
        company_id: ctx.companyId,
        title: title.text,
        description,
        priority,
        due_date: dueDate,
        status: 'open',
        // §41 — la provenienza è un DATO, non una frase nella descrizione.
        source: 'workflow',
        assignee_user_id: config.assigneeUserId ?? null,
        document_id: linkEntity ? ctx.documentId : null,
        // `created_by` resta NULL: nessuna persona ha creato questa attività, e
        // metterci l'autore della regola direbbe che l'ha scritta lui adesso.
        created_by: null,
        workflow_run_id: ctx.runId,
      },
    },
  };
}

async function planAssign(
  sb: ServerClient, ctx: ActionContext, config: AssignTaskConfig,
): Promise<ActionPlan> {
  if (!ctx.taskId) return skip('assign_task', 'entity_missing');

  const { data } = await sb.from('tasks')
    .select('assignee_user_id').eq('id', ctx.taskId).eq('company_id', ctx.companyId).maybeSingle();
  if (!data) return skip('assign_task', 'entity_missing');

  if ((data as { assignee_user_id: string | null }).assignee_user_id === config.assigneeUserId) {
    // Già così: non è un errore, è un no-op. Riscriverlo produrrebbe una riga
    // di storico e una notifica di assegnazione per un cambiamento che non c'è.
    return skip('assign_task', 'already_set', { assigneeUserId: config.assigneeUserId });
  }

  return {
    key: 'assign_task',
    outcome: 'ready',
    preview: { assigneeUserId: config.assigneeUserId },
    write: { kind: 'update_task', taskId: ctx.taskId, patch: { assignee_user_id: config.assigneeUserId } },
  };
}

async function planPriority(
  sb: ServerClient, ctx: ActionContext, config: SetTaskPriorityConfig,
): Promise<ActionPlan> {
  if (!ctx.taskId) return skip('set_task_priority', 'entity_missing');

  const { data } = await sb.from('tasks')
    .select('priority').eq('id', ctx.taskId).eq('company_id', ctx.companyId).maybeSingle();
  if (!data) return skip('set_task_priority', 'entity_missing');
  if ((data as { priority: string }).priority === config.priority) {
    return skip('set_task_priority', 'already_set', { priority: config.priority });
  }

  return {
    key: 'set_task_priority',
    outcome: 'ready',
    preview: { priority: config.priority },
    write: { kind: 'update_task', taskId: ctx.taskId, patch: { priority: config.priority } },
  };
}

async function planCategory(
  sb: ServerClient, ctx: ActionContext, config: SetDocumentCategoryConfig,
): Promise<ActionPlan> {
  if (!ctx.documentId) return skip('set_document_category', 'entity_missing');

  const { data } = await sb.from('documents')
    .select('category, category_source').eq('id', ctx.documentId)
    .eq('company_id', ctx.companyId).maybeSingle();
  if (!data) return skip('set_document_category', 'entity_missing');
  const doc = data as { category: string | null; category_source: string | null };

  // ⚠️ §89/§143 — UNA SCELTA FATTA DA UNA PERSONA NON SI SOVRASCRIVE.
  // È la stessa regola che la classificazione automatica della 0017 già
  // rispetta. Chi ha spostato un documento fra i Contratti lo ha fatto sapendo
  // qualcosa che il sistema non sa, e una regola che glielo rimette altrove
  // ogni volta è peggio di una regola che non c'è.
  if (doc.category_source === 'manual') {
    return skip('set_document_category', 'manual_category', { category: doc.category });
  }
  if (doc.category === config.category) {
    return skip('set_document_category', 'already_set', { category: config.category });
  }

  return {
    key: 'set_document_category',
    outcome: 'ready',
    preview: { category: config.category, previousCategory: doc.category },
    write: {
      kind: 'update_document',
      documentId: ctx.documentId,
      patch: {
        category: config.category,
        // Il guardiano della 0017 rispetta l'origine DICHIARATA quando a
        // scrivere è il server. Dichiararla «regola aziendale» invece di
        // lasciarla diventare «rule» è la differenza fra sapere che è stata una
        // regola dell'azienda e credere che sia stata la classificazione
        // automatica del prodotto.
        category_source: 'workflow',
        category_set_at: new Date().toISOString(),
        category_workflow_run_id: ctx.runId,
      },
    },
  };
}

async function planTag(
  sb: ServerClient, ctx: ActionContext, config: AddDocumentTagConfig,
): Promise<ActionPlan> {
  if (!ctx.documentId) return skip('add_document_tag', 'entity_missing');

  const { data: tag } = await sb.from('document_tags')
    .select('id, name').eq('id', config.tagId).eq('company_id', ctx.companyId).maybeSingle();
  if (!tag) return skip('add_document_tag', 'tag_missing');

  const { data: link } = await sb.from('document_tag_links')
    .select('tag_id').eq('document_id', ctx.documentId).eq('tag_id', config.tagId).maybeSingle();
  if (link) return skip('add_document_tag', 'already_set', { tag: (tag as { name: string }).name });

  return {
    key: 'add_document_tag',
    outcome: 'ready',
    preview: { tag: (tag as { name: string }).name },
    write: { kind: 'tag_document', documentId: ctx.documentId, tagId: config.tagId },
  };
}

async function planNotification(
  sb: ServerClient, ctx: ActionContext, config: CreateNotificationConfig,
): Promise<ActionPlan> {
  const text = renderRequired(String(config.messageTemplate ?? ''), ctx.facts, MAX_TEMPLATE_LENGTH);
  if ('missing' in text) {
    return skip('create_notification', 'template_value_missing', { placeholders: text.missing.join(' ') });
  }

  let userIds: string[] = [];
  if (config.recipient === 'assignee') {
    // Nessun responsabile: non c'è nessuno da avvisare, e non si inventa un
    // destinatario. Lo storico lo dice, così chi ha scritto la regola capisce
    // perché non è arrivato niente.
    if (!ctx.assigneeUserId) return skip('create_notification', 'no_recipient', { message: text.text });
    userIds = [ctx.assigneeUserId];
  } else if (config.recipient === 'admins') {
    userIds = await companyLeaders(sb, ctx.companyId);
    if (!userIds.length) return skip('create_notification', 'no_recipient', { message: text.text });
  } else {
    if (!config.userId) return skip('create_notification', 'no_recipient', { message: text.text });
    userIds = [config.userId];
  }

  return {
    key: 'create_notification',
    outcome: 'ready',
    preview: { message: text.text, recipients: userIds.length },
    write: { kind: 'notify', userIds, text: text.text },
  };
}

// ---------------------------------------------------------------------------
// SECONDO TEMPO — si scrive
//
// ⚠️ Un errore del database NON viene nascosto e non viene trasformato in
// «fatto». Torna come `failed` con un codice, l'esecuzione diventa parziale e
// la schermata lo dice. La sola eccezione è il 23505 sul collegamento di
// un'etichetta, che significa «c'era già» — cioè l'esito voluto, ottenuto da
// qualcun altro nel frattempo (§90).
// ---------------------------------------------------------------------------

export async function applyAction(
  sb: ServerClient, ctx: ActionContext, plan: ActionPlan,
): Promise<ApplyResult> {
  if (plan.outcome === 'skip') return { status: 'skipped', errorCode: plan.errorCode };

  // Il piano si lega a una costante prima dello `switch`: dentro una closure —
  // e la notifica ne usa una per comporre le righe — TypeScript perderebbe il
  // restringimento e `plan.write` tornerebbe a essere l'unione di tutti i casi.
  const write = plan.write;
  switch (write.kind) {
    case 'create_task': {
      const { data, error } = await sb.from('tasks').insert(write.row).select('id').single();
      if (error) return { status: 'failed', errorCode: dbCode(error) };
      return { status: 'succeeded', outputEntityType: 'task', outputEntityId: (data as { id: string }).id };
    }

    case 'update_task': {
      const { error } = await sb.from('tasks').update(write.patch)
        .eq('id', write.taskId).eq('company_id', ctx.companyId);
      if (error) return { status: 'failed', errorCode: dbCode(error) };
      return { status: 'succeeded', outputEntityType: 'task', outputEntityId: write.taskId };
    }

    case 'update_document': {
      const { error } = await sb.from('documents').update(write.patch)
        .eq('id', write.documentId).eq('company_id', ctx.companyId);
      if (error) return { status: 'failed', errorCode: dbCode(error) };
      return { status: 'succeeded', outputEntityType: 'document', outputEntityId: write.documentId };
    }

    case 'tag_document': {
      const { error } = await sb.from('document_tag_links').insert({
        company_id: ctx.companyId, document_id: write.documentId, tag_id: write.tagId,
      });
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          return { status: 'skipped', errorCode: 'already_set' };
        }
        return { status: 'failed', errorCode: dbCode(error) };
      }
      return { status: 'succeeded', outputEntityType: 'document_tag', outputEntityId: write.documentId };
    }

    case 'notify': {
      const entityType = ctx.entityType === 'email_message' ? 'email_message' : ctx.entityType;
      const rows = write.userIds.map((userId) => ({
        company_id: ctx.companyId,
        user_id: userId,
        type: 'workflow_alert',
        entity_type: entityType,
        entity_id: ctx.entityId,
        // §117 — solo ciò che serve a scrivere la frase. Il testo è quello che
        // l'azienda ha composto nella propria regola; nient'altro esce.
        payload: { text: write.text, workflowName: ctx.workflowName, workflowId: ctx.workflowId },
        // Un ritentativo non produce una seconda campanella: l'unicità è
        // (user_id, dedupe_key) e la impone il database (0018).
        dedupe_key: `workflow:${ctx.runId ?? 'dry'}:${plan.key}:${ctx.entityId}`,
      }));
      const { error } = await sb.from('notifications').insert(rows);
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          return { status: 'skipped', errorCode: 'duplicate' };
        }
        return { status: 'failed', errorCode: dbCode(error) };
      }
      return { status: 'succeeded', outputEntityType: 'notification' };
    }
  }
}

/**
 * Il codice tecnico diventa un codice DI DOMINIO quando il progetto ne conosce
 * il significato. `assignee_not_member` non è «errore 23514»: è una persona che
 * nel frattempo è uscita dall'azienda, e la schermata deve poterlo dire (§50).
 */
function dbCode(error: unknown): string {
  const e = error as { message?: string; hint?: string; code?: string } | null;
  const text = `${e?.message ?? ''} ${e?.hint ?? ''}`;
  if (text.includes('assignee_not_member')) return 'assignee_not_member';
  if (text.includes('tag_company_mismatch') || text.includes('too_many_tags')) return 'tag_missing';
  if (text.includes('notification_recipient_not_member')) return 'no_recipient';
  return 'action_failed';
}
