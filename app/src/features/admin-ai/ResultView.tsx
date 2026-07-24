// Vista risultato analisi (porting fedele di renderResult): due colonne desktop,
// documento originale con evidenziazione, checklist, rischio, bozza modificabile.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { analysisService } from '@/services/analysisService';
import { replyService } from '@/services/replyService';
import { correctionService } from '@/services/correctionService';
import { taskService } from '@/services/taskService';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { LANG_LABEL, TONI } from '@/features/admin-ai/engine';
import type { ActionSource, AnalysisCorrection, ChecklistAction, DocumentAnalysis, DocumentReply, DocumentRecord, Evidence, TaskPriority } from '@/types/models';

const DEADLINE_LEVEL_LABEL: Record<string, string> = { scaduta: 'Scaduta', urgente: 'Urgente', prossima: 'Prossima', nessuna: 'Nessuna urgenza' };
const URGENCY_TO_PRIORITY: Record<string, TaskPriority> = { alta: 'high', media: 'medium', bassa: 'low' };
const AUTHORITY_LABEL: Record<string, string> = {
  federal: 'Autorità federale', cantonal: 'Autorità cantonale', municipal: 'Autorità comunale',
  social_insurance: 'Assicurazione sociale', insurance: 'Assicurazione', pension: 'Cassa pensione', private: 'Privato',
};
const AMOUNT_TYPE_LABEL: Record<string, string> = {
  due: 'Da versare', fine: 'Multa', fee: 'Tassa / emolumento', contribution: 'Contributo', other: 'Importo',
};

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

// Evidenzia la prima occorrenza della citazione nel testo (case-insensitive).
function renderHighlighted(text: string, quote: string | null): React.ReactNode {
  const q = quote?.trim();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark className="ev-hl">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

function DocViewer({ text, pages, highlight }: { text: string | null | undefined; pages?: { pageNumber: number; text: string }[] | null; highlight: Evidence | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight && ref.current) {
      const mark = ref.current.querySelector('.ev-hl');
      if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight]);

  // Viewer PER PAGINA (§31): pagine separate; la citazione si evidenzia nella pagina che la contiene.
  if (pages && pages.length > 0) {
    const q = highlight?.quote ?? null;
    const target = highlight?.pageNumber ?? null;
    const first = pages[0].pageNumber;
    return (
      <div className="ax-doc-view" ref={ref}>
        {pages.map((p) => {
          const onThisPage = !!q && (target == null || target === p.pageNumber) && p.text.toLowerCase().includes(q.trim().toLowerCase());
          return (
            <div key={p.pageNumber}>
              {pages.length > 1 && <div className="muted-sm" style={{ fontWeight: 600, marginTop: p.pageNumber > first ? 14 : 0, marginBottom: 4 }}>— Pagina {p.pageNumber} —</div>}
              <div>{onThisPage ? renderHighlighted(p.text, q) : p.text}</div>
            </div>
          );
        })}
      </div>
    );
  }

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

// Riga di correzione (§34): mostra il valore AI, permette di correggerlo senza alterarlo.
function CorrectionRow({ label, field, aiDisplay, aiValue, correction, inputType, onSave }: {
  label: string; field: string; aiDisplay: string; aiValue: unknown;
  correction: AnalysisCorrection | undefined; inputType?: string;
  onSave: (field: string, aiValue: unknown, correctedValue: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const current = correction ? String(correction.correctedValue ?? '') : null;

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    try { await onSave(field, aiValue, value.trim()); setEditing(false); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid rgba(127,127,127,0.15)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div><b>{label}:</b>{' '}
          {current != null
            ? <span>{current} <span className="badge badge-neutral">corretto a mano</span></span>
            : <span>{aiDisplay || '—'}</span>}
        </div>
        {!editing && (
          <button className="mini-btn" onClick={() => { setValue(current ?? (typeof aiValue === 'string' ? aiValue : aiDisplay)); setEditing(true); }}>
            <Icon name="fileSearch" className="ic-sm" /> {current != null ? 'Modifica' : 'Correggi'}
          </button>
        )}
      </div>
      {current != null && <div className="muted-sm">Valore rilevato dall’AI: {aiDisplay || '—'}</div>}
      {editing && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <input type={inputType ?? 'text'} className="select-inline" value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: 1, minWidth: 150 }} aria-label={`Correggi ${label}`} />
          <button className="btn btn-sm btn-primary" onClick={save} disabled={saving} aria-busy={saving || undefined}>{saving ? <span className="spinner" aria-hidden="true" /> : null} Salva</button>
          <button className="btn btn-sm" onClick={() => setEditing(false)}>Annulla</button>
        </div>
      )}
    </div>
  );
}

export function ResultView({ analysis, document }: { analysis: DocumentAnalysis; document: DocumentRecord }) {
  const { activeCompany } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyName = activeCompany?.legalName ?? null;

  const isAI = analysis.engine.startsWith('claude');
  const [actions, setActions] = useState<ChecklistAction[]>(analysis.actions);
  const [highlight, setHighlight] = useState<Evidence | null>(null);
  const [reply, setReply] = useState<DocumentReply | null>(null);
  const [draft, setDraft] = useState(isAI ? '' : analysis.replyDraft);
  const [lang, setLang] = useState(String(analysis.replyLanguage));
  const [tone, setTone] = useState(analysis.replyTone);
  const [savingDraft, setSavingDraft] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [corrections, setCorrections] = useState<Record<string, AnalysisCorrection>>({});

  // Se cambia il documento analizzato, reinizializza lo stato locale e (per l'AI)
  // carica l'ultima bozza salvata, senza rigenerarla (§35: la generazione è on-demand).
  useEffect(() => {
    setActions(analysis.actions);
    setLang(String(analysis.replyLanguage));
    setTone(analysis.replyTone);
    setHighlight(null);
    if (!isAI) { setReply(null); setDraft(analysis.replyDraft); return; }
    setReply(null); setDraft('');
    let active = true;
    replyService.getLatest(analysis.documentId).then((r) => {
      if (!active || !r) return;
      setReply(r); setDraft(r.content); setLang(r.language); setTone(r.tone);
    }).catch(() => { /* nessuna bozza: si mostrerà il pulsante Genera */ });
    return () => { active = false; };
  }, [analysis.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // §34 — carica le correzioni umane esistenti (la più recente per campo).
  useEffect(() => {
    let active = true;
    correctionService.listForAnalysis(analysis.id).then((list) => {
      if (!active) return;
      const map: Record<string, AnalysisCorrection> = {};
      for (const c of list) if (!map[c.field]) map[c.field] = c;
      setCorrections(map);
    }).catch(() => { /* nessuna correzione */ });
    return () => { active = false; };
  }, [analysis.id]);

  async function saveCorrection(field: string, aiValue: unknown, correctedValue: string) {
    if (!user) return;
    try {
      const saved = await correctionService.save({
        analysisId: analysis.id, documentId: analysis.documentId, companyId: analysis.companyId, userId: user.id,
        field, originalValue: aiValue, correctedValue,
      });
      setCorrections((prev) => ({ ...prev, [field]: saved }));
      showToast('Correzione salvata');
    } catch (e) { showToast(toUserMessage(e)); }
  }

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

  // AI (§35): genera la bozza su richiesta con la Edge Function; la persiste server-side.
  async function generateDraft() {
    setGenerating(true);
    try {
      const gen = await replyService.generate({ documentId: analysis.documentId, language: lang, tone });
      setReply(gen);
      setDraft(gen.content);
      showToast(reply ? 'Bozza rigenerata' : 'Bozza generata');
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setGenerating(false); }
  }
  async function saveDraft() {
    setSavingDraft(true);
    try {
      if (isAI) {
        if (!reply) { showToast('Genera prima una bozza.'); return; }
        await replyService.saveEdit(reply.id, draft);   // §34: modifica umana tracciata (is_edited)
      } else {
        await analysisService.updateReplyDraft(r.id, { draft, language: lang, tone });
      }
      showToast('Modifiche salvate');
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setSavingDraft(false); }
  }
  // Solo motore locale: rigenera dal template deterministico.
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
          {r.senderAuthorityType && AUTHORITY_LABEL[r.senderAuthorityType] && <span className="ax-chip">{AUTHORITY_LABEL[r.senderAuthorityType]}</span>}
          <span className="ax-chip"><Icon name="document" className="ic-sm" /> {r.documentTypeLabel}</span>
          <span className="ax-chip">{r.languageLabel}</span>
          {r.recipient && <span className="ax-chip" title="Destinatario individuato">A: {r.recipient}</span>}
          {r.documentDate && <span className="ax-chip" title="Data del documento"><Icon name="calendar" className="ic-sm" /> {formatDate(r.documentDate)}</span>}
          {r.amountDisplay && <span className="ax-chip">{r.amountDisplay}</span>}
          <span className="ax-chip" title={`Motore di analisi: ${r.engine}`}>
            <Icon name={r.engine.startsWith('claude') ? 'star' : 'fileSearch'} className="ic-sm" />
            {r.engine.startsWith('claude') ? 'Analisi AI' : 'Motore locale'}
          </span>
        </div>
        {r.subject && <div className="ax-subject muted-sm" style={{ marginTop: 6 }}><b>Oggetto:</b> {r.subject}</div>}
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
            <DocViewer text={r.originalText} pages={r.pages} highlight={highlight} />
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
              {r.deadlineRequiresVerification && (
                <div className="muted-sm" style={{ marginTop: 8 }}>
                  <Icon name="alert" className="ic-sm" /> {r.deadlineType === 'relative'
                    ? 'Scadenza relativa: verifica la data esatta in base alla data di ricezione.'
                    : 'Data indicativa: conferma la scadenza nel documento.'}
                </div>
              )}
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

          {r.amounts.length > 0 && (
            <div className="card"><div className="card-title"><Icon name="banknote" className="ic-sm" /> Importi rilevati</div>
              {r.amounts.map((m, i) => (
                <div className="action-item" style={{ padding: '9px 0' }} key={`amt-${i}`}>
                  <span className="ai-main">
                    <span className="ai-text"><b>{m.display}</b>{m.description ? ` — ${m.description}` : ''} <span className="badge badge-neutral">{AMOUNT_TYPE_LABEL[m.type] ?? m.type}</span></span>
                    {m.evidence && <div className="ai-meta"><EvidenceButton evidence={m.evidence} label="Mostra nel documento" onShow={setHighlight} /></div>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(r.referenceNumbers.length > 0 || r.legalReferences.length > 0) && (
            <div className="card"><div className="card-title">Riferimenti e basi legali</div>
              {r.referenceNumbers.map((ref, i) => (
                <div className="action-item" style={{ padding: '7px 0' }} key={`ref-${i}`}>
                  <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400 }}>{ref.label ? `${ref.label}: ` : ''}<b>{ref.value}</b></span>
                    {ref.evidence && <div className="ai-meta"><EvidenceButton evidence={ref.evidence} label="Mostra nel documento" onShow={setHighlight} /></div>}
                  </span>
                </div>
              ))}
              {r.legalReferences.map((leg, i) => (
                <div className="action-item" style={{ padding: '7px 0' }} key={`leg-${i}`}>
                  <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400 }}>{leg.text}</span>
                    {leg.evidence && <div className="ai-meta"><EvidenceButton evidence={leg.evidence} label="Mostra nel documento" onShow={setHighlight} /></div>}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-title"><Icon name="fileSearch" className="ic-sm" /> Revisione manuale</div>
            <div className="muted-sm">Se un dato è errato, correggilo: la correzione viene registrata e NON altera l’analisi AI originale (§34).</div>
            <CorrectionRow label="Mittente" field="sender" aiDisplay={r.sender ?? ''} aiValue={r.sender} correction={corrections.sender} onSave={saveCorrection} />
            <CorrectionRow label="Tipo di documento" field="document_type" aiDisplay={r.documentTypeLabel} aiValue={r.documentType} correction={corrections.document_type} onSave={saveCorrection} />
            <CorrectionRow label="Scadenza" field="deadline" aiDisplay={r.deadline ? formatDate(r.deadline) : ''} aiValue={r.deadline} correction={corrections.deadline} inputType="date" onSave={saveCorrection} />
            <CorrectionRow label="Importo" field="amount" aiDisplay={r.amountDisplay ?? ''} aiValue={r.amount} correction={corrections.amount} onSave={saveCorrection} />
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
              {isAI ? (
                <button className="btn btn-sm" onClick={generateDraft} disabled={generating} aria-busy={generating || undefined}>
                  {generating ? <span className="spinner" aria-hidden="true" /> : <Icon name="star" className="ic-sm" />} {reply ? 'Rigenera con l’AI' : 'Genera bozza con l’AI'}
                </button>
              ) : (
                <button className="btn btn-sm" onClick={resetDraft}><Icon name="fileSearch" className="ic-sm" /> Ripristina bozza</button>
              )}
            </div>
            {isAI && !reply && !generating ? (
              <div className="draft-empty muted-sm">Nessuna bozza ancora. Scegli lingua e tono, poi premi «Genera bozza con l’AI»: potrai rileggerla e modificarla prima dell’invio.</div>
            ) : (
              <textarea aria-label="Bozza di risposta modificabile" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={generating ? 'Generazione della bozza in corso…' : ''} disabled={generating} />
            )}
            <div className="draft-actions">
              <button className="btn btn-sm btn-primary" onClick={saveDraft} disabled={savingDraft || generating || (isAI && !reply)} aria-busy={savingDraft || undefined}>{savingDraft ? <span className="spinner" aria-hidden="true" /> : null} Salva modifiche</button>
              <button className="btn btn-sm" onClick={copyDraft} disabled={!draft}>Copia</button>
              <span className="muted-sm">{isAI ? 'Bozza generata dall’AI — rileggi e adatta prima dell’invio; non viene inviata automaticamente.' : 'Bozza generata da modello di template — rileggi e adatta prima dell’invio.'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
