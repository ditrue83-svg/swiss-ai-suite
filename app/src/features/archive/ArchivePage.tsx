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
import type { DocumentAnalysis, DocumentRecord } from '@/types/models';

type Filter = 'tutte' | 'alta' | 'media' | 'bassa';
interface Row { doc: DocumentRecord; analysis: DocumentAnalysis | null }

export function ArchivePage() {
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
    if (!doc.storagePath) { showToast('File non disponibile.'); return; }
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
      showToast('Documento eliminato');
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setBusyId(null); }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">Archivio documenti</div>
        <div className="page-desc">Tutti i documenti caricati, con filtri per urgenza e stato della checklist.</div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Documenti ({visible.length})</span>
          <span className="filter-group">
            {(['tutte', 'alta', 'media', 'bassa'] as Filter[]).map((f) => (
              <button key={f} className={`btn btn-sm${filter === f ? ' btn-primary' : ''}`} onClick={() => { setFilter(f); setArmed(null); }}>{f}</button>
            ))}
          </span>
        </div>

        {loading && <><SkeletonLine width="70%" /><SkeletonLine width="85%" /><SkeletonLine width="60%" /></>}
        {error && <ErrorState message={error} onRetry={reload} />}

        {!loading && !error && rows.length === 0 && (
          <EmptyCta
            icon="document"
            title="Nessun documento ancora"
            subtitle="Carica la tua prima comunicazione amministrativa e lascia che Admin AI la trasformi in azioni concrete."
            action={<button className="btn btn-primary" onClick={() => navigate('/admin')}><Icon name="document" className="ic-sm" /> Analizza un documento</button>}
          />
        )}
        {!loading && !error && rows.length > 0 && visible.length === 0 && <div className="empty">Nessun documento con questo filtro.</div>}

        {!loading && !error && visible.map(({ doc, analysis }) => {
          const done = analysis ? analysis.actions.filter((c) => c.done).length : 0;
          const total = analysis ? analysis.actions.length : 0;
          const urgency = analysis?.urgency;
          const subParts = [
            analysis?.sender ?? undefined,
            analysis?.documentTypeLabel,
            analysis?.languageLabel,
            analysis?.deadline ? 'scade il ' + formatDate(analysis.deadline) : undefined,
          ].filter(Boolean);
          return (
            <div className="list-row" key={doc.id}>
              <div className="list-main">
                <div className="list-title">{doc.title}</div>
                <div className="list-sub">{subParts.join(' · ') || 'In elaborazione'}</div>
              </div>
              {analysis && <span className="badge badge-neutral">{done}/{total} azioni</span>}
              {urgency && <span className={`badge badge-${urgency}`}>{urgency}</span>}
              <button className="btn btn-sm" onClick={() => navigate(`/admin?doc=${doc.id}`)}>Apri</button>
              {doc.storagePath && (
                <button className="btn btn-sm btn-icon" onClick={() => openFile(doc)} disabled={busyId === doc.id} aria-label={`Apri il file: ${doc.title}`}><Icon name="download" className="ic-sm" /></button>
              )}
              {armed === doc.id ? (
                <span className="row-wrap">
                  <button className="btn btn-sm btn-danger" onClick={() => remove(doc)} disabled={busyId === doc.id}>{busyId === doc.id ? <span className="spinner" /> : null} Elimina</button>
                  <button className="btn btn-sm" onClick={() => setArmed(null)}>Annulla</button>
                </span>
              ) : (
                <button className="btn btn-sm btn-icon" onClick={() => setArmed(doc.id)} aria-label={`Elimina documento: ${doc.title}`}><Icon name="trash" className="ic-sm" /></button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
