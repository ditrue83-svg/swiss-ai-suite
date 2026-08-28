// "Le mie pratiche" — lette dalla tabella subsidy_cases (+ items), non più da localStorage.
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { EligibilityMark } from '@/components/ui/EligibilityMark';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { subsidyService } from '@/services/subsidyService';
import { EmptyCta, ErrorState, SkeletonCard } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { useT, type TKey } from '@/i18n';
import type { SubsidyCase, SubsidyCaseStatus, EligibilityStatus } from '@/types/models';
import styles from './subsidy-ai.module.css';

// Solo l'ELENCO degli stati: l'etichetta la dà il dizionario, perché queste
// cinque parole comparivano in italiano anche in tedesco e in francese.
const CASE_STATUSES: SubsidyCaseStatus[] = ['draft', 'collecting_documents', 'ready', 'submitted', 'closed'];

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
  const t = useT();
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
    try { await subsidyService.removeCase(id); reload(); showToast(t('subsidy.cases.caseDeleted')); }
    catch (e) { showToast(toUserMessage(e)); }
  }

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (cases.length === 0) {
    return (
      <div className="card">
        <EmptyCta
          icon="document"
          title={t('subsidy.cases.casesEmpty')}
          subtitle={t('subsidy.cases.casesEmptySub')}
          action={<button className="btn btn-primary" onClick={onGoResults}><Icon name="banknote" className="ic-sm" /> {t('subsidy.cases.goToSubsidies')}</button>}
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
            <div className={styles.praticaHead}>
              <div><div className="list-title">{c.programName}</div><div className="list-sub">{c.authority}</div></div>
              <div className="row-wrap">
                <select className="select-inline" value={c.status} onChange={(e) => changeStatus(c.id, e.target.value as SubsidyCaseStatus)} aria-label={t('subsidy.cases.caseStatusAria')}>
                  {CASE_STATUSES.map((k) => <option key={k} value={k}>{t(`subsidy.cases.statuses.${k}` as TKey)}</option>)}
                </select>
                <button className="btn btn-sm btn-icon" onClick={() => remove(c.id)} aria-label={t('subsidy.cases.deleteCase')}><Icon name="trash" className="ic-sm" /></button>
              </div>
            </div>
            <div className="badge-row mt-10">
              {/* ⚠️ Il TIPO di pratica è una categoria, e ne compare uno solo
                  per riga: distinguerli col colore non serviva a nulla, e li
                  metteva sulla scala degli allarmi — «candidatura» in verde,
                  «preliminare» in ambra — come se una fosse un esito buono e
                  l'altra un problema. La parola basta, ed è già lì. */}
              {kind === 'preliminare' ? <Tag>{t('subsidy.cases.kindPreliminary')}</Tag>
                : kind === 'riferimento' ? <Tag>{t('subsidy.cases.savedForReference')}</Tag>
                : <Tag>{t('subsidy.cases.kindApplication')}</Tag>}
              {/* L'idoneità registrata alla creazione della pratica: il segno
                  della sua famiglia, non la pastiglia negli allarmi. */}
              {elig && <span className={styles.markField}>{t('subsidy.cases.eligibility')} <EligibilityMark status={elig} /></span>}
              <span className="muted-sm">{t('subsidy.cases.createdOn', { date: formatDate(c.createdAt) })}{c.sourceLastCheckedAt ? ` · ${t('subsidy.cases.sourceOf', { date: c.sourceLastCheckedAt })}` : ''}</span>
            </div>
            <div className="ax-progress mt-12"><span className="pg-label">{t('subsidy.cases.documentsProgress', { done, total: items.length })}</span>
              <div className="meter-track" style={{ flex: 1 }}><div className="meter-fill" style={{ width: `${pct}%` }} /></div></div>
            <div>
              {items.map((it) => (
                <label className="action-item py-2" key={it.id}>
                  <input type="checkbox" checked={it.completed} onChange={(e) => toggleItem(c.id, it.id, e.target.checked)} />
                  <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400, ...(it.completed ? { textDecoration: 'line-through', color: 'var(--muted)' } : {}) }}>{it.title}</span></span>
                </label>
              ))}
            </div>
            <div className="muted-sm mt-10">{win ? `${t('subsidy.cases.windowLabel', { window: win })} · ` : ''}{url && <a href={url} target="_blank" rel="noreferrer">{t('subsidy.cases.officialSource')}</a>}</div>
          </div>
        );
      })}
    </>
  );
}
