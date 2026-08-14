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
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { taskService, type TaskView } from '@/services/taskService';
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
import { dueLabel, sourceLabelKey } from './taskFormat';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import { StatusMark } from '@/components/ui/StatusMark';
import { PriorityMark } from '@/components/ui/PriorityMark';
import { MarkLegend } from '@/components/ui/MarkLegend';
import { DeadlinesHead } from './DeadlinesHead';
import { TaskCreateForm } from './TaskCreateForm';
import {
  EMPTY_TASK_FORM, createSubmitLatch, safeDatePrefill, taskFormSubmission, type TaskFormValues,
} from './taskCreateModel';
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
  // Il modulo è `TaskCreateForm`, condiviso con il dettaglio di un documento:
  // qui restano soltanto lo stato dei campi e che cosa succede DOPO il
  // salvataggio, che nei due posti è diverso (qui si azzera e si richiude, là
  // si mostra l'attività appena creata).
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TaskFormValues>(EMPTY_TASK_FORM);
  const [saving, setSaving] = useState(false);
  const newTaskButtonRef = useRef<HTMLButtonElement>(null);
  // Stessa corsa del dettaglio Documento, stessa difesa: vedi `createSubmitLatch`.
  const latch = useRef(createSubmitLatch());

  // Il Calendario NON ha un proprio modulo di creazione (§17): quando si preme
  // un giorno, porta qui con la data nell'URL e si apre QUESTO modulo, che è
  // l'unico del prodotto. Due moduli avrebbero significato due posti in cui
  // ricordarsi della priorità proposta e dei passaggi derivati da un'analisi.
  useEffect(() => {
    const prefill = params.get('nuova');
    if (!prefill) return;
    // Si accetta solo una data nella forma attesa: un valore arbitrario
    // dall'URL non deve finire in un campo che poi viene salvato.
    const safe = safeDatePrefill(prefill);
    if (safe) setForm((f) => ({ ...f, dueDate: safe }));
    setCreating(true);
    const next = new URLSearchParams(params);
    next.delete('nuova');
    setParams(next, { replace: true });
  }, [params, setParams]);

  async function createTask() {
    const payload = taskFormSubmission(form);
    if (!payload.title.trim()) return;
    if (!latch.current.tryAcquire()) return;
    setSaving(true);
    try {
      await taskService.create({
        companyId,
        userId: user!.id,
        ...payload,
        source: 'manual',
      });
      setForm(EMPTY_TASK_FORM);
      setCreating(false);
      reload();
      showToast(t('tasks.created'));
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      latch.current.release();
      setSaving(false);
    }
  }

  /** Chiudere il modulo riporta il fuoco al pulsante che lo ha aperto. */
  function closeCreate() {
    setCreating(false);
    newTaskButtonRef.current?.focus();
  }

  function memberName(userId: string | null): string {
    if (!userId) return t('tasks.unassigned');
    const m = byId.get(userId);
    if (!m) return t('tasks.unassigned');
    return m.name || t('tasks.unnamedMember');
  }

  return (
    <>
      <DeadlinesHead mode="list" />

      <div className="row-wrap">
        <button ref={newTaskButtonRef} className="btn btn-primary btn-block-mobile"
          onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          <Icon name="plus" className="ic-sm" /> {t('tasks.newTask')}
        </button>
        <div className="field m-0" style={{ flex: 1, minWidth: 200 }}>
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
          <TaskCreateForm
            idPrefix="nt"
            values={form}
            onChange={setForm}
            onSubmit={() => void createTask()}
            onCancel={closeCreate}
            saving={saving}
            members={members}
            autoFocus
          />
        </div>
      )}

      <div className="card mt-16">
        <div className="card-title">
          {t('tasks.hubTitle')}
          {/* Le cinque viste sono uno STATO di ciò che si guarda, non cinque
              azioni: in blu d'azione competevano con «Nuova attività», che è
              l'unica azione primaria della schermata. Stessa scelta di
              «Attivi/Archiviati» dei Documenti (`btn-toggle`). Restano
              `filter-group` e non `segmented`: cinque estremi attaccati non
              stanno su una riga a 375 pixel, e spezzati a metà un interruttore
              unito si legge peggio di cinque pulsanti distinti. */}
          <span className="filter-group">
            {VIEWS.map((v) => (
              <button key={v.id} className="btn btn-sm btn-toggle"
                onClick={() => setParams(v.id === 'todo' ? {} : { vista: v.id })} aria-pressed={view === v.id}>
                {t(v.key)}
              </button>
            ))}
          </span>
        </div>

        <div className="row-wrap mb-3">
          <div className="field m-0">
            <select id="f-prio" className="select-inline" value={priority}
              aria-label={t('tasks.filterPriority')}
              onChange={(e) => setPriority(e.target.value as TaskPriority | '')}>
              <option value="">{t('tasks.filterPriority')}: {t('tasks.filterAny')}</option>
              <option value="high">{L.urgency('alta')}</option>
              <option value="medium">{L.urgency('media')}</option>
              <option value="low">{L.urgency('bassa')}</option>
            </select>
          </div>
          <div className="field m-0">
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
          <div className="row-wrap mt-3" style={{ justifyContent: 'space-between' }}>
            <span className="muted-sm">{t('tasks.countShown', { shown: items.length, total })}</span>
            {items.length < total && (
              <button className="btn btn-sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                {t('tasks.loadMore')}
              </button>
            )}
          </div>
        )}

        {/* La legenda dei segni: la stessa di Documenti e Incentivi, richiusa.
            Qui compaiono tre famiglie in ogni riga — stato, priorità, termine —
            e il posto dove si impara che cosa vogliono dire è uno solo. */}
        <MarkLegend />
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
  const due = dueLabel(task.dueDate);

  return (
    <Link className="list-row is-link" to={`/attivita/${task.id}`} aria-label={task.title}>
      <div className="list-main">
        <div className="list-title">{task.title}</div>
        {/* ⚠️ OGNI VALORE È UN ELEMENTO, e i `·` scritti a mano non ci sono più.
            Il separatore lo mette `.list-sub` fra due fratelli (app.css): con i
            punti scritti qui, un'attività che viene DA UN DOCUMENTO ED È
            arrivata VIA EMAIL — le uniche due icone insieme — ne mostrava due
            di fila, e il primo valore restava senza. */}
        <div className="list-sub">
          <span>{assigneeName}</span>
          {task.authority ? <span>{task.authority}</span> : null}
          {/* ⚠️ DA DOVE VIENE L'ATTIVITÀ RESTA TESTO, e non è una svista.
              `task.source` dice quale MODULO l'ha creata (Admin AI, Subsidy AI,
              una regola, una persona): non dice se il documento chiedesse quella
              cosa o se gliela stiamo proponendo noi. Dargli il filetto della
              provenienza lo farebbe leggere come «suggerimento AI-Swisse» anche
              quando l'azione era richiesta nero su bianco — una marcatura falsa
              è peggio di nessuna marcatura. Il segno vero delle azioni vive
              dove vive il dato: vedi ActionOriginMark e il dettaglio documento. */}
          <span>{t(sourceLabelKey(task.source))}</span>
          {task.documentId ? <Icon name="document" className="ic-sm" /> : null}
          {task.emailMessageId ? <Icon name="mail" className="ic-sm" /> : null}
        </div>
      </div>
      {/* ⚠️ TRE DOMANDE, TRE FAMIGLIE DI SEGNI. Fino a oggi erano tre pastiglie
          identiche — «Da fare», «media», «fra 28 giorni» — con la stessa forma
          e tre colori: a che punto è, quanto conta, entro quando si leggevano
          tutte come «un'etichetta». Ora lo stato è una casella che si riempie,
          la priorità una direzione, il termine delle cifre. */}
      <StatusMark status={task.status} />
      <PriorityMark level={task.priority} />
      {/* ⚠️ Un'attività CONCLUSA non è «in ritardo» (regola di isOverdue): la
          sua scadenza passata torna testo muto, non un segno rosso che chiede
          attenzione per un lavoro già fatto. */}
      {task.status === 'completed'
        ? <span className="muted-sm">{t(due.key, due.params)}</span>
        : <DeadlineMark date={task.dueDate} />}
    </Link>
  );
}
