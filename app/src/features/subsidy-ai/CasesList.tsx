// "Le mie pratiche" — lette dalla tabella subsidy_cases (+ items), non più da localStorage.
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { subsidyService } from '@/services/subsidyService';
import { EmptyCta, ErrorState, SkeletonCard } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { ELIGIBILITY_LABEL, ELIGIBILITY_BADGE } from './engine';
import type { SubsidyCase, SubsidyCaseStatus, EligibilityStatus } from '@/types/models';

const CASE_STATUS: Record<SubsidyCaseStatus, string> = {
  draft: 'Bozza', collecting_documents: 'Documenti in raccolta', ready: 'Pronta', submitted: 'Inviata', closed: 'Chiusa',
};

function kindOf(c: SubsidyCase): string {
  const snap = c.eligibilitySnapshot as { kind?: string } | null;
  return snap?.kind ?? 'candidatura';
}
function snapshotUrl(c: SubsidyCase): string | null {
  const snap = c.eligibilitySnapshot as { officialSourceUrl?: string } | null;
  return snap?.officialSourceUrl ?? null;
}
function snapshotWindow(c: SubsidyCase): string | null {
  const snap = c.eligibilitySnapshot as { applicationWindow?: string } | null;
  return snap?.applicationWindow ?? null;
}

export function CasesList({ onGoResults }: { onGoResults: () => void }) {
  const { activeCompanyId } = useCompany();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;
  const { loading, error, data, reload, setData } = useAsync<SubsidyCase[]>(() => subsidyService.listCases(companyId), [companyId]);

  const cases = data ?? [];

  async function changeStatus(id: string, status: SubsidyCaseStatus) {
    try { await subsidyService.setCaseStatus(id, status); setData((prev) => (prev ?? []).map((c) => (c.id === id ? { ...c, status } : c))); }
    catch (e) { showToast(toUserMessage(e)); }
  }
  async function toggleItem(caseId: string, itemId: string, completed: boolean) {
    try {
      await subsidyService.setItemCompleted(itemId, completed);
      setData((prev) => (prev ?? []).map((c) => c.id === caseId ? { ...c, items: (c.items ?? []).map((it) => it.id === itemId ? { ...it, completed } : it) } : c));
    } catch (e) { showToast(toUserMessage(e)); }
  }
  async function remove(id: string) {
    try { await subsidyService.removeCase(id); reload(); showToast('Pratica eliminata'); }
    catch (e) { showToast(toUserMessage(e)); }
  }

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (cases.length === 0) {
    return (
      <div className="card">
        <EmptyCta
          icon="document"
          title="Nessuna pratica ancora"
          subtitle="Verifica l'idoneità di un incentivo e, con esito positivo, crea la relativa pratica per raccogliere documenti e checklist."
          action={<button className="btn btn-primary" onClick={onGoResults}><Icon name="banknote" className="ic-sm" /> Vai agli incentivi</button>}
        />
      </div>
    );
  }

  return (
    <>
      {cases.map((c) => {
        const items = c.items ?? [];
        const done = items.filter((i) => i.completed).length;
        const pct = items.length ? Math.round((done / items.length) * 100) : 0;
        const kind = kindOf(c);
        const elig = c.eligibilityStatusAtCreation as EligibilityStatus | null;
        const win = snapshotWindow(c);
        const url = snapshotUrl(c);
        return (
          <div className="card" key={c.id}>
            <div className="pratica-head">
              <div><div className="list-title">{c.programName}</div><div className="list-sub">{c.authority}</div></div>
              <div className="row-wrap">
                <select className="select-inline" value={c.status} onChange={(e) => changeStatus(c.id, e.target.value as SubsidyCaseStatus)} aria-label="Stato pratica">
                  {(Object.keys(CASE_STATUS) as SubsidyCaseStatus[]).map((k) => <option key={k} value={k}>{CASE_STATUS[k]}</option>)}
                </select>
                <button className="btn btn-sm btn-icon" onClick={() => remove(c.id)} aria-label="Elimina pratica"><Icon name="trash" className="ic-sm" /></button>
              </div>
            </div>
            <div className="badge-row mt-10">
              {kind === 'preliminare' ? <span className="badge badge-media">Pratica preliminare</span>
                : kind === 'riferimento' ? <span className="badge badge-neutral">Salvata per riferimento</span>
                : <span className="badge badge-bassa">Candidatura</span>}
              {elig && <span className={`badge badge-${ELIGIBILITY_BADGE[elig] ?? 'neutral'}`}>Idoneità: {ELIGIBILITY_LABEL[elig] ?? elig}</span>}
              <span className="muted-sm">Creata il {formatDate(c.createdAt)}{c.sourceLastCheckedAt ? ' · fonte del ' + c.sourceLastCheckedAt : ''}</span>
            </div>
            <div className="ax-progress mt-12"><span className="pg-label">Documenti {done}/{items.length}</span>
              <div className="meter-track" style={{ flex: 1 }}><div className="meter-fill" style={{ width: `${pct}%` }} /></div></div>
            <div>
              {items.map((it) => (
                <label className="action-item" style={{ padding: '8px 0' }} key={it.id}>
                  <input type="checkbox" checked={it.completed} onChange={(e) => toggleItem(c.id, it.id, e.target.checked)} />
                  <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400, ...(it.completed ? { textDecoration: 'line-through', color: 'var(--muted)' } : {}) }}>{it.title}</span></span>
                </label>
              ))}
            </div>
            <div className="muted-sm mt-10">{win ? `Finestra: ${win} · ` : ''}{url && <a href={url} target="_blank" rel="noreferrer">fonte ufficiale</a>}</div>
          </div>
        );
      })}
    </>
  );
}
