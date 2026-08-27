// ============================================================================
// Il generatore di regole: QUANDO · SOLO SE · ALLORA.
//
// ⚠️ È UN MODULO LINEARE, NON UNA TELA DI NODI (§39).
// Niente trascinamento, niente frecce, niente diagrammi. Tre passaggi in
// colonna, che si leggono nell'ordine in cui si pensano. Un titolare di PMI
// deve poter scrivere una regola utile senza sapere che cosa sia un webhook —
// e senza vedere mai un JSON, un identificativo o il nome di una tabella (§159).
//
// ⚠️ PRIMA DI ATTIVARE SI LEGGE LA FRASE (§161).
// La frase è composta deterministicamente dalla configurazione, quindi descrive
// esattamente la regola che verrà attivata — non una parafrasi generata da
// qualcosa che potrebbe sbagliare.
//
// ⚠️ SI PUÒ PROVARE SENZA CONSEGUENZE (§51).
// La prova sceglie un elemento vero e recente e mostra che cosa succederebbe.
// Non scrive niente: nessuna attività, nessuna notifica, nemmeno una riga di
// storico.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { automationService, type DryRunResult, type SimulationResult, type WorkflowDraft } from '@/services/automationService';
import { documentHubService } from '@/services/documentHubService';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { Input, Select, Textarea } from '@/components/ui/forms';
import { toUserMessage } from '@/lib/errors';
import { LEGACY_MODULES_ENABLED } from '@/lib/env';
import { useT, type TFunction, type TKey } from '@/i18n';
import { useMembers } from '@/features/tasks/useMembers';
import {
  CURRENCIES, MAX_ACTIONS, MAX_CONDITIONS, OPERATORS_BY_TYPE, UNARY_OPERATORS,
  actionsForTrigger, findAction, findField, findTrigger, triggerHasOwner, validateWorkflow,
  type ActionKey, type AutomationEventType, type CreateNotificationConfig,
  type CreateTaskConfig, type Operator, type TriggerDef, type ValidationIssue,
  type WorkflowAction, type WorkflowCondition,
} from './registry';
import {
  actionOutcomeKey, conditionReasonKey, describeCondition, operatorLabelKey,
  pickLabel, summarySentence, triggersOffered, type NameResolver,
} from './automationModel';
import type { AutomationSample, DocumentTag } from '@/types/models';

/** Una condizione nuova parte dal primo campo dell'innesco: mai da un vuoto. */
function blankCondition(trigger: TriggerDef): WorkflowCondition {
  const field = trigger.fields[0];
  return { field: field.path, operator: OPERATORS_BY_TYPE[field.type][0], value: '' };
}

function blankAction(key: ActionKey): WorkflowAction {
  switch (key) {
    case 'create_task':
      return { key, config: { titleTemplate: '', priority: 'medium', dueDate: 'none', linkEntity: true } as CreateTaskConfig };
    case 'assign_task':           return { key, config: { assigneeUserId: '' } };
    case 'set_task_priority':     return { key, config: { priority: 'high' } };
    case 'set_document_category': return { key, config: { category: 'administration' } };
    case 'add_document_tag':      return { key, config: { tagId: '' } };
    case 'create_notification':
      return { key, config: { recipient: 'admins', messageTemplate: '' } as CreateNotificationConfig };
  }
}

export function AutomationBuilderPage() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { activeCompanyId, isAdmin } = useCompany();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;
  const { members, byId } = useMembers();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationEventType>('document_analysis_completed');
  const [conditionMatch, setConditionMatch] = useState<'all' | 'any'>('all');
  const [conditions, setConditions] = useState<WorkflowCondition[]>([]);
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [loaded, setLoaded] = useState(!id);
  const [saving, setSaving] = useState(false);

  const trigger = findTrigger(triggerType) as TriggerDef;

  // Le etichette documentali servono ai menu e ai nomi: si caricano una volta.
  const { data: tags } = useAsync(() => documentHubService.listTags(companyId), [companyId]);

  const { loading, error } = useAsync(async () => {
    if (!id) return null;
    const wf = await automationService.get(id);
    if (!wf) return null;
    setName(wf.name);
    setDescription(wf.description ?? '');
    setTriggerType(wf.triggerType);
    setConditionMatch(wf.conditionMatch);
    setConditions(wf.conditions);
    setActions(wf.actions);
    setLoaded(true);
    return wf;
  }, [id]);

  const names: NameResolver = useMemo(() => ({
    member: (userId) => {
      if (!userId) return t('tasks.unassigned');
      const m = byId.get(userId);
      return m ? (m.name || t('tasks.unnamedMember')) : t('tasks.unknownMember');
    },
    tag: (tagId) => (tags ?? []).find((g: DocumentTag) => g.id === tagId)?.name ?? t('automations.unknownTag'),
  }), [byId, tags, t]);

  const draft: WorkflowDraft = useMemo(() => ({
    id, name, description, triggerType, conditionMatch, conditions, actions,
  }), [id, name, description, triggerType, conditionMatch, conditions, actions]);

  const issues = useMemo(
    () => validateWorkflow({ ...draft }, { forActivation: true }),
    [draft],
  );
  const summary = useMemo(() => summarySentence(t, draft, names), [t, draft, names]);

  /**
   * Cambiare innesco azzera condizioni e azioni, e lo si DICE prima.
   * I campi ammessi dipendono dall'innesco: tenerne alcuni «se per caso vanno
   * bene» produrrebbe una regola che sembra conservata e non lo è.
   */
  function changeTrigger(next: AutomationEventType) {
    if (next === triggerType) return;
    if ((conditions.length || actions.length)
        && !window.confirm(t('automations.confirmTriggerChange'))) return;
    setTriggerType(next);
    setConditions([]);
    setActions([]);
  }

  async function save(): Promise<string | null> {
    if (saving) return null;
    setSaving(true);
    try {
      const saved = await automationService.save(companyId, draft);
      showToast(t('automations.saved'));
      if (!id) navigate(`/automazioni/${saved.id}/modifica`, { replace: true });
      return saved.id;
    } catch (e) {
      showToast(toUserMessage(e));
      return null;
    } finally {
      setSaving(false);
    }
  }

  /** §161 — si salva, si legge la frase, si conferma. In quest'ordine. */
  async function activate() {
    if (!window.confirm(`${summary}\n\n${t('automations.confirmActivate')}`)) return;
    const savedId = await save();
    if (!savedId) return;
    try {
      await automationService.setStatus(companyId, savedId, 'activate');
      showToast(t('automations.activated'));
      navigate(`/automazioni/${savedId}`);
    } catch (e) {
      showToast(toUserMessage(e));
    }
  }

  if (!isAdmin) {
    return (
      <div className="card mt-16">
        <div className="empty">{t('automations.errors.forbidden')}</div>
      </div>
    );
  }
  if (loading || !loaded) return <div className="card mt-16"><SkeletonLine width="60%" /><SkeletonLine width="40%" /></div>;
  if (error) return <div className="card mt-16"><ErrorState message={error} /></div>;

  return (
    <>
      <div className="page-head">
        <div className="page-title">{id ? t('automations.editTitle') : t('automations.newTitle')}</div>
        <div className="page-desc">{t('automations.builderIntro')}</div>
      </div>

      <div className="card mt-16">
        <div className="grid-2">
          <Input id="wf-name" label={t('automations.nameField')}
            value={name} onChange={(e) => setName(e.target.value)}
            maxLength={80} placeholder={t('automations.namePlaceholder')} />
          <Input id="wf-desc" label={t('automations.descriptionField')}
            value={description} onChange={(e) => setDescription(e.target.value)}
            maxLength={500} placeholder={t('automations.descriptionPlaceholder')} />
        </div>
      </div>

      {/* ---- 1. QUANDO ---------------------------------------------------- */}
      <div className="card mt-16">
        <div className="card-title">{t('automations.step1')}</div>
        <Select id="wf-trigger" label={t('automations.triggerField')} value={triggerType}
          onChange={(e) => changeTrigger(e.target.value as AutomationEventType)}>
          {/* `triggersOffered(triggerType)`: gli inneschi dei moduli fuori
              perimetro non si offrono (D-10), ma quello di una regola
              esistente resta — una tendina che non contiene il valore che
              mostra è una tendina che mente. */}
          {triggersOffered(LEGACY_MODULES_ENABLED, triggerType).map((tr) => (
            <option key={tr.key} value={tr.key}>{t(tr.labelKey as TKey)}</option>
          ))}
        </Select>
        <p className="muted-sm">{t(trigger.descriptionKey as TKey)}</p>
      </div>

      {/* ---- 2. SOLO SE --------------------------------------------------- */}
      <div className="card mt-16">
        <div className="card-title">
          {t('automations.step2')}
          <span className="filter-group">
            <button className="btn btn-sm btn-toggle"
              onClick={() => setConditionMatch('all')} aria-pressed={conditionMatch === 'all'}>
              {t('automations.matchAll')}
            </button>
            <button className="btn btn-sm btn-toggle"
              onClick={() => setConditionMatch('any')} aria-pressed={conditionMatch === 'any'}>
              {t('automations.matchAny')}
            </button>
          </span>
        </div>

        {conditions.length === 0 && (
          <p className="muted-sm">{t('automations.noConditionsHint')}</p>
        )}

        {conditions.map((c, i) => (
          <ConditionRow
            key={i} index={i} trigger={trigger} condition={c} members={members}
            onChange={(next) => setConditions((list) => list.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setConditions((list) => list.filter((_, j) => j !== i))}
          />
        ))}

        <button className="btn btn-sm mt-10" disabled={conditions.length >= MAX_CONDITIONS}
          onClick={() => setConditions((list) => [...list, blankCondition(trigger)])}>
          <Icon name="plus" className="ic-sm" /> {t('automations.addCondition')}
        </button>
      </div>

      {/* ---- 3. ALLORA ---------------------------------------------------- */}
      <div className="card mt-16">
        <div className="card-title">{t('automations.step3')}</div>

        {actions.map((a, i) => (
          <ActionCard
            key={i} index={i} total={actions.length} trigger={trigger} action={a}
            members={members} tags={tags ?? []}
            onChange={(next) => setActions((list) => list.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setActions((list) => list.filter((_, j) => j !== i))}
            onMove={(delta) => setActions((list) => {
              const next = [...list];
              const target = i + delta;
              if (target < 0 || target >= next.length) return list;
              [next[i], next[target]] = [next[target], next[i]];
              return next;
            })}
          />
        ))}

        <div className="row-wrap mt-10">
          {actionsForTrigger(trigger).map((def) => (
            <button key={def.key} className="btn btn-sm"
              disabled={actions.length >= MAX_ACTIONS}
              onClick={() => setActions((list) => [...list, blankAction(def.key)])}>
              <Icon name="plus" className="ic-sm" /> {t(def.labelKey as TKey)}
            </button>
          ))}
        </div>
        {actions.length >= MAX_ACTIONS && (
          <p className="muted-sm mt-10">{t('automations.maxActionsReached', { max: MAX_ACTIONS })}</p>
        )}
      </div>

      {/* ---- Riepilogo, problemi, prova ------------------------------------ */}
      <div className="card mt-16">
        <div className="card-title">{t('automations.summaryTitle')}</div>
        <p>{summary}</p>

        {issues.length > 0 && (
          <div className="warn-box mt-10">
            <Icon name="alert" className="ic-sm" />
            <div>
              <div>{t('automations.cannotActivate')}</div>
              <ul className="mt-8">
                {issues.map((issue, i) => <li key={i}>{issueText(t, issue)}</li>)}
              </ul>
            </div>
          </div>
        )}

        <div className="row-wrap mt-14">
          <button className="btn btn-primary" onClick={() => void save()}
            disabled={saving || !name.trim()} aria-busy={saving || undefined}>
            {saving ? <span className="spinner" aria-hidden="true" /> : null} {t('automations.saveDraft')}
          </button>
          <button className="btn" onClick={() => void activate()}
            disabled={saving || issues.length > 0 || !name.trim()}>
            <Icon name="checkCircle" className="ic-sm" /> {t('automations.activate')}
          </button>
        </div>
        <p className="muted-sm mt-10">{t('automations.activationNotice')}</p>
      </div>

      <TestPanel companyId={companyId} draft={draft} trigger={trigger} names={names} />
    </>
  );
}

/** Il testo di un problema di validazione, nella lingua di chi legge (§50). */
function issueText(t: TFunction, issue: ValidationIssue): string {
  const key = `automations.validation.${issue.key}` as TKey;
  const text = t(key, issue.params as Record<string, string | number> | undefined);
  // Una chiave che non esiste nei dizionari non si mostra grezza: diventa il
  // messaggio generico, che è la verità.
  return text === key ? t('automations.validation.generic') : text;
}

// ---------------------------------------------------------------------------
// Una condizione
// ---------------------------------------------------------------------------

interface Member { userId: string; name: string }

function ConditionRow({
  index, trigger, condition, members, onChange, onRemove,
}: {
  index: number; trigger: TriggerDef; condition: WorkflowCondition;
  members: Member[];
  onChange: (c: WorkflowCondition) => void; onRemove: () => void;
}) {
  const t = useT();
  const field = findField(trigger, condition.field) ?? trigger.fields[0];
  const operators = OPERATORS_BY_TYPE[field.type];
  const unary = (UNARY_OPERATORS as readonly string[]).includes(condition.operator);
  const id = `cond-${index}`;

  function changeField(path: string) {
    const next = findField(trigger, path);
    if (!next) return;
    // Cambiando campo, l'operatore precedente può non avere più senso: si
    // riparte dal primo ammesso invece di conservarne uno invalido.
    //
    // ⚠️ La VALUTA si scrive nella condizione, non solo nel menu. Trovato
    // aprendo la schermata: il menu mostrava «CHF» selezionato mentre la
    // configurazione non conteneva alcuna valuta — la tendina diceva una cosa
    // che il dato non diceva, la frase riassuntiva scriveva «maggiore di 5000»
    // senza valuta e l'attivazione veniva rifiutata senza che si capisse
    // perché. Un valore mostrato deve essere un valore salvato.
    onChange({
      field: path,
      operator: OPERATORS_BY_TYPE[next.type][0],
      value: '',
      ...(next.hasCurrency ? { currency: 'CHF' } : {}),
    });
  }

  return (
    <div className="list-row">
      <div className="list-main">
        <div className="row-wrap">
          <div className="field m-0" style={{ minWidth: 180 }}>
            <label htmlFor={`${id}-field`}>{t('automations.conditionField')}</label>
            <select id={`${id}-field`} value={field.path} onChange={(e) => changeField(e.target.value)}>
              {trigger.fields.map((f) => (
                <option key={f.path} value={f.path}>{t(f.labelKey as TKey)}</option>
              ))}
            </select>
          </div>

          <div className="field m-0" style={{ minWidth: 150 }}>
            <label htmlFor={`${id}-op`}>{t('automations.conditionOperator')}</label>
            <select id={`${id}-op`} value={condition.operator}
              onChange={(e) => onChange({
                ...condition, operator: e.target.value as Operator, value: '',
                ...(field.hasCurrency ? { currency: condition.currency ?? 'CHF' } : {}),
              })}>
              {operators.map((op) => (
                <option key={op} value={op}>{t(operatorLabelKey(op))}</option>
              ))}
            </select>
          </div>

          {!unary && (
            <ValueInput id={id} field={field} condition={condition} members={members} onChange={onChange} />
          )}
        </div>
      </div>
      <button className="mini-btn" onClick={onRemove} aria-label={t('automations.removeCondition')}>
        <Icon name="trash" className="ic-sm" />
      </button>
    </div>
  );
}

function ValueInput({
  id, field, condition, members, onChange,
}: {
  id: string; field: TriggerDef['fields'][number]; condition: WorkflowCondition;
  members: Member[]; onChange: (c: WorkflowCondition) => void;
}) {
  const t = useT();
  const label = t('automations.conditionValue');

  if (condition.operator === 'in' && field.options) {
    const selected = Array.isArray(condition.value) ? condition.value.map(String) : [];
    return (
      <div className="field m-0" style={{ minWidth: 220 }}>
        <span className="group-label">{label}</span>
        <div className="checks">
          {field.options.map((opt) => (
            <label key={opt} className="check-pill">
              <input type="checkbox" checked={selected.includes(opt)}
                onChange={(e) => onChange({
                  ...condition,
                  value: e.target.checked ? [...selected, opt] : selected.filter((v) => v !== opt),
                })} />
              {field.optionsLabelPath ? pickLabel(t, field.optionsLabelPath, opt) : opt}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === 'enum' && field.options) {
    return (
      <div className="field m-0" style={{ minWidth: 180 }}>
        <label htmlFor={`${id}-value`}>{label}</label>
        <select id={`${id}-value`} value={String(condition.value ?? '')}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}>
          <option value="">{t('automations.chooseValue')}</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {field.optionsLabelPath ? pickLabel(t, field.optionsLabelPath, opt) : opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'user') {
    return (
      <div className="field m-0" style={{ minWidth: 180 }}>
        <label htmlFor={`${id}-value`}>{label}</label>
        <select id={`${id}-value`} value={String(condition.value ?? '')}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}>
          <option value="">{t('automations.chooseValue')}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name || t('tasks.unnamedMember')}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'boolean') {
    return (
      <div className="field m-0" style={{ minWidth: 140 }}>
        <label htmlFor={`${id}-value`}>{label}</label>
        <select id={`${id}-value`} value={String(condition.value ?? '')}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}>
          <option value="">{t('automations.chooseValue')}</option>
          <option value="true">{t('common.yes')}</option>
          <option value="false">{t('common.no')}</option>
        </select>
      </div>
    );
  }

  if (field.type === 'number' || condition.operator === 'within_days') {
    return (
      <>
        <div className="field m-0" style={{ minWidth: 120 }}>
          <label htmlFor={`${id}-value`}>
            {condition.operator === 'within_days' ? t('automations.daysField') : label}
          </label>
          <input id={`${id}-value`} type="number" inputMode="decimal"
            value={String(condition.value ?? '')}
            onChange={(e) => onChange({ ...condition, value: e.target.value })} />
        </div>
        {/* §27 — su un importo la valuta è obbligatoria, e non si converte:
            CHF 5'000 e EUR 5'000 non sono lo stesso importo. */}
        {field.hasCurrency && (
          <div className="field m-0" style={{ minWidth: 110 }}>
            <label htmlFor={`${id}-cur`}>{t('automations.currencyField')}</label>
            <select id={`${id}-cur`} value={condition.currency ?? 'CHF'}
              onChange={(e) => onChange({ ...condition, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="field m-0" style={{ minWidth: 200 }}>
      <label htmlFor={`${id}-value`}>{label}</label>
      <input id={`${id}-value`} value={String(condition.value ?? '')} maxLength={200}
        onChange={(e) => onChange({ ...condition, value: e.target.value })} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Un'azione
// ---------------------------------------------------------------------------

function ActionCard({
  index, total, trigger, action, members, tags, onChange, onRemove, onMove,
}: {
  index: number; total: number; trigger: TriggerDef; action: WorkflowAction;
  members: Member[]; tags: DocumentTag[];
  onChange: (a: WorkflowAction) => void; onRemove: () => void; onMove: (delta: number) => void;
}) {
  const t = useT();
  const def = findAction(action.key);
  const id = `act-${index}`;
  const config = action.config as unknown as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...action, config: { ...config, ...patch } as unknown as WorkflowAction['config'] });

  return (
    <div className="card mt-10" style={{ background: 'transparent' }}>
      <div className="card-title">
        {index + 1}. {def ? t(def.labelKey as TKey) : action.key}
        <span className="filter-group">
          {/* L'ordine si cambia con due pulsanti e non trascinando: il
              trascinamento non è raggiungibile da tastiera (§156). */}
          <button className="mini-btn" onClick={() => onMove(-1)} disabled={index === 0}
            aria-label={t('automations.moveUp')}><Icon name="arrowLeft" className="ic-sm" /></button>
          <button className="mini-btn" onClick={() => onMove(1)} disabled={index === total - 1}
            aria-label={t('automations.moveDown')}><Icon name="arrowRight" className="ic-sm" /></button>
          <button className="mini-btn" onClick={onRemove}
            aria-label={t('automations.removeAction')}><Icon name="trash" className="ic-sm" /></button>
        </span>
      </div>

      {action.key === 'create_task' && (
        <>
          <Input id={`${id}-title`} label={t('automations.taskTitleField')}
            value={String(config.titleTemplate ?? '')} maxLength={200}
            onChange={(e) => set({ titleTemplate: e.target.value })}
            hint={t('automations.placeholdersAvailable', { list: trigger.templates.join(' ') })} />
          <Textarea id={`${id}-desc`} label={t('automations.taskDescriptionField')}
            rows={2} maxLength={1000}
            value={String(config.descriptionTemplate ?? '')}
            onChange={(e) => set({ descriptionTemplate: e.target.value })} />
          <div className="grid-2">
            <Select id={`${id}-prio`} label={t('automations.priorityField')}
              value={String(config.priority ?? 'medium')}
              onChange={(e) => set({ priority: e.target.value })}>
              <option value="high">{pickLabel(t, 'automations.values.taskPriority', 'high')}</option>
              <option value="medium">{pickLabel(t, 'automations.values.taskPriority', 'medium')}</option>
              <option value="low">{pickLabel(t, 'automations.values.taskPriority', 'low')}</option>
              {trigger.fields.some((f) => f.path === 'analysis.urgency') && (
                <option value="from_urgency">{t('automations.describe.priorityFromUrgency')}</option>
              )}
            </Select>
            <Select id={`${id}-assignee`} label={t('automations.assigneeField')}
              value={String(config.assigneeUserId ?? '')}
              onChange={(e) => set({ assigneeUserId: e.target.value || null })}>
              <option value="">{t('tasks.unassigned')}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name || t('tasks.unnamedMember')}</option>
              ))}
            </Select>
            <Select id={`${id}-due`} label={t('automations.dueDateField')}
              value={String(config.dueDate ?? 'none')}
              onChange={(e) => set({ dueDate: e.target.value })}>
              <option value="none">{t('automations.due.none')}</option>
              {trigger.fields.some((f) => f.path === 'analysis.deadline') && (
                <>
                  <option value="from_deadline">{t('automations.due.fromDeadline')}</option>
                  <option value="before_deadline">{t('automations.due.beforeDeadline')}</option>
                </>
              )}
              {/* 0021 — la scadenza di PAGAMENTO, offerta solo dove esiste:
                  sugli inneschi di Finanze. Mostrarla altrove significherebbe
                  far comporre una regola che non potrà mai produrre una data,
                  ed è la stessa ragione per cui «dalla scadenza del
                  documento» compare solo dove c'è un'analisi. */}
              {trigger.fields.some((f) => f.path === 'finance.due_date') && (
                <>
                  <option value="from_finance_due_date">{t('automations.due.fromFinanceDue')}</option>
                  <option value="before_finance_due_date">{t('automations.due.beforeFinanceDue')}</option>
                </>
              )}
              <option value="in_days">{t('automations.due.inDays')}</option>
            </Select>
            {(config.dueDate === 'before_deadline' || config.dueDate === 'in_days'
              || config.dueDate === 'before_finance_due_date') && (
              <Input id={`${id}-days`} label={t('automations.daysField')}
                type="number" min={0} max={365}
                value={String(config.dueDateDays ?? '')}
                onChange={(e) => set({ dueDateDays: Number(e.target.value) })} />
            )}
          </div>
          {/* ⚠️ L'etichetta nomina CIÒ CHE VIENE COLLEGATO DAVVERO. Diceva
              «il documento» su ogni innesco: su un contratto e su una
              controparte era falsa, e il difetto che ne derivava era peggiore
              di una parola sbagliata — sugli inneschi del CRM la casella era
              spuntata e non collegava nulla, perché il motore non passava
              l'organizzazione. Ora fa entrambe le cose e lo dice. */}
          {trigger.entityType !== 'task' && (
            <label className="check-pill">
              <input type="checkbox" checked={config.linkEntity !== false}
                onChange={(e) => set({ linkEntity: e.target.checked })} />
              {t(linkEntityKey(trigger))}
            </label>
          )}
          {(config.dueDate === 'from_deadline'
            || config.dueDate === 'from_finance_due_date') && (
            <p className="muted-sm mt-10">{t('automations.dueDateHint')}</p>
          )}
        </>
      )}

      {action.key === 'assign_task' && (
        <Select id={`${id}-assignee`} label={t('automations.assigneeField')}
          value={String(config.assigneeUserId ?? '')}
          onChange={(e) => set({ assigneeUserId: e.target.value })}>
          <option value="">{t('automations.chooseValue')}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name || t('tasks.unnamedMember')}</option>
          ))}
        </Select>
      )}

      {action.key === 'set_task_priority' && (
        <Select id={`${id}-prio`} label={t('automations.priorityField')}
          value={String(config.priority ?? 'high')}
          onChange={(e) => set({ priority: e.target.value })}>
          <option value="high">{pickLabel(t, 'automations.values.taskPriority', 'high')}</option>
          <option value="medium">{pickLabel(t, 'automations.values.taskPriority', 'medium')}</option>
          <option value="low">{pickLabel(t, 'automations.values.taskPriority', 'low')}</option>
        </Select>
      )}

      {action.key === 'set_document_category' && (
        <>
          <Select id={`${id}-cat`} label={t('automations.categoryField')}
            value={String(config.category ?? '')}
            onChange={(e) => set({ category: e.target.value })}>
            <option value="">{t('automations.chooseValue')}</option>
            {(findField(trigger, 'document.category')?.options ?? []).map((opt) => (
              <option key={opt} value={opt}>{pickLabel(t, 'labels.categories', opt)}</option>
            ))}
          </Select>
          {/* §89 — va detto PRIMA, non scoperto leggendo lo storico. */}
          <p className="muted-sm">{t('automations.categoryManualHint')}</p>
        </>
      )}

      {action.key === 'add_document_tag' && (
        <Select id={`${id}-tag`} label={t('automations.tagField')}
          value={String(config.tagId ?? '')}
          onChange={(e) => set({ tagId: e.target.value })}
          hint={t('automations.tagHint')}>
          <option value="">{t('automations.chooseValue')}</option>
          {tags.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
      )}

      {action.key === 'create_notification' && (
        <>
          <div className="grid-2">
            <Select id={`${id}-rec`} label={t('automations.recipientField')}
              value={String(config.recipient ?? 'admins')}
              onChange={(e) => set({ recipient: e.target.value })}>
              <option value="admins">{t('automations.recipients.admins')}</option>
              {/* Offerto dove l'entità ha davvero un responsabile: attività,
                  contratto, controparte, trattativa. Il validatore applica lo
                  stesso elenco — è la stessa funzione, non una copia. */}
              {triggerHasOwner(trigger) && (
                <option value="assignee">{t('automations.recipients.assignee')}</option>
              )}
              <option value="user">{t('automations.recipients.user')}</option>
            </Select>
            {config.recipient === 'user' && (
              <Select id={`${id}-user`} label={t('automations.recipientUserField')}
                value={String(config.userId ?? '')}
                onChange={(e) => set({ userId: e.target.value })}>
                <option value="">{t('automations.chooseValue')}</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.name || t('tasks.unnamedMember')}</option>
                ))}
              </Select>
            )}
          </div>
          <Input id={`${id}-msg`} label={t('automations.messageField')}
            value={String(config.messageTemplate ?? '')} maxLength={200}
            onChange={(e) => set({ messageTemplate: e.target.value })}
            hint={t('automations.placeholdersAvailable', { list: trigger.templates.join(' ') })} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// La prova (§51/§53/§165)
// ---------------------------------------------------------------------------

function TestPanel({
  companyId, draft, trigger, names,
}: {
  companyId: string; draft: WorkflowDraft; trigger: TriggerDef; names: NameResolver;
}) {
  const t = useT();
  const { showToast } = useToast();
  const [samples, setSamples] = useState<AutomationSample[]>([]);
  // ⚠️ «Non ce ne sono» e «non ho potuto chiedere» sono cose diverse, e
  // confonderle è la forma di guasto che questo progetto evita ovunque: con la
  // migrazione non applicata la pagina diceva serenamente «non ci sono ancora
  // elementi su cui provare», che è falso — gli elementi ci sono, è la
  // richiesta a non essere arrivata. Trovato APRENDO la pagina.
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [entityId, setEntityId] = useState('');
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Cambiando innesco cambia l'insieme degli elementi su cui si può provare:
  // tenere quelli di prima significherebbe offrire un documento per una regola
  // che parla di attività.
  useEffect(() => {
    setSamples([]); setSamplesError(null); setEntityId(''); setResult(null); setSimulation(null);
    let alive = true;
    automationService.samples(companyId, draft.triggerType)
      .then((list) => { if (alive) setSamples(list); })
      .catch((e) => { if (alive) setSamplesError(toUserMessage(e)); });
    return () => { alive = false; };
  }, [companyId, draft.triggerType]);

  async function runTest() {
    if (!entityId || busy) return;
    setBusy(true);
    try {
      setResult(await automationService.dryRun(companyId, draft, entityId));
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function runSimulation() {
    if (busy) return;
    setBusy(true);
    try {
      setSimulation(await automationService.simulate(companyId, draft, 30));
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-16">
      <div className="card-title">{t('automations.testTitle')}</div>
      <p className="muted-sm">{t('automations.testIntro')}</p>

      <div className="row-wrap">
        <div className="field m-0" style={{ minWidth: 260, flex: 1 }}>
          <label htmlFor="wf-sample">{t('automations.testEntity')}</label>
          <select id="wf-sample" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">{t('automations.chooseValue')}</option>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>{s.label ?? t('automations.untitledEntity')}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-sm" onClick={() => void runTest()} disabled={!entityId || busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('automations.runTest')}
        </button>
        <button className="btn btn-sm" onClick={() => void runSimulation()} disabled={busy}>
          {t('automations.runSimulation')}
        </button>
      </div>

      {samplesError && (
        <div className="warn-box mt-10"><Icon name="alert" className="ic-sm" /> {samplesError}</div>
      )}
      {!samplesError && samples.length === 0 && (
        <p className="muted-sm mt-10">{t('automations.noSamples')}</p>
      )}

      {simulation && (
        <div className="info-box mt-14">
          <Icon name="alert" className="ic-sm" />
          {t('automations.simulationResult', {
            matched: simulation.matched, examined: simulation.examined, days: simulation.days,
          })}
          {simulation.notEvaluable > 0 && ` ${t('automations.simulationNotEvaluable', { n: simulation.notEvaluable })}`}
        </div>
      )}

      {result && <DryRunView result={result} trigger={trigger} draft={draft} names={names} />}
    </div>
  );
}

function DryRunView({
  result, trigger, draft, names,
}: {
  result: DryRunResult; trigger: TriggerDef; draft: WorkflowDraft; names: NameResolver;
}) {
  const t = useT();

  if (!result.found) {
    return <div className="warn-box mt-14"><Icon name="alert" className="ic-sm" /> {t('automations.testNotFound')}</div>;
  }

  return (
    <div className="mt-14">
      <div className="group-label">{t('automations.testConditions')}</div>
      {result.conditions.length === 0 && <p className="muted-sm">{t('automations.noConditionsHint')}</p>}
      {result.conditions.map((c, i) => {
        const condition = draft.conditions[i];
        const reason = conditionReasonKey(c.reason);
        return (
          <div key={i} className="list-row">
            <div className="list-main">
              <div className="list-title">
                {c.outcome === 'true' ? '✓' : c.outcome === 'false' ? '✗' : '?'}{' '}
                {condition ? describeCondition(t, trigger, condition, names) : c.field}
              </div>
              {reason && <div className="list-sub">{t(reason)}</div>}
            </div>
          </div>
        );
      })}

      <div className="group-label mt-14">{t('automations.testOutcome')}</div>
      {!result.evaluable && (
        <div className="warn-box"><Icon name="alert" className="ic-sm" /> {t('automations.testNotEvaluable')}</div>
      )}
      {result.evaluable && !result.matched && (
        <div className="info-box"><Icon name="alert" className="ic-sm" /> {t('automations.testNoMatch')}</div>
      )}
      {result.evaluable && result.matched && result.actions.length === 0 && (
        <p className="muted-sm">{t('automations.testNoActions')}</p>
      )}
      {result.actions.map((a, i) => {
        const outcome = actionOutcomeKey(a.errorCode);
        const def = findAction(a.key as ActionKey);
        return (
          <div key={i} className="list-row">
            <div className="list-main">
              <div className="list-title">
                {a.outcome === 'ready' ? '✓' : '—'} {def ? t(def.labelKey as TKey) : a.key}
              </div>
              <div className="list-sub">{previewText(t, a.preview, names)}</div>
              {outcome && <div className="list-sub">{t(outcome)}</div>}
            </div>
          </div>
        );
      })}

      <p className="muted-sm mt-10">{t('automations.testNoWrites')}</p>
    </div>
  );
}

/** Che cosa viene collegato all'attività, secondo l'entità dell'innesco. */
function linkEntityKey(trigger: TriggerDef): TKey {
  if (trigger.entityType === 'contract') return 'automations.linkEntityContract';
  if (trigger.entityType === 'crm_organization' || trigger.entityType === 'crm_opportunity') {
    return 'automations.linkEntityCrm';
  }
  return 'automations.linkEntity';
}

/** L'anteprima di un'azione, in parole. Mai identificativi in pagina. */
function previewText(
  t: TFunction, preview: Record<string, string | number | boolean | null>, names: NameResolver,
): string {
  const parts: string[] = [];
  if (preview.title) parts.push(`«${preview.title}»`);
  if (preview.message) parts.push(`«${preview.message}»`);
  if (preview.priority) parts.push(pickLabel(t, 'automations.values.taskPriority', String(preview.priority)));
  if (preview.dueDate) parts.push(t('automations.previewDue', { date: String(preview.dueDate) }));
  if (preview.assigneeUserId) parts.push(names.member(String(preview.assigneeUserId)));
  if (preview.category) parts.push(pickLabel(t, 'labels.categories', String(preview.category)));
  if (preview.tag) parts.push(String(preview.tag));
  // L'identificativo NON si stampa (§53): si dice che il collegamento c'è.
  if (preview.crmOrganizationId) parts.push(t('automations.previewLinkedClient'));
  if (typeof preview.recipients === 'number') {
    parts.push(t('automations.previewRecipients', { n: preview.recipients }));
  }
  return parts.join(' · ');
}
