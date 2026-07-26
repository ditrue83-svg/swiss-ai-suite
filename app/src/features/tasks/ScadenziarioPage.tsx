// Scadenziario — persistito nella tabella tasks (niente più localStorage).
import { useMemo, useState } from 'react';
import { taskService } from '@/services/taskService';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { formatDate, daysUntil } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import type { Task, TaskStatus } from '@/types/models';
import { useT } from '@/i18n';

type Filter = 'aperte' | 'fatte' | 'tutte';
const PRIORITY_BADGE: Record<Task['priority'], string> = { high: 'alta', medium: 'media', low: 'bassa' };

export function ScadenziarioPage() {
  const t = useT();
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;

  const { loading, error, data, reload } = useAsync<Task[]>(() => taskService.list(companyId), [companyId]);
  const [filter, setFilter] = useState<Filter>('aperte');

  const [title, setTitle] = useState('');
  const [authority, setAuthority] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  const tasks = data ?? [];
  const visible = useMemo(() => {
    return tasks.filter((t) => (filter === 'aperte' ? t.status !== 'completed' : filter === 'fatte' ? t.status === 'completed' : true));
  }, [tasks, filter]);

  async function addTask() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await taskService.create({
        companyId, userId: user!.id, title,
        // Se l'ente non è indicato resta vuoto. Prima si salvava «Inserimento
        // manuale» nel campo dell'ENTE: un dato inventato, scritto nel
        // database e in italiano anche per un'utente tedescofona. Che la
        // scadenza sia stata creata a mano lo dice già `source: 'manual'`.
        authority: authority.trim() || null,
        dueDate: dueDate || null, source: 'manual',
      });
      setTitle(''); setAuthority(''); setDueDate('');
      reload();
      showToast(t('tasks.added'));
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: TaskStatus) {
    try { await taskService.setStatus(id, status); reload(); }
    catch (e) { showToast(toUserMessage(e)); }
  }
  async function remove(id: string) {
    try { await taskService.remove(id); reload(); showToast(t('tasks.deleted')); }
    catch (e) { showToast(toUserMessage(e)); }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('tasks.title')}</div>
        <div className="page-desc">{t('tasks.subtitle')}</div>
      </div>

      {/* Le scadenze prima del modulo per aggiungerne una: chi apre questa
          pagina di solito vuole vedere cosa scade, non inserire dati. */}
      <div className="card">
        <div className="card-title">{t('tasks.listTitle')}
          <span className="filter-group">
            {([['aperte', 'tasks.filterOpen'], ['fatte', 'tasks.filterDone'], ['tutte', 'tasks.filterAll']] as const).map(([f, key]) => (
              <button key={f} className={`btn btn-sm${filter === f ? ' btn-primary' : ''}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>{t(key)}</button>
            ))}
          </span>
        </div>

        {loading && <><SkeletonLine width="60%" /><SkeletonLine width="80%" /><SkeletonLine width="70%" /></>}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && visible.length === 0 && <div className="empty">{t('tasks.noneInView')}</div>}

        {/* `task` e non `t`: qui `t` è la funzione di traduzione, e chiamare
            la scadenza allo stesso modo la copriva. */}
        {!loading && !error && visible.map((task) => {
          const d = daysUntil(task.dueDate);
          return (
            <div className="list-row" key={task.id}>
              <div className="list-main">
                <div className="list-title">{task.title}</div>
                <div className="list-sub">{task.authority ?? '—'}{task.description ? ' · ' + task.description : ''}</div>
              </div>
              {task.dueDate
                ? <span className={`badge badge-${PRIORITY_BADGE[task.priority]}`}>{formatDate(task.dueDate)}{d != null && d >= 0 ? ` · ${t('tasks.daysLeft', { n: d })}` : d != null ? ` · ${t('tasks.overdueShort')}` : ''}</span>
                : <span className="badge badge-neutral">{t('tasks.noDueDate')}</span>}
              <select className="select-inline" value={task.status} onChange={(e) => changeStatus(task.id, e.target.value as TaskStatus)} aria-label={t('tasks.statusAria', { title: task.title })}>
                <option value="open">{t('tasks.statusOpen')}</option>
                <option value="completed">{t('tasks.statusDone')}</option>
              </select>
              <button className="btn btn-sm btn-icon" onClick={() => remove(task.id)} aria-label={t('tasks.deleteAria', { title: task.title })}><Icon name="trash" className="ic-sm" /></button>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-title">{t('tasks.addManual')}</div>
        <div className="grid-3">
          <div className="field"><label htmlFor="t-title">{t('tasks.titleField')}</label><input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tasks.titlePlaceholder')} /></div>
          <div className="field"><label htmlFor="t-auth">{t('tasks.authorityField')}</label><input id="t-auth" value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder={t('tasks.authorityPlaceholder')} /></div>
          <div className="field"><label htmlFor="t-date">{t('tasks.dueDate')}</label><input id="t-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        <button className="btn btn-primary btn-sm btn-block-mobile" onClick={addTask} disabled={saving || !title.trim()} aria-busy={saving || undefined}>
          {saving ? <span className="spinner" aria-hidden="true" /> : null} {t('tasks.add')}
        </button>
      </div>
    </>
  );
}
