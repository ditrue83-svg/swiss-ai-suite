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

type Filter = 'aperte' | 'fatte' | 'tutte';
const PRIORITY_BADGE: Record<Task['priority'], string> = { high: 'alta', medium: 'media', low: 'bassa' };

export function ScadenziarioPage() {
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
        authority: authority.trim() || 'Inserimento manuale',
        dueDate: dueDate || null, source: 'manual',
      });
      setTitle(''); setAuthority(''); setDueDate('');
      reload();
      showToast('Scadenza aggiunta allo scadenziario');
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
    try { await taskService.remove(id); reload(); showToast('Scadenza eliminata'); }
    catch (e) { showToast(toUserMessage(e)); }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">Scadenziario</div>
        <div className="page-desc">Tutte le scadenze create dalle analisi dei documenti e dagli incentivi, con promemoria di urgenza.</div>
      </div>

      <div className="card">
        <div className="card-title">Aggiungi scadenza manuale</div>
        <div className="grid-3">
          <div className="field"><label htmlFor="t-title">Titolo</label><input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Inviare conteggio AVS" /></div>
          <div className="field"><label htmlFor="t-auth">Ente / riferimento</label><input id="t-auth" value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder="Es. Cassa di compensazione" /></div>
          <div className="field"><label htmlFor="t-date">Data di scadenza</label><input id="t-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        <button className="btn btn-primary btn-sm btn-block-mobile" onClick={addTask} disabled={saving || !title.trim()} aria-busy={saving || undefined}>
          {saving ? <span className="spinner" aria-hidden="true" /> : null} Aggiungi
        </button>
      </div>

      <div className="card">
        <div className="card-title">Scadenze
          <span className="filter-group">
            {(['aperte', 'fatte', 'tutte'] as Filter[]).map((f) => (
              <button key={f} className={`btn btn-sm${filter === f ? ' btn-primary' : ''}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </span>
        </div>

        {loading && <><SkeletonLine width="60%" /><SkeletonLine width="80%" /><SkeletonLine width="70%" /></>}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && visible.length === 0 && <div className="empty">Nessuna scadenza in questa vista.</div>}

        {!loading && !error && visible.map((t) => {
          const d = daysUntil(t.dueDate);
          return (
            <div className="list-row" key={t.id}>
              <div className="list-main">
                <div className="list-title">{t.title}</div>
                <div className="list-sub">{t.authority ?? '—'}{t.description ? ' · ' + t.description : ''}</div>
              </div>
              {t.dueDate
                ? <span className={`badge badge-${PRIORITY_BADGE[t.priority]}`}>{formatDate(t.dueDate)}{d != null && d >= 0 ? ` · ${d} gg` : d != null ? ' · scaduta' : ''}</span>
                : <span className="badge badge-neutral">senza data</span>}
              <select className="select-inline" value={t.status} onChange={(e) => changeStatus(t.id, e.target.value as TaskStatus)} aria-label={`Stato di: ${t.title}`}>
                <option value="open">Da fare</option>
                <option value="completed">Fatto</option>
              </select>
              <button className="btn btn-sm btn-icon" onClick={() => remove(t.id)} aria-label={`Elimina scadenza: ${t.title}`}><Icon name="trash" className="ic-sm" /></button>
            </div>
          );
        })}
      </div>
    </>
  );
}
