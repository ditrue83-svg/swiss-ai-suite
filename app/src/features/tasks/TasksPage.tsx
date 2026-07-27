// ============================================================================
// Attività — la lista. Risponde a una domanda sola: cosa dobbiamo fare adesso?
//
// Per questo l'ordine non è cronologico ma «cosa richiede attenzione»: prima le
// scadute, poi la priorità alta, poi la scadenza più vicina. L'ordine lo decide
// il database (`list_tasks`), insieme a filtri e paginazione: con mille attività
// ordinare in memoria vorrebbe dire scaricarle tutte per sapere quali contano.
//
// Le viste sono cinque perché rispondono a cinque domande diverse — cosa c'è da
// fare, cosa tocca a me, cosa è in ritardo, cosa è stato fatto, cosa è stato
// messo via. Non è un filtro con cinque valori: è il modo in cui una persona
// guarda il proprio lavoro.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { taskService, priorityFromDueDate, type TaskView } from '@/services/taskService';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { toUserMessage } from '@/lib/errors';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { useMembers } from './useMembers';
import { dueLabel, isOverdue, sourceLabelKey, statusLabelKey } from './taskFormat';
import type { TaskPriority, TaskWithPeople } from '@/types/models';

const PAGE_SIZE = 25;
const VIEWS: { id: TaskView; key: TKey }[] = [
  { id: 'todo', key: 'tasks.viewTodo' },
  { id: 'mine', key: 'tasks.viewMine' },
  { id: 'overdue', key: 'tasks.viewOverdue' },
  { id: 'completed', key: 'tasks.viewCompleted' },
  { id: 'archived', key: 'tasks.viewArchived' },
];

const EMPTY_KEY: Record<TaskView, TKey> = {
  todo: 'tasks.emptyTodo',
  mine: 'tasks.emptyMine',
  overdue: 'tasks.emptyOverdue',
  completed: 'tasks.emptyCompleted',
  archived: 'tasks.emptyArchived',
  all: 'tasks.emptyTodo',
};

export function TasksPage() {
  const t = useT();
  const L = useLabels();
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;
  const { members, byId } = useMembers();

  // La vista sta nell'URL: un collegamento a «Scadute» resta tale se lo si
  // condivide o lo si riapre, e il tasto indietro del browser funziona.
  const [params, setParams] = useSearchParams();
  const view = (params.get('vista') as TaskView) || 'todo';
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [assignee, setAssignee] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Debounce: si cerca quando la persona smette di scrivere, non a ogni tasto.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Cambiando vista o filtro si riparte dalla prima pagina: mostrare la pagina
  // tre di un elenco diverso confonderebbe e basta.
  useEffect(() => { setLimit(PAGE_SIZE); }, [view, debounced, priority, assignee]);

  const { loading, error, data, reload } = useAsync(
    () => taskService.list(companyId, {
      view,
      priority: priority || null,
      assigneeUserId: assignee || null,
      search: debounced || null,
      limit,
    }),
    [companyId, view, priority, assignee, debounced, limit],
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // ---- creazione -----------------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority | ''>('');
  const [newAssignee, setNewAssignee] = useState('');
  const [saving, setSaving] = useState(false);

  // La priorità proposta segue la scadenza finché la persona non sceglie: da
  // quel momento la scelta è sua e non viene più sovrascritta.
  const proposedPriority = useMemo(() => priorityFromDueDate(dueDate || null), [dueDate]);

  async function createTask() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await taskService.create({
        companyId,
        userId: user!.id,
        title,
        dueDate: dueDate || null,
        priority: (newPriority || proposedPriority) as TaskPriority,
        assigneeUserId: newAssignee || null,
        source: 'manual',
      });
      setTitle(''); setDueDate(''); setNewPriority(''); setNewAssignee('');
      setCreating(false);
      reload();
      showToast(t('tasks.created'));
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function memberName(userId: string | null): string {
    if (!userId) return t('tasks.unassigned');
    const m = byId.get(userId);
    if (!m) return t('tasks.unassigned');
    return m.name || t('tasks.unnamedMember');
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('tasks.hubTitle')}</div>
        <div className="page-desc">{t('tasks.hubSubtitle')}</div>
      </div>

      <div className="row-wrap">
        <button className="btn btn-primary btn-block-mobile" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          <Icon name="plus" className="ic-sm" /> {t('tasks.newTask')}
        </button>
        <div className="field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
          {/* Etichetta come `aria-label`: il progetto non ha una classe per
              nascondere visivamente il testo, e inventarne una qui avrebbe
              introdotto CSS fuori dal design system per un solo campo. */}
          <input id="task-search" value={search} onChange={(e) => setSearch(e.target.value)}
            aria-label={t('tasks.searchPlaceholder')} placeholder={t('tasks.searchPlaceholder')} />
        </div>
      </div>

      {creating && (
        <div className="card mt-16">
          <div className="card-title">{t('tasks.newTask')}</div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="nt-title">{t('tasks.titleField')}</label>
              <input id="nt-title" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder={t('tasks.titlePlaceholder')} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="nt-due">{t('tasks.dueLabel')}</label>
              <input id="nt-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="nt-prio">{t('tasks.priorityLabel')}</label>
              <select id="nt-prio" value={newPriority || proposedPriority}
                onChange={(e) => setNewPriority(e.target.value as TaskPriority)}>
                <option value="high">{L.urgency('alta')}</option>
                <option value="medium">{L.urgency('media')}</option>
                <option value="low">{L.urgency('bassa')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="nt-assignee">{t('tasks.assignee')}</label>
              <select id="nt-assignee" value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)}>
                <option value="">{t('tasks.unassigned')}</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.name || t('tasks.unnamedMember')}</option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-sm btn-block-mobile" onClick={() => void createTask()}
            disabled={saving || !title.trim()} aria-busy={saving || undefined}>
            {saving ? <span className="spinner" aria-hidden="true" /> : null} {t('tasks.add')}
          </button>
        </div>
      )}

      <div className="card mt-16">
        <div className="card-title">
          {t('tasks.hubTitle')}
          <span className="filter-group">
            {VIEWS.map((v) => (
              <button key={v.id} className={`btn btn-sm${view === v.id ? ' btn-primary' : ''}`}
                onClick={() => setParams(v.id === 'todo' ? {} : { vista: v.id })} aria-pressed={view === v.id}>
                {t(v.key)}
              </button>
            ))}
          </span>
        </div>

        <div className="row-wrap" style={{ marginBottom: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <select id="f-prio" className="select-inline" value={priority}
              aria-label={t('tasks.filterPriority')}
              onChange={(e) => setPriority(e.target.value as TaskPriority | '')}>
              <option value="">{t('tasks.filterPriority')}: {t('tasks.filterAny')}</option>
              <option value="high">{L.urgency('alta')}</option>
              <option value="medium">{L.urgency('media')}</option>
              <option value="low">{L.urgency('bassa')}</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <select id="f-assignee" className="select-inline" value={assignee}
              aria-label={t('tasks.filterAssignee')}
              onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{t('tasks.filterAssignee')}: {t('tasks.filterAny')}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name || t('tasks.unnamedMember')}</option>
              ))}
            </select>
          </div>
        </div>

        {loading && <><SkeletonLine width="70%" /><SkeletonLine width="55%" /><SkeletonLine width="65%" /></>}
        {error && <ErrorState message={error} onRetry={reload} />}

        {!loading && !error && items.length === 0 && (
          <div className="empty">
            <div>{t(EMPTY_KEY[view])}</div>
            {view === 'todo' && <div className="muted-sm mt-10">{t('tasks.emptyTodoSub')}</div>}
          </div>
        )}

        {!loading && !error && items.map((task) => (
          <TaskRow key={task.id} task={task} assigneeName={memberName(task.assigneeUserId)} />
        ))}

        {!loading && !error && items.length > 0 && (
          <div className="row-wrap" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span className="muted-sm">{t('tasks.countShown', { shown: items.length, total })}</span>
            {items.length < total && (
              <button className="btn btn-sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                {t('tasks.loadMore')}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Una riga dice sei cose e non di più: titolo, chi, stato, priorità, scadenza,
 * da dove viene. Tutta la riga è il collegamento — su un portatile con trackpad
 * centrare una freccia di sedici pixel è una prova di mira.
 */
function TaskRow({ task, assigneeName }: { task: TaskWithPeople; assigneeName: string }) {
  const t = useT();
  const L = useLabels();
  const due = dueLabel(task.dueDate);
  const late = isOverdue(task);
  const priorityWord = task.priority === 'high' ? 'alta' : task.priority === 'medium' ? 'media' : 'bassa';

  return (
    <Link className="list-row is-link" to={`/attivita/${task.id}`} aria-label={task.title}>
      <div className="list-main">
        <div className="list-title">{task.title}</div>
        <div className="list-sub">
          {assigneeName}
          {task.authority ? ` · ${task.authority}` : ''}
          {' · '}{t(sourceLabelKey(task.source))}
          {task.documentId ? <> · <Icon name="document" className="ic-sm" /></> : null}
          {task.emailMessageId ? <> · <Icon name="mail" className="ic-sm" /></> : null}
        </div>
      </div>
      {/* Lo stato è testo, non solo colore: un badge rosso non dice nulla a chi
          non distingue i colori. */}
      <span className="badge badge-neutral">{t(statusLabelKey(task.status))}</span>
      <span className={`badge badge-${priorityWord}`}>{L.urgency(priorityWord)}</span>
      <span className={late ? 'badge badge-alta' : 'badge badge-neutral'}>
        {t(due.key, due.params)}
      </span>
    </Link>
  );
}
