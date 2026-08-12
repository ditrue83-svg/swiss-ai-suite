// ============================================================================
// Dettaglio di un'attività: dove il lavoro si organizza e si chiude.
//
// Pagina intera e non finestra modale: da telefono una modale con dentro
// checklist, commenti e storico diventa una pagina in miniatura con lo scroll
// dentro lo scroll, e l'indirizzo di un'attività dev'essere condivisibile —
// «guarda questa» è la cosa che si fa più spesso in un'azienda.
//
// I campi si salvano quando cambiano, senza una modalità «modifica»: un
// responsabile o una scadenza si cambiano in un gesto solo, e un pulsante
// Salva in più sarebbe un passaggio in più per ogni correzione.
// ============================================================================
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { taskService } from '@/services/taskService';
import { taskChecklistService } from '@/services/taskChecklistService';
import { taskCommentService, taskEventService } from '@/services/taskCommentService';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { useMembers } from './useMembers';
import { dueLabel, eventLabelKey, sourceLabelKey, statusLabelKey } from './taskFormat';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import type { Task, TaskChecklistItem, TaskPriority, TaskStatus } from '@/types/models';

export function TaskDetailPage() {
  const t = useT();
  const L = useLabels();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;
  const { members, byId } = useMembers();

  const { loading, error, data, reload, setData } = useAsync(async () => {
    const task = await taskService.get(id);
    // Un'attività di un'altra azienda non deve restare visibile dopo un cambio
    // di azienda: la RLS non la restituirebbe, ma il controllo esplicito rende
    // il caso leggibile invece di mostrare una pagina vuota.
    if (!task || task.companyId !== companyId) return null;
    const [checklist, comments, events] = await Promise.all([
      taskChecklistService.list(id),
      taskCommentService.list(id),
      taskEventService.list(id),
    ]);
    return { task, checklist, comments, events };
  }, [id, companyId]);

  const [newItem, setNewItem] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  /** Il responsabile di un'attività: senza, «Non assegnata». */
  function name(userId: string | null): string {
    if (!userId) return t('tasks.unassigned');
    const m = byId.get(userId);
    if (!m) return t('tasks.eventUnknownActor');
    return m.name || t('tasks.unnamedMember');
  }

  /**
   * Chi ha COMPIUTO un'azione. Formula diversa da quella del responsabile, e
   * non è pedanteria: con `name()` lo storico diceva «Non assegnata ha creato
   * l'attività» per gli eventi senza attore — quelli nati da un processo
   * automatico o da uno script. Un'azione senza autore noto è di «Qualcuno»,
   * non di nessuno. Trovato provando la pagina, non leggendo il codice.
   */
  function actor(userId: string | null): string {
    if (!userId) return t('tasks.eventUnknownActor');
    const m = byId.get(userId);
    if (!m) return t('tasks.eventUnknownActor');
    return m.name || t('tasks.unnamedMember');
  }

  async function patch(change: Parameters<typeof taskService.update>[1]) {
    if (!data) return;
    setBusy(true);
    try {
      const updated = await taskService.update(data.task.id, change);
      setData({ ...data, task: updated });
      await refreshEvents(data.task.id);
      showToast(t('tasks.saved'));
    } catch (e) {
      showToast(toUserMessage(e));
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function addChecklistItem() {
    if (!data || !newItem.trim()) return;
    try {
      const item = await taskChecklistService.add({
        companyId, taskId: data.task.id, text: newItem, position: data.checklist.length,
      });
      setData({ ...data, checklist: [...data.checklist, item] });
      setNewItem('');
    } catch (e) { showToast(toUserMessage(e)); }
  }

  /**
   * Rilegge lo storico dal database.
   *
   * Serve dopo ogni azione che genera un evento — spuntare un passaggio,
   * commentare — perché quegli eventi li scrivono i TRIGGER: la schermata non
   * sa cosa è stato registrato, e indovinarlo significherebbe raccontare una
   * storia parallela a quella vera. Senza questa rilettura «Attività recente»
   * restava ferma alla creazione mentre nel database c'erano già tre eventi.
   */
  async function refreshEvents(taskId: string) {
    try {
      const events = await taskEventService.list(taskId);
      setData((prev) => (prev ? { ...prev, events } : prev));
    } catch { /* lo storico è un di più: se non si rilegge, il resto vale comunque */ }
  }

  async function toggleItem(item: TaskChecklistItem, done: boolean) {
    if (!data) return;
    try {
      const saved = await taskChecklistService.setDone(item.id, done);
      setData({ ...data, checklist: data.checklist.map((c) => (c.id === saved.id ? saved : c)) });
      if (done) await refreshEvents(data.task.id);
    } catch (e) { showToast(toUserMessage(e)); reload(); }
  }

  async function removeItem(item: TaskChecklistItem) {
    if (!data) return;
    try {
      await taskChecklistService.remove(item.id);
      setData({ ...data, checklist: data.checklist.filter((c) => c.id !== item.id) });
    } catch (e) { showToast(toUserMessage(e)); }
  }

  async function moveItem(index: number, delta: number) {
    if (!data) return;
    const other = index + delta;
    if (other < 0 || other >= data.checklist.length) return;
    const a = data.checklist[index], b = data.checklist[other];
    try {
      await taskChecklistService.swapPositions(a, b);
      const next = [...data.checklist];
      next[index] = b; next[other] = a;
      setData({ ...data, checklist: next });
    } catch (e) { showToast(toUserMessage(e)); reload(); }
  }

  async function addComment() {
    if (!data || !comment.trim()) return;
    try {
      const saved = await taskCommentService.add({
        companyId, taskId: data.task.id, authorUserId: user!.id, body: comment,
      });
      setData({ ...data, comments: [saved, ...data.comments] });
      setComment('');
      await refreshEvents(data.task.id);
    } catch (e) { showToast(toUserMessage(e)); }
  }

  async function archive() {
    if (!data) return;
    // Conferma esplicita con il titolo dentro: «Sei sicuro?» non dice cosa
    // sparisce, e un clic sbagliato su una lista fa danni silenziosi.
    if (!window.confirm(t('tasks.archiveConfirm', { title: data.task.title }))) return;
    try {
      await taskService.archive(data.task.id);
      showToast(t('tasks.archived'));
      navigate('/attivita');
    } catch (e) { showToast(toUserMessage(e)); }
  }

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) {
    return (
      <div className="card">
        <div className="empty">{t('tasks.notFound')}</div>
        <Link className="btn btn-sm" to="/attivita">{t('tasks.backToList')}</Link>
      </div>
    );
  }

  const { task, checklist, comments, events } = data;
  const due = dueLabel(task.dueDate);
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <>
      <div className="page-head">
        <Link className="btn btn-sm btn-ghost" to="/attivita">
          <Icon name="arrowLeft" className="ic-sm" /> {t('tasks.backToList')}
        </Link>
        <div className="page-title mt-10">{task.title}</div>
        <div className="page-desc">
          {t(sourceLabelKey(task.source))}
          {task.authority ? ` · ${task.authority}` : ''}
          {task.archivedAt ? ` · ${t('tasks.viewArchived')}` : ''}
        </div>
      </div>

      <div className="grid-2">
        {/* ---- Proprietà ---- */}
        <div className="card">
          <div className="card-title">{t('tasks.hubTitle')}</div>

          <div className="field">
            <label htmlFor="d-status">{t('tasks.status')}</label>
            <select id="d-status" value={task.status} disabled={busy}
              onChange={(e) => void patch({ status: e.target.value as TaskStatus })}>
              <option value="open">{t('tasks.statusOpen')}</option>
              <option value="in_progress">{t('tasks.statusInProgress')}</option>
              <option value="waiting">{t('tasks.statusWaiting')}</option>
              <option value="completed">{t('tasks.statusCompleted')}</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="d-assignee">{t('tasks.assignee')}</label>
            <select id="d-assignee" value={task.assigneeUserId ?? ''} disabled={busy}
              onChange={(e) => void patch({ assigneeUserId: e.target.value || null })}>
              <option value="">{t('tasks.unassigned')}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name || t('tasks.unnamedMember')}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="d-prio">{t('tasks.priorityLabel')}</label>
            <select id="d-prio" value={task.priority} disabled={busy}
              onChange={(e) => void patch({ priority: e.target.value as TaskPriority })}>
              <option value="high">{L.urgency('alta')}</option>
              <option value="medium">{L.urgency('media')}</option>
              <option value="low">{L.urgency('bassa')}</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="d-due">{t('tasks.dueLabel')}</label>
            <input id="d-due" type="date" value={task.dueDate ?? ''} disabled={busy}
              onChange={(e) => void patch({ dueDate: e.target.value || null })} />
            {/* La lettura del termine, nella grammatica della sua famiglia; per
                una conclusa resta testo muto (vedi isOverdue). */}
            <div className="mt-10">
              {task.status === 'completed'
                ? <span className="muted-sm">{t(due.key, due.params)}</span>
                : <DeadlineMark date={task.dueDate} />}
            </div>
          </div>

          {task.completedAt && (
            <div className="muted-sm">
              {t('tasks.statusCompleted')} · {formatDate(task.completedAt)} · {name(task.completedBy)}
            </div>
          )}

          <div className="row-wrap mt-16">
            {task.archivedAt ? (
              <button className="btn btn-sm" onClick={() => void taskService.restore(task.id).then(() => { showToast(t('tasks.restored')); reload(); })}>
                {t('tasks.restore')}
              </button>
            ) : (
              <button className="btn btn-sm" onClick={() => void archive()}>
                <Icon name="archive" className="ic-sm" /> {t('tasks.archive')}
              </button>
            )}
          </div>
        </div>

        {/* ---- Collegamenti: da dove nasce e cosa tocca ---- */}
        <div className="card">
          <div className="card-title">{t('tasks.links')}</div>
          {!task.documentId && !task.subsidyCaseId && (
            <div className="muted-sm">{t('tasks.linksEmpty')}</div>
          )}
          {task.documentId && (
            <div className="list-row">
              <div className="list-main">
                <div className="list-title">{t('tasks.linkedDocument')}</div>
              </div>
              <Link className="btn btn-sm" to={`/admin?doc=${task.documentId}`}>{t('tasks.openDocument')}</Link>
            </div>
          )}
          {task.subsidyCaseId && (
            <div className="list-row">
              <div className="list-main">
                <div className="list-title">{t('tasks.linkedCase')}</div>
              </div>
              {/* Subsidy AI non ha un indirizzo per la singola pratica: si apre
                  la sezione, che è quanto il prodotto consente oggi. */}
              <Link className="btn btn-sm" to="/subsidy">{t('tasks.openCase')}</Link>
            </div>
          )}
        </div>
      </div>

      {/* ---- Descrizione ---- */}
      <div className="card mt-16">
        <div className="card-title">{t('tasks.description')}</div>
        {/* Dentro `.field`: lo stile di input e textarea del design system è
            legato a quella classe, e senza il campo resta con lo sfondo bianco
            del browser — in tema scuro, testo chiaro su fondo bianco. */}
        <div className="field m-0">
          <textarea rows={3} defaultValue={task.description ?? ''} disabled={busy}
            aria-label={t('tasks.description')}
            onBlur={(e) => {
              const next = e.target.value.trim() || null;
              if (next !== (task.description ?? null)) void patch({ description: next });
            }} />
        </div>
      </div>

      {/* ---- Checklist ---- */}
      <div className="card mt-16">
        <div className="card-title">
          {t('tasks.checklist')}
          {checklist.length > 0 && (
            <span className="muted-sm">{t('tasks.checklistDone', { done: doneCount, total: checklist.length })}</span>
          )}
        </div>

        {checklist.length === 0 && <div className="muted-sm">{t('tasks.checklistEmpty')}</div>}

        {checklist.map((item, i) => (
          <div className="list-row" key={item.id}>
            <label className="list-main task-check gap-2" style={{ display: 'flex', alignItems: 'center' }}>
              <input type="checkbox" checked={item.done} onChange={(e) => void toggleItem(item, e.target.checked)} />
              <span className={item.done ? 'muted-sm' : ''}>{item.text}</span>
            </label>
            <button className="btn btn-sm btn-icon" onClick={() => void moveItem(i, -1)} disabled={i === 0}
              aria-label={t('tasks.checklistMoveUp')}><Icon name="arrowUp" className="ic-sm" /></button>
            <button className="btn btn-sm btn-icon" onClick={() => void moveItem(i, 1)} disabled={i === checklist.length - 1}
              aria-label={t('tasks.checklistMoveDown')}><Icon name="arrowDown" className="ic-sm" /></button>
            <button className="btn btn-sm btn-icon" onClick={() => void removeItem(item)}
              aria-label={t('tasks.checklistRemove')}><Icon name="trash" className="ic-sm" /></button>
          </div>
        ))}

        <div className="row-wrap mt-10">
          <div className="field m-0" style={{ flex: 1, minWidth: 200 }}>
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addChecklistItem(); } }}
              placeholder={t('tasks.checklistAdd')} aria-label={t('tasks.checklistAdd')} />
          </div>
          <button className="btn btn-sm" onClick={() => void addChecklistItem()} disabled={!newItem.trim()}>
            {t('tasks.add')}
          </button>
        </div>
      </div>

      {/* ---- Commenti ---- */}
      <div className="card mt-16">
        <div className="card-title">{t('tasks.comments')}</div>
        <div className="row-wrap">
          <div className="field m-0" style={{ flex: 1, minWidth: 220 }}>
            <input value={comment} onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addComment(); } }}
              placeholder={t('tasks.commentPlaceholder')} aria-label={t('tasks.commentPlaceholder')} />
          </div>
          <button className="btn btn-sm" onClick={() => void addComment()} disabled={!comment.trim()}>
            {t('tasks.commentSend')}
          </button>
        </div>

        {comments.length === 0 && <div className="muted-sm mt-10">{t('tasks.commentsEmpty')}</div>}
        {comments.map((c) => (
          <div className="list-row" key={c.id}>
            <div className="list-main">
              <div className="list-sub">{actor(c.authorUserId)} · {formatDate(c.createdAt)}</div>
              {/* Testo, mai markup: il corpo non viene interpretato. */}
              <div className="list-title" style={{ fontWeight: 400, whiteSpace: 'pre-wrap' }}>{c.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Storico ---- */}
      <div className="card mt-16">
        <div className="card-title">{t('tasks.history')}</div>
        {events.length === 0 && <div className="muted-sm">{t('tasks.historyEmpty')}</div>}
        {events.map((ev) => (
          <div className="list-row" key={ev.id}>
            <div className="list-main">
              <div className="list-sub">
                {actor(ev.actorUserId)} {t(eventLabelKey(ev.kind))} · {formatDate(ev.createdAt)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Riesportato per i test: la pagina non espone altro. */
export type { Task };
