// Vista risultato analisi (porting fedele di renderResult): due colonne desktop,
// documento originale con evidenziazione, checklist, rischio, bozza modificabile.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { analysisService } from '@/services/analysisService';
import { taskService } from '@/services/taskService';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { LANG_LABEL, TONI } from '@/features/admin-ai/engine';
import type { ActionSource, ChecklistAction, DocumentAnalysis, DocumentRecord, Evidence, TaskPriority } from '@/types/models';

const DEADLINE_LEVEL_LABEL: Record<string, string> = { scaduta: 'Scaduta', urgente: 'Urgente', prossima: 'Prossima', nessuna: 'Nessuna urgenza' };
const URGENCY_TO_PRIORITY: Record<string, TaskPriority> = { alta: 'high', media: 'medium', bassa: 'low' };

function OriginBadge({ source, ctx }: { source: ActionSource; ctx?: 'callout' }) {
  if (source === 'extracted') {
    return <span className="origin-badge ob-ex"><Icon name="fileSearch" className="ic-sm" />{ctx === 'callout' ? 'Richiesto nel documento' : 'Dal documento'}</span>;
  }
  return <span className="origin-badge ob-sg">{ctx === 'callout' ? 'Suggerito da SwissAI' : 'Suggerimento SwissAI'}</span>;
}

function EvidenceButton({ evidence, label, onShow }: { evidence: Evidence | null; label?: string; onShow: (ev: Evidence) => void }) {
  const [open, setOpen] = useState(false);
  if (!evidence) return null;
  return (
    <>
      <button type="button" className="ev-btn" onClick={() => { setOpen((o) => !o); onShow(evidence); }}>
        <Icon name="fileSearch" className="ic-sm" />{label ?? 'Mostra nel documento'}
      </button>
      <div className={`ev-quote${open ? ' show' : ''}`}>«{evidence.quote}»</div>
    </>
  );
}

function DocViewer({ text, highlight }: { text: string | null | undefined; highlight: Evidence | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight && ref.current) {
      const mark = ref.current.querySelector('.ev-hl');
      if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight]);

  if (!text) {
    return <div className="ax-doc-view"><span className="muted-sm">Testo originale non disponibile per l’evidenziazione. Le citazioni «…» restano visibili qui accanto.</span></div>;
  }
  let content: React.ReactNode = text;
  if (highlight && highlight.start >= 0 && highlight.end > highlight.start && highlight.end <= text.length) {
    content = (
      <>
        {text.slice(0, highlight.start)}
        <mark className="ev-hl">{text.slice(highlight.start, highlight.end)}</mark>
        {text.slice(highlight.end)}
      </>
    );
  }
  return <div className="ax-doc-view" ref={ref}>{content}</div>;
}

export function ResultView({ analysis, document }: { analysis: DocumentAnalysis; document: DocumentRecord }) {
  const { activeCompany } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyName = activeCompany?.legalName ?? null;

  const [actions, setActions] = useState<ChecklistAction[]>(analysis.actions);
  const [highlight, setHighlight] = useState<Evidence | null>(null);
  const [draft, setDraft] = useState(analysis.replyDraft);
  const [lang, setLang] = useState(String(analysis.replyLanguage));
  const [tone, setTone] = useState(analysis.replyTone);
  const [savingDraft, setSavingDraft] = useState(false);

  // Se cambia il documento analizzato, reinizializza lo stato locale.
  useEffect(() => {
    setActions(analysis.actions);
    setDraft(analysis.replyDraft);
    setLang(String(analysis.replyLanguage));
    setTone(analysis.replyTone);
    setHighlight(null);
  }, [analysis.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = actions.filter((c) => c.done).length;
  const tot = actions.length;
  const pct = tot ? Math.round((done / tot) * 100) : 0;
  const r = analysis;
  const lvl = r.deadlineLevel || 'none';
  const days = r.daysToDeadline;
  const remaining = days == null ? '' : days < 0 ? `Scaduta da ${Math.abs(days)} giorni` : days === 0 ? 'Scade oggi' : `Mancano ${days} giorni`;

  async function toggleAction(id: number, checked: boolean) {
    const next = actions.map((c) => (c.id === id ? { ...c, done: checked } : c));
    setActions(next);
    try { await analysisService.updateActions(r.id, next); }
    catch (e) { showToast(toUserMessage(e)); }
  }

  async function createTask(title: string) {
    try {
      await taskService.create({
        companyId: r.companyId, userId: user!.id, title,
        authority: r.sender, dueDate: r.deadline, priority: URGENCY_TO_PRIORITY[r.urgency] ?? 'medium',
        source: 'admin_ai', documentId: document.id,
      });
      showToast('Scadenza aggiunta allo scadenziario');
    } catch (e) { showToast(toUserMessage(e)); }
  }

  async function saveDraft() {
    setSavingDraft(true);
    try { await analysisService.updateReplyDraft(r.id, { draft, language: lang, tone }); showToast('Modifiche salvate'); }
    catch (e) { showToast(toUserMessage(e)); }
    finally { setSavingDraft(false); }
  }
  function resetDraft() {
    const next = analysisService.regenerateReply(r, lang, tone, companyName);
    setDraft(next);
    void analysisService.updateReplyDraft(r.id, { draft: next, language: lang, tone }).catch(() => {});
    showToast('Bozza rigenerata');
  }
  function copyDraft() {
    navigator.clipboard?.writeText(draft);
    showToast('Bozza copiata negli appunti');
  }

  return (
    <div>
      <div className="card ax-header">
        <div className="ax-head-top">
          <div className="ax-title">{document.title}</div>
          <div className="ax-badges">
            <span className={`badge badge-${r.urgency}`}>urgenza {r.urgency}</span>
            <span className="badge badge-neutral">confidenza {r.confidence}</span>
          </div>
        </div>
        <div className="ax-meta">
          <span className="ax-chip"><Icon name="banknote" className="ic-sm" /> <b>{r.sender ?? 'Ente non identificato'}</b>{r.senderUncertain ? ' · da verificare' : ''}</span>
          <span className="ax-chip"><Icon name="document" className="ic-sm" /> {r.documentTypeLabel}</span>
          <span className="ax-chip">{r.languageLabel}</span>
          {r.amountDisplay && <span className="ax-chip">{r.amountDisplay}</span>}
          <span className="ax-chip" title={`Motore di analisi: ${r.engine}`}>
            <Icon name={r.engine.startsWith('claude') ? 'star' : 'fileSearch'} className="ic-sm" />
            {r.engine.startsWith('claude') ? 'Analisi AI' : 'Motore locale'}
          </span>
        </div>
        {r.senderEvidence && <div><EvidenceButton evidence={r.senderEvidence} label="Mittente: mostra nel documento" onShow={setHighlight} /></div>}
      </div>

      {/* Callout: cosa devi fare adesso */}
      <div className="ax-callout">
        <div className="co-ico"><Icon name="checkCircle" /></div>
        <div className="co-main">
          <div className="co-kicker">Cosa devi fare adesso</div>
          <div className="co-action">{r.primaryAction ?? 'Leggere il documento e valutare le azioni'} <OriginBadge source={r.primaryActionSource} ctx="callout" /></div>
          <div className="co-when">{r.deadline ? <>Entro <b>{formatDate(r.deadline)}</b>{remaining ? ' · ' + remaining : ''}</> : 'Nessuna scadenza individuata con certezza'}</div>
        </div>
        <button className="btn btn-primary" onClick={() => createTask(r.primaryAction || document.title)}><Icon name="calendar" className="ic-sm" /> Crea attività</button>
      </div>

      <div className="ax-grid">
        <div className="ax-col ax-doc">
          <div className="card">
            <div className="card-title"><Icon name="document" className="ic-sm" /> Documento originale</div>
            <DocViewer text={r.originalText} highlight={highlight} />
          </div>
        </div>

        <div className="ax-col">
          {r.deadline ? (
            <div className={`card lvl-${lvl}`}>
              <div className="deadline-card">
                <div className="dl-ico"><Icon name="calendar" /></div>
                <div className="dl-main">
                  <div className="dl-kicker">Scadenza · {DEADLINE_LEVEL_LABEL[lvl] ?? ''}</div>
                  <div className="dl-date">{formatDate(r.deadline)}</div>
                  <div className="dl-rem">{remaining}</div>
                </div>
                <span className={`badge badge-${lvl === 'scaduta' || lvl === 'urgente' ? 'alta' : lvl === 'prossima' ? 'media' : 'bassa'}`}>{DEADLINE_LEVEL_LABEL[lvl] ?? ''}</span>
              </div>
              <EvidenceButton evidence={r.deadlineEvidence} label="Mostra nel documento" onShow={setHighlight} />
            </div>
          ) : (
            <div className="card"><div className="deadline-none"><Icon name="alert" /><div><strong>Scadenza non individuata con sufficiente certezza.</strong><br /><span className="muted-sm">Verifica manualmente il documento: il sistema non inventa una data.</span></div></div></div>
          )}

          <div className="card ax-actions-card">
            <div className="card-title">Cosa devi fare</div>
            <div className="ax-progress">
              <span className="pg-label">{done} di {tot} azioni completate</span>
              <div className="meter-track" style={{ flex: 1 }}><div className="meter-fill" style={{ width: `${pct}%` }} /></div>
            </div>
            <div>
              {actions.map((c) => (
                <div className={`action-item${c.done ? ' done' : ''}`} key={c.id}>
                  <input type="checkbox" checked={c.done} onChange={(e) => toggleAction(c.id, e.target.checked)} aria-label={c.text} />
                  <div className="ai-main">
                    <div className="ai-text">{c.text} <OriginBadge source={c.sourceType} /></div>
                    <div className="ai-meta">
                      {c.sourceType === 'extracted' && c.evidence && <EvidenceButton evidence={c.evidence} label="Mostra nel documento" onShow={setHighlight} />}
                      <button type="button" className="mini-btn" onClick={() => createTask(c.text)}><Icon name="calendar" className="ic-sm" /> Aggiungi allo scadenziario</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {r.uncertainties.length ? (
            <div className="card"><div className="card-title"><Icon name="alert" className="ic-sm" /> Da verificare <span className="badge badge-neutral">confidenza {r.confidence}</span></div>
              <ul className="verify-box">{r.uncertainties.map((v, i) => <li key={i}>{v}</li>)}</ul>
            </div>
          ) : (
            <div className="card"><div className="verify-ok"><Icon name="checkCircle" className="ic-sm" /> Informazioni principali confermate (confidenza {r.confidence}).</div></div>
          )}

          <div className="card"><div className="card-title">Rischio se non agisci</div>
            <span className={`risk-tag risk-${r.risk.level}`}><Icon name={r.risk.level === 'explicit' ? 'alert' : 'fileSearch'} className="ic-sm" /> {r.risk.level === 'explicit' ? 'Esplicitamente indicato nel documento' : r.risk.level === 'possible' ? 'Possibile conseguenza — da verificare' : 'Non determinabile dal documento'}</span>
            {r.risk.level !== 'unknown' && <div className="risk-text">{r.risk.text}</div>}
            <EvidenceButton evidence={r.risk.evidence} label="Mostra nel documento" onShow={setHighlight} />
          </div>

          <div className="card"><div className="card-title">Documenti richiesti</div>
            {r.requestedDocuments.length > 0 ? r.requestedDocuments.map((d, i) => (
              <div className="action-item" style={{ padding: '9px 0' }} key={i}>
                <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400 }}>{d.label}</span>
                  {d.evidence && <div className="ai-meta"><EvidenceButton evidence={d.evidence} label="Mostra nel documento" onShow={setHighlight} /></div>}
                </span>
              </div>
            )) : <span className="muted-sm">Nessun documento specifico individuato nel testo.</span>}
          </div>

          <div className="card draft-editor">
            <div className="card-title">Bozza di risposta</div>
            <div className="draft-controls">
              <div className="dc-field"><label htmlFor="draft-lang">Lingua</label>
                <select id="draft-lang" className="select-inline" value={lang} onChange={(e) => setLang(e.target.value)}>
                  {Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div className="dc-field"><label htmlFor="draft-tone">Tono</label>
                <select id="draft-tone" className="select-inline" value={tone} onChange={(e) => setTone(e.target.value)}>
                  {Object.entries(TONI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <button className="btn btn-sm" onClick={resetDraft}><Icon name="fileSearch" className="ic-sm" /> Ripristina bozza</button>
            </div>
            <textarea aria-label="Bozza di risposta modificabile" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="draft-actions">
              <button className="btn btn-sm btn-primary" onClick={saveDraft} disabled={savingDraft} aria-busy={savingDraft || undefined}>{savingDraft ? <span className="spinner" aria-hidden="true" /> : null} Salva modifiche</button>
              <button className="btn btn-sm" onClick={copyDraft}>Copia</button>
              <span className="muted-sm">Bozza generata da modello di template — rileggi e adatta prima dell’invio.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
