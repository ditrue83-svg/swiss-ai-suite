// Archivio — legge la tabella documents; apertura analisi, download via signed URL,
// eliminazione file (Storage) + record (DB) con conferma.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { documentService } from '@/services/documentService';
import { analysisService } from '@/services/analysisService';
import { ErrorState, EmptyCta, SkeletonLine } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import type { DocumentAnalysis, DocumentRecord } from '@/types/models';

type Filter = 'tutte' | 'alta' | 'media' | 'bassa';
interface Row { doc: DocumentRecord; analysis: DocumentAnalysis | null }

export function ArchivePage() {
  const t = useT();
  const L = useLabels();
  const { activeCompanyId } = useCompany();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const companyId = activeCompanyId as string;

  const { loading, error, data, reload } = useAsync<Row[]>(async () => {
    const [docs, analyses] = await Promise.all([
      documentService.list(companyId),
      analysisService.listForCompany(companyId),
    ]);
    const byDoc = new Map(analyses.map((a) => [a.documentId, a]));
    return docs.map((doc) => ({ doc, analysis: byDoc.get(doc.id) ?? null }));
  }, [companyId]);

  const [filter, setFilter] = useState<Filter>('tutte');
  const [armed, setArmed] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = data ?? [];
  const visible = useMemo(
    () => rows.filter((r) => filter === 'tutte' || r.analysis?.urgency === filter),
    [rows, filter],
  );

  async function openFile(doc: DocumentRecord) {
    if (!doc.storagePath) { showToast(t('archive.fileUnavailable')); return; }
    setBusyId(doc.id);
    try {
      const url = await documentService.getSignedUrl(doc.storagePath, 120);
      window.open(url, '_blank', 'noopener');
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setBusyId(null); }
  }

  async function remove(doc: DocumentRecord) {
    setBusyId(doc.id);
    try {
      await documentService.remove(doc);
      setArmed(null);
      reload();
      showToast(t('archive.deleted'));
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setBusyId(null); }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('archive.title')}</div>
        <div className="page-desc">{t('archive.subtitle')}</div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>{t('archive.count', { n: visible.length })}</span>
          <span className="filter-group">
            {/* I filtri mostravano il valore grezzo della colonna — «tutte»,
                «alta» — che è italiano anche in tedesco. Il valore resta la
                chiave, l'etichetta passa dalle traduzioni. */}
            {(['tutte', 'alta', 'media', 'bassa'] as Filter[]).map((f) => (
              <button key={f} className={`btn btn-sm${filter === f ? ' btn-primary' : ''}`} onClick={() => { setFilter(f); setArmed(null); }} aria-pressed={filter === f}>
                {f === 'tutte' ? t('archive.filterAll') : L.urgency(f)}
              </button>
            ))}
          </span>
        </div>

        {loading && <><SkeletonLine width="70%" /><SkeletonLine width="85%" /><SkeletonLine width="60%" /></>}
        {error && <ErrorState message={error} onRetry={reload} />}

        {!loading && !error && rows.length === 0 && (
          <EmptyCta
            icon="document"
            title={t('archive.empty')}
            subtitle={t('archive.emptySub')}
            action={<button className="btn btn-primary" onClick={() => navigate('/admin')}><Icon name="document" className="ic-sm" /> {t('archive.emptyCta')}</button>}
          />
        )}
        {!loading && !error && rows.length > 0 && visible.length === 0 && <div className="empty">{t('archive.noneWithFilter')}</div>}

        {!loading && !error && visible.map(({ doc, analysis }) => {
          const done = analysis ? analysis.actions.filter((c) => c.done).length : 0;
          const total = analysis ? analysis.actions.length : 0;
          // §25 — un'analisi fallita non va descritta come un documento analizzato:
          // niente mittente/tipo/scadenza (sarebbero valori di default, non estratti).
          const failed = analysis?.analysisStatus === 'failed';
          const urgency = failed ? undefined : analysis?.urgency;
          const subParts = failed
            ? [analysis?.errorMessageSafe ?? t('archive.analysisFailedSub')]
            : [
                analysis?.sender ?? undefined,
                analysis?.documentTypeLabel,
                analysis?.languageLabel,
                analysis?.deadline ? t('tasks.dueOn', { date: formatDate(analysis.deadline) }) : undefined,
              ].filter(Boolean);
          return (
            <div className="list-row" key={doc.id}>
              <div className="list-main">
                <div className="list-title">{doc.title}</div>
                <div className="list-sub">{subParts.join(' · ') || t('archive.processing')}</div>
              </div>
              {failed && <span className="badge badge-alta">{t('archive.analysisFailed')}</span>}
              {!failed && analysis?.analysisStatus === 'needs_review' && <span className="badge badge-media">{t('archive.needsReview')}</span>}
              {analysis && !failed && <span className="badge badge-neutral">{t('archive.actionsProgress', { done, total })}</span>}
              {urgency && <span className={`badge badge-${urgency}`}>{L.urgency(urgency)}</span>}
              <button className="btn btn-sm" onClick={() => navigate(`/admin?doc=${doc.id}`)}>{t('common.open')}</button>
              {doc.storagePath && (
                <button className="btn btn-sm btn-icon" onClick={() => openFile(doc)} disabled={busyId === doc.id} aria-label={t('archive.openFileAria', { title: doc.title })}><Icon name="download" className="ic-sm" /></button>
              )}
              {armed === doc.id ? (
                <span className="row-wrap">
                  <button className="btn btn-sm btn-danger" onClick={() => remove(doc)} disabled={busyId === doc.id}>{busyId === doc.id ? <span className="spinner" /> : null} {t('common.delete')}</button>
                  <button className="btn btn-sm" onClick={() => setArmed(null)}>{t('common.cancel')}</button>
                </span>
              ) : (
                <button className="btn btn-sm btn-icon" onClick={() => setArmed(doc.id)} aria-label={t('archive.deleteAria', { title: doc.title })}><Icon name="trash" className="ic-sm" /></button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
