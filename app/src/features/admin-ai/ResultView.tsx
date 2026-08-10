// Vista risultato analisi (porting fedele di renderResult): due colonne desktop,
// documento originale con evidenziazione, checklist, rischio, bozza modificabile.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { analysisService } from '@/services/analysisService';
import { actionProgressService } from '@/services/actionProgressService';
import { replyService } from '@/services/replyService';
import { correctionService } from '@/services/correctionService';
import { createTaskFromDocument } from '@/features/tasks/taskFromDocument';
import { looksLikeScan } from '../../../supabase/functions/_shared/extractionQuality.ts';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { TONI } from '@/features/admin-ai/engine';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { PdfViewer } from '@/features/admin-ai/PdfViewer';
import type { ActionSource, AnalysisCorrection, ChecklistAction, DocumentAnalysis, DocumentReply, DocumentRecord, Evidence } from '@/types/models';

/** Tono predefinito della bozza, come prima della 0010 (era il default di reply_tone). */
const DEFAULT_TONE = 'formale';

function OriginBadge({ source, ctx }: { source: ActionSource; ctx?: 'callout' }) {
  const t = useT();
  if (source === 'extracted') {
    return <span className="origin-badge ob-ex"><Icon name="fileSearch" className="ic-sm" />{t(ctx === 'callout' ? 'adminAi.result.originBadgeExtractedCallout' : 'adminAi.result.originBadgeExtracted')}</span>;
  }
  return <span className="origin-badge ob-sg">{t(ctx === 'callout' ? 'adminAi.result.originBadgeSuggestedCallout' : 'adminAi.result.originBadgeSuggested')}</span>;
}

function EvidenceButton({ evidence, label, onShow }: { evidence: Evidence | null; label?: string; onShow: (ev: Evidence) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!evidence) return null;
  return (
    <>
      <button type="button" className="ev-btn" onClick={() => { setOpen((o) => !o); onShow(evidence); }}>
        <Icon name="fileSearch" className="ic-sm" />{label ?? t('adminAi.result.showInDocument')}
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
  const t = useT();
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
              {pages.length > 1 && <div className={`muted-sm mb-1${p.pageNumber > first ? ' mt-4' : ''}`} style={{ fontWeight: 600 }}>— {t('adminAi.result.page', { n: p.pageNumber })} —</div>}
              <div>{onThisPage ? renderHighlighted(p.text, q) : p.text}</div>
            </div>
          );
        })}
      </div>
    );
  }

  if (!text) {
    return <div className="ax-doc-view"><span className="muted-sm">{t('adminAi.result.noOriginalText')}</span></div>;
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
  const tt = useT();
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
    <div className="ax-field-row">
      <div className="ax-field-head">
        <div><b>{label}:</b>{' '}
          {current != null
            ? <span>{current} <span className="badge badge-neutral">{tt('adminAi.result.correctedByHand')}</span></span>
            : <span>{aiDisplay || '—'}</span>}
        </div>
        {!editing && (
          <button className="mini-btn" onClick={() => { setValue(current ?? (typeof aiValue === 'string' ? aiValue : aiDisplay)); setEditing(true); }}>
            <Icon name="fileSearch" className="ic-sm" /> {current != null ? tt('common.edit') : tt('adminAi.result.correct')}
          </button>
        )}
      </div>
      {current != null && <div className="muted-sm">{tt('adminAi.result.aiDetectedValue', { value: aiDisplay || '—' })}</div>}
      {editing && (
        <div className="ax-field-edit">
          <input type={inputType ?? 'text'} className="select-inline" value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: 1, minWidth: 150 }} aria-label={tt('adminAi.result.correctAria', { label })} />
          <button className="btn btn-sm btn-primary" onClick={save} disabled={saving} aria-busy={saving || undefined}>{saving ? <span className="spinner" aria-hidden="true" /> : null} {tt('common.save')}</button>
          <button className="btn btn-sm" onClick={() => setEditing(false)}>{tt('common.cancel')}</button>
        </div>
      )}
    </div>
  );
}

export function ResultView({ analysis, document, onRetry, onForceOcr }: {
  analysis: DocumentAnalysis;
  document: DocumentRecord;
  /** §27 — rilancia l'analisi dello stesso documento (senza ricaricare il file). */
  onRetry?: () => void;
  /**
   * Butta il testo estratto e rilegge il FILE con l'OCR.
   *
   * ⚠️ Non è un «rianalizza» offerto a caso (§97): compare solo quando il testo
   * su cui l'analisi è stata costruita è implausibile per la forma del file —
   * cioè quando c'è motivo di credere che il documento non sia mai stato letto.
   */
  onForceOcr?: () => void;
}) {
  const t = useT();
  const L = useLabels();
  const { activeCompany } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyName = activeCompany?.legalName ?? null;

  const isAI = analysis.engine.startsWith('claude');
  const [actions, setActions] = useState<ChecklistAction[]>(analysis.actions);
  const [highlight, setHighlight] = useState<Evidence | null>(null);
  const [reply, setReply] = useState<DocumentReply | null>(null);
  // 0010 — lingua e tono non stanno più sull'analisi: si parte dalla lingua del
  // documento e dal tono predefinito, poi vince la bozza salvata se esiste.
  const defaultLang = String(analysis.language ?? 'it');
  const [draft, setDraft] = useState('');
  const [lang, setLang] = useState(defaultLang);
  const [tone, setTone] = useState(DEFAULT_TONE);
  const [savingDraft, setSavingDraft] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [corrections, setCorrections] = useState<Record<string, AnalysisCorrection>>({});

  // §31 — se il documento originale è un PDF ancora in Storage, si può mostrare
  // il PDF renderizzato; altrimenti resta la vista testo (unica per txt/immagini).
  const isPdf = !!document.storagePath && (document.mimeType ?? '').includes('pdf');
  const [docMode, setDocMode] = useState<'pdf' | 'text'>(isPdf ? 'pdf' : 'text');
  useEffect(() => { setDocMode(isPdf ? 'pdf' : 'text'); }, [document.id, isPdf]);

  // Se cambia il documento analizzato, reinizializza lo stato locale e carica
  // l'ultima bozza salvata, senza rigenerarla (§35: la generazione è on-demand).
  // Dalla 0010 le bozze stanno in document_replies anche per il motore locale,
  // quindi la rilettura vale per entrambi i percorsi.
  useEffect(() => {
    setActions(analysis.actions);
    setLang(defaultLang);
    setTone(DEFAULT_TONE);
    setHighlight(null);
    setReply(null);
    // Motore locale: il template è deterministico, si mostra subito. Non viene
    // salvato finché l'utente non lo salva o lo rigenera esplicitamente.
    setDraft(isAI ? '' : analysisService.regenerateReply(analysis, defaultLang, DEFAULT_TONE, companyName));
    let active = true;
    replyService.getLatest(analysis.documentId).then((r) => {
      if (!active || !r) return;
      setReply(r); setDraft(r.content); setLang(r.language); setTone(r.tone);
    }).catch(() => { /* nessuna bozza: resta il template (locale) o il pulsante Genera (AI) */ });
    return () => { active = false; };
  }, [analysis.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 0010 — lo stato della checklist non è più dentro l'analisi: si legge da
  // action_progress e si fonde con le azioni dello snapshot (che portano testo
  // ed evidenza). Un errore qui NON viene ingoiato: senza il progresso la
  // checklist apparirebbe tutta da fare, cioè un dato falso presentato come vero.
  useEffect(() => {
    let active = true;
    actionProgressService.forAnalysis(analysis.id).then((progress) => {
      if (!active || progress.size === 0) return;
      setActions((prev) => actionProgressService.merge(prev, progress));
    }).catch((e) => { if (active) showToast(toUserMessage(e)); });
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
      showToast(t('adminAi.result.correctionSaved'));
    } catch (e) { showToast(toUserMessage(e)); }
  }

  const done = actions.filter((c) => c.done).length;
  const tot = actions.length;
  const pct = tot ? Math.round((done / tot) * 100) : 0;
  const r = analysis;
  const lvl = r.deadlineLevel || 'none';
  const days = r.daysToDeadline;
  const remaining = days == null ? ''
    : days < 0 ? t('tasks.overdueBy', { days: Math.abs(days) })
    : days === 0 ? t('tasks.dueToday')
    : t('tasks.dueIn', { days });

  async function toggleAction(id: number, checked: boolean) {
    const target = actions.find((c) => c.id === id);
    if (!target) return;
    const previous = actions;
    setActions(actions.map((c) => (c.id === id ? { ...c, done: checked } : c)));
    try {
      await actionProgressService.setDone({
        analysisId: r.id, companyId: r.companyId, action: target, done: checked,
      });
    } catch (e) {
      // Il database non ha accettato la spunta: la si toglie anche dalla UI,
      // altrimenti l'utente vedrebbe un'azione "fatta" che non è stata salvata.
      setActions(previous);
      showToast(toUserMessage(e));
    }
  }

  /**
   * Trasforma l'analisi in un'attività, portandosi dietro i passaggi.
   *
   * Le azioni ancora APERTE diventano la checklist. È una copia fatta una volta
   * sola: da qui in poi le due liste vivono separate — l'analisi resta il
   * verbale immutabile di ciò che il documento chiede, l'attività è il lavoro
   * che qualcuno porta avanti. Spuntare un passaggio non riscrive l'analisi.
   *
   * Le azioni già completate NON si copiano: rimetterle come «da fare» sarebbe
   * falso, e copiarle già fatte lo sarebbe di più, perché data e autore
   * verrebbero riscritti con quelli di adesso.
   */
  async function createTask(title: string) {
    try {
      // La conversione vive in `taskFromDocument`: la usa anche il dettaglio di
      // un documento nel Document Hub, e due copie della stessa regola —
      // soprattutto della parte che decide cosa NON copiare — col tempo
      // divergono.
      const outcome = await createTaskFromDocument({
        companyId: r.companyId, userId: user!.id, documentId: document.id, title,
        analysis: { ...r, actions },
      });
      if (outcome.stepsFailed) {
        // L'attività c'è, i passaggi no: lo si DICE, invece di lasciar credere
        // che sia tutto a posto o di far sparire anche l'attività.
        showToast(t('adminAi.result.taskAddedStepsFailed'));
      } else if (outcome.steps) {
        showToast(t('adminAi.result.taskAddedWithSteps', { n: outcome.steps }));
      } else {
        showToast(t('adminAi.result.taskAdded'));
      }
    } catch (e) { showToast(toUserMessage(e)); }
  }

  // AI (§35): genera la bozza su richiesta con la Edge Function; la persiste server-side.
  async function generateDraft() {
    setGenerating(true);
    try {
      const gen = await replyService.generate({ documentId: analysis.documentId, language: lang, tone });
      setReply(gen);
      setDraft(gen.content);
      showToast(t(reply ? 'adminAi.result.draftRegenerated' : 'adminAi.result.draftGenerated'));
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setGenerating(false); }
  }
  /** Salva la bozza corrente. 0010 — sempre in document_replies, mai sull'analisi. */
  async function persistDraft(content: string, isEdited: boolean) {
    if (isAI) {
      if (!reply) { showToast(t('adminAi.result.generateFirst')); return; }
      await replyService.saveEdit(reply.id, content);   // §34: modifica umana tracciata (is_edited)
      setReply({ ...reply, content, isEdited: true });
      return;
    }
    if (!user) return;
    const saved = await replyService.saveLocalDraft({
      replyId: reply?.id ?? null,
      documentId: r.documentId, companyId: r.companyId, analysisId: r.id, userId: user.id,
      language: lang, tone, content, isEdited,
    });
    setReply(saved);
  }

  async function saveDraft() {
    setSavingDraft(true);
    try {
      await persistDraft(draft, true);
      showToast(t('adminAi.result.changesSaved'));
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setSavingDraft(false); }
  }

  // Solo motore locale: rigenera dal template deterministico e la persiste.
  // `isEdited: false` — è il template tale e quale, non un testo scritto a mano.
  async function resetDraft() {
    const next = analysisService.regenerateReply(r, lang, tone, companyName);
    setDraft(next);
    setSavingDraft(true);
    try {
      await persistDraft(next, false);
      showToast(t('adminAi.result.draftRegenerated'));
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setSavingDraft(false); }
  }
  function copyDraft() {
    navigator.clipboard?.writeText(draft);
    showToast(t('adminAi.result.draftCopied'));
  }

  // §25/§53 — un'analisi FALLITA non è un risultato: non se ne mostrano mittente,
  // tipo o scadenza (sarebbero i default, non dati estratti). Si dice che è
  // fallita, perché, e si offre di riprovare. Il documento resta in archivio.
  if (r.analysisStatus === 'failed') {
    return (
      <div>
        <div className="card ax-header">
          <div className="ax-head-top">
            <div className="ax-title">{document.title}</div>
            <div className="ax-badges"><span className="badge badge-alta">{t('adminAi.result.failedTitle')}</span></div>
          </div>
          <div className="warn-box mt-14">
            <Icon name="alert" />
            <span>
              {r.errorMessageSafe ?? t('adminAi.result.failedGeneric')}
              {r.errorCode ? <span className="muted-sm"> {t('adminAi.result.errorCodeNote', { code: r.errorCode })}</span> : null}
            </span>
          </div>
          <p className="muted-sm mt-12">
{t('adminAi.result.failedKept')}
          </p>
          <div className="row-wrap mt-12">
            <button className="btn btn-primary btn-sm" onClick={() => onRetry?.()} disabled={!onRetry}>
              <Icon name="refresh" className="ic-sm" /> {t('adminAi.result.retryAnalysis')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ⚠️ §4 — L'analisi può essere impeccabile e inutile perché il documento non è
  // mai stato letto: una scansione di cui pdf.js ha ricavato quattro numeri
  // produce un verbale onesto che dice «non si capisce nulla». Chi guarda vede
  // un'analisi, non un'estrazione fallita, e non ha modo di sapere perché.
  // Qui la si nomina, e si offre l'unico gesto che la ripara.
  const unreadFile = !!onForceOcr && !!document.storagePath && looksLikeScan({
    chars: (analysis.originalText ?? '').trim().length,
    pages: document.pageCount || 1,
    bytes: document.fileSize,
    // Si chiede «questo testo è plausibile per questo file?», non «come è stato
    // ricavato»: la risposta è utile qualunque sia la provenienza registrata.
    extractionMethod: 'native_pdf',
  });

  return (
    <div>
      {/* Il tentativo più recente è fallito, ma resta valida un'analisi precedente. */}
      {r.lastAttemptFailed && (
        <div className="warn-box mb-14">
          <Icon name="alert" />
          <span>{t('adminAi.result.lastAttemptFailed', { reason: r.lastAttemptError ? `: ${r.lastAttemptError}` : '.' })}</span>
        </div>
      )}

      {unreadFile && (
        <div className="warn-box mb-14">
          <Icon name="alert" />
          <div>
            <div>{t('adminAi.result.looksUnread')}</div>
            <button className="btn btn-sm mt-12" onClick={() => onForceOcr?.()}>
              <Icon name="fileSearch" className="ic-sm" /> {t('adminAi.result.forceOcr')}
            </button>
          </div>
        </div>
      )}

      <div className="card ax-header">
        <div className="ax-head-top">
          <div className="ax-title">{document.title}</div>
          <div className="ax-badges">
            {r.analysisStatus === 'needs_review' && <span className="badge badge-media">{t('adminAi.result.needsReview')}</span>}
            <span className={`badge badge-${r.urgency}`}>{t('adminAi.result.urgencyChip', { level: L.urgency(r.urgency) })}</span>
            <span className="badge badge-neutral">{t('adminAi.result.confidenceChip', { level: L.confidence(r.confidence) })}</span>
          </div>
        </div>
        <div className="ax-meta">
          <span className="ax-chip"><Icon name="banknote" className="ic-sm" /> <b>{r.sender ?? L.authorityType('unknown')}</b>{r.senderUncertain ? ` · ${t('common.verify')}` : ''}</span>
          {r.senderAuthorityType && <span className="ax-chip">{L.authorityType(r.senderAuthorityType)}</span>}
          <span className="ax-chip"><Icon name="document" className="ic-sm" /> {r.documentTypeLabel}</span>
          <span className="ax-chip">{r.languageLabel}</span>
          {r.recipient && <span className="ax-chip" title={t('adminAi.result.recipientTitle')}>{t('adminAi.result.recipientPrefix', { name: r.recipient })}</span>}
          {r.documentDate && <span className="ax-chip" title={t('adminAi.result.documentDate')}><Icon name="calendar" className="ic-sm" /> {formatDate(r.documentDate)}</span>}
          {/* §12 — l'importo di testa dichiara SEMPRE il suo tipo: una multa non
              è una richiesta di pagamento. */}
          {r.amountDisplay && (
            <span className="ax-chip" title={L.amountType(r.amountType ?? 'other')}>
              {r.amountDisplay}
              <span className="muted-sm"> · {L.amountType(r.amountType ?? 'other')}</span>
            </span>
          )}
          <span className="ax-chip" title={t('adminAi.result.engineTitle', { engine: r.engine })}>
            <Icon name={r.engine.startsWith('claude') ? 'star' : 'fileSearch'} className="ic-sm" />
            {t(r.engine.startsWith('claude') ? 'adminAi.result.engineAi' : 'adminAi.result.engineLocal')}
          </span>
        </div>
        {r.subject && <div className="ax-subject muted-sm mt-2"><b>{t('adminAi.result.subjectLabel')}:</b> {r.subject}</div>}
        {r.senderEvidence && <div><EvidenceButton evidence={r.senderEvidence} label={t('adminAi.result.senderShowInDocument')} onShow={setHighlight} /></div>}
      </div>

      {/* Callout: cosa devi fare adesso */}
      <div className="ax-callout">
        <div className="co-ico"><Icon name="checkCircle" /></div>
        <div className="co-main">
          <div className="co-kicker">{t('adminAi.result.whatToDoNow')}</div>
          <div className="co-action">{r.primaryAction ?? t('adminAi.result.fallbackAction')} <OriginBadge source={r.primaryActionSource} ctx="callout" /></div>
          <div className="co-when">{r.deadline ? <>{t('adminAi.result.by')} <b>{formatDate(r.deadline)}</b>{remaining ? ' · ' + remaining : ''}</> : t('adminAi.result.noDeadlineFound')}</div>
        </div>
        <button className="btn btn-primary" onClick={() => createTask(r.primaryAction || document.title)}><Icon name="calendar" className="ic-sm" /> {t('adminAi.result.createTask')}</button>
      </div>

      <div className="ax-grid">
        <div className="ax-col ax-doc">
          <div className="card">
            <div className="card-title">
              <Icon name="document" className="ic-sm" /> {t('adminAi.result.originalDocument')}
              {isPdf && (
                <span className="gap-2" style={{ marginLeft: 'auto', display: 'inline-flex' }}>
                  <button type="button" className={`btn btn-sm${docMode === 'pdf' ? ' btn-primary' : ''}`}
                    aria-pressed={docMode === 'pdf'} onClick={() => setDocMode('pdf')}>PDF</button>
                  <button type="button" className={`btn btn-sm${docMode === 'text' ? ' btn-primary' : ''}`}
                    aria-pressed={docMode === 'text'} onClick={() => setDocMode('text')}>{t('adminAi.result.docModeText')}</button>
                </span>
              )}
            </div>
            {docMode === 'pdf' && document.storagePath
              ? <PdfViewer storagePath={document.storagePath} highlight={highlight} />
              : <DocViewer text={r.originalText} pages={r.pages} highlight={highlight} />}
          </div>
        </div>

        <div className="ax-col">
          {r.deadline ? (
            <div className={`card lvl-${lvl}`}>
              <div className="deadline-card">
                <div className="dl-ico"><Icon name="calendar" /></div>
                <div className="dl-main">
                  <div className="dl-kicker">{t('adminAi.result.deadlineKicker')} · {L.deadlineLevel(lvl)}</div>
                  <div className="dl-date">{formatDate(r.deadline)}</div>
                  <div className="dl-rem">{remaining}</div>
                </div>
                <span className={`badge badge-${lvl === 'scaduta' || lvl === 'urgente' ? 'alta' : lvl === 'prossima' ? 'media' : 'bassa'}`}>{L.deadlineLevel(lvl)}</span>
              </div>
              <EvidenceButton evidence={r.deadlineEvidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} />
              {r.deadlineRequiresVerification && (
                <div className="muted-sm mt-2">
                  <Icon name="alert" className="ic-sm" /> {r.deadlineType === 'relative'
                    ? t('adminAi.result.deadlineRelative')
                    : t('adminAi.result.deadlineIndicative')}
                </div>
              )}
            </div>
          ) : (
            <div className="card"><div className="deadline-none"><Icon name="alert" /><div><strong>{t('adminAi.result.deadlineNoneTitle')}</strong><br /><span className="muted-sm">{t('adminAi.result.deadlineNoneSub')}</span></div></div></div>
          )}

          <div className="card ax-actions-card">
            <div className="card-title">{t('adminAi.result.checklist')}</div>
            <div className="ax-progress">
              <span className="pg-label">{t('adminAi.result.checklistProgress', { done, total: tot })}</span>
              <div className="meter-track" style={{ flex: 1 }}><div className="meter-fill" style={{ width: `${pct}%` }} /></div>
            </div>
            <div>
              {actions.map((c) => (
                // La casella e il testo sono legati da id/htmlFor: si spunta
                // cliccando la frase, non solo il quadratino di 18 pixel.
                <div className={`action-item${c.done ? ' done' : ''}`} key={c.id}>
                  <input type="checkbox" id={`act-${r.id}-${c.id}`} checked={c.done} onChange={(e) => toggleAction(c.id, e.target.checked)} />
                  <div className="ai-main">
                    <div className="ai-text"><label htmlFor={`act-${r.id}-${c.id}`}>{c.text}</label> <OriginBadge source={c.sourceType} /></div>
                    <div className="ai-meta">
                      {c.sourceType === 'extracted' && c.evidence && <EvidenceButton evidence={c.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} />}
                      <button type="button" className="mini-btn" onClick={() => createTask(c.text)}><Icon name="calendar" className="ic-sm" /> {t('adminAi.result.addToTasks')}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {r.uncertainties.length ? (
            <div className="card"><div className="card-title"><Icon name="alert" className="ic-sm" /> {t('adminAi.result.needsReview')} <span className="badge badge-neutral">{t('adminAi.result.confidenceChip', { level: L.confidence(r.confidence) })}</span></div>
              <ul className="verify-box">{r.uncertainties.map((v, i) => <li key={i}>{v}</li>)}</ul>
            </div>
          ) : (
            <div className="card"><div className="verify-ok"><Icon name="checkCircle" className="ic-sm" /> {t('adminAi.result.mainInfoConfirmed', { level: L.confidence(r.confidence) })}</div></div>
          )}

          {/* Il tag sta nella riga del titolo: quando il rischio non è
              determinabile la scheda diceva «non determinabile» su una riga
              tutta sua, occupando lo spazio di un'informazione che non c'è. */}
          <div className="card"><div className="card-title">{t('adminAi.result.risk')}
            <span className={`risk-tag risk-${r.risk.level}`}><Icon name={r.risk.level === 'explicit' ? 'alert' : 'fileSearch'} className="ic-sm" /> {r.risk.level === 'explicit' ? t('adminAi.result.riskExplicit') : r.risk.level === 'possible' ? t('adminAi.result.riskInferred') : t('adminAi.result.riskUnknown')}</span>
          </div>
            {r.risk.level !== 'unknown' && <div className="risk-text">{r.risk.text}</div>}
            <EvidenceButton evidence={r.risk.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} />
          </div>

          <div className="card"><div className="card-title">{t('adminAi.result.requestedDocumentsTitle')}</div>
            {r.requestedDocuments.length > 0 ? r.requestedDocuments.map((d, i) => (
              <div className="action-item py-2" key={i}>
                <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400 }}>{d.label}</span>
                  {d.evidence && <div className="ai-meta"><EvidenceButton evidence={d.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} /></div>}
                </span>
              </div>
            )) : <span className="muted-sm">{t('adminAi.result.noRequestedDocuments')}</span>}
          </div>

          {r.amounts.length > 0 && (
            <div className="card"><div className="card-title"><Icon name="banknote" className="ic-sm" /> {t('adminAi.result.amountsFound')}</div>
              {r.amounts.map((m, i) => (
                <div className="action-item py-2" key={`amt-${i}`}>
                  <span className="ai-main">
                    <span className="ai-text"><b>{m.display}</b>{m.description ? ` — ${m.description}` : ''} <span className="badge badge-neutral">{L.amountType(m.type)}</span></span>
                    {m.evidence && <div className="ai-meta"><EvidenceButton evidence={m.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} /></div>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(r.referenceNumbers.length > 0 || r.legalReferences.length > 0) && (
            <div className="card"><div className="card-title">{t('adminAi.result.referencesAndLegal')}</div>
              {r.referenceNumbers.map((ref, i) => (
                <div className="action-item py-2" key={`ref-${i}`}>
                  <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400 }}>{ref.label ? `${ref.label}: ` : ''}<b>{ref.value}</b></span>
                    {ref.evidence && <div className="ai-meta"><EvidenceButton evidence={ref.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} /></div>}
                  </span>
                </div>
              ))}
              {r.legalReferences.map((leg, i) => (
                <div className="action-item py-2" key={`leg-${i}`}>
                  <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400 }}>{leg.text}</span>
                    {leg.evidence && <div className="ai-meta"><EvidenceButton evidence={leg.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} /></div>}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-title"><Icon name="fileSearch" className="ic-sm" /> {t('adminAi.result.manualReview')}</div>
            <div className="muted-sm">{t('adminAi.result.correctionsHint')}</div>
            <CorrectionRow label={t('adminAi.result.sender')} field="sender" aiDisplay={r.sender ?? ''} aiValue={r.sender} correction={corrections.sender} onSave={saveCorrection} />
            <CorrectionRow label={t('adminAi.result.documentType')} field="document_type" aiDisplay={r.documentTypeLabel} aiValue={r.documentType} correction={corrections.document_type} onSave={saveCorrection} />
            <CorrectionRow label={t('adminAi.result.deadline')} field="deadline" aiDisplay={r.deadline ? formatDate(r.deadline) : ''} aiValue={r.deadline} correction={corrections.deadline} inputType="date" onSave={saveCorrection} />
            <CorrectionRow label={t('adminAi.result.amount')} field="amount" aiDisplay={r.amountDisplay ?? ''} aiValue={r.amount} correction={corrections.amount} onSave={saveCorrection} />
          </div>

          <div className="card draft-editor">
            <div className="card-title">{t('adminAi.result.replyDraftTitle')}</div>
            <div className="draft-controls">
              <div className="dc-field"><label htmlFor="draft-lang">{t('adminAi.result.replyLanguage')}</label>
                <select id="draft-lang" className="select-inline" value={lang} onChange={(e) => setLang(e.target.value)}>
                  {(['it', 'de', 'fr'] as const).map((k) => <option key={k} value={k}>{L.language(k)}</option>)}
                </select></div>
              <div className="dc-field"><label htmlFor="draft-tone">{t('adminAi.result.replyTone')}</label>
                <select id="draft-tone" className="select-inline" value={tone} onChange={(e) => setTone(e.target.value)}>
                  {Object.keys(TONI).map((k) => <option key={k} value={k}>{L.tone(k)}</option>)}
                </select></div>
              {isAI ? (
                <button className="btn btn-sm" onClick={generateDraft} disabled={generating} aria-busy={generating || undefined}>
                  {generating ? <span className="spinner" aria-hidden="true" /> : <Icon name="star" className="ic-sm" />} {reply ? t('adminAi.result.regenerateReply') : t('adminAi.result.generateReply')}
                </button>
              ) : (
                <button className="btn btn-sm" onClick={resetDraft}><Icon name="fileSearch" className="ic-sm" /> {t('adminAi.result.restoreDraft')}</button>
              )}
            </div>
            {isAI && !reply && !generating ? (
              <div className="draft-empty muted-sm">{t('adminAi.result.noReplyYet')}</div>
            ) : (
              <textarea aria-label={t('adminAi.result.reply')} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={generating ? t('adminAi.result.generatingReply') : ''} disabled={generating} />
            )}
            <div className="draft-actions">
              <button className="btn btn-sm btn-primary" onClick={saveDraft} disabled={savingDraft || generating || (isAI && !reply)} aria-busy={savingDraft || undefined}>{savingDraft ? <span className="spinner" aria-hidden="true" /> : null} {t('common.save')}</button>
              <button className="btn btn-sm" onClick={copyDraft} disabled={!draft}>{t('common.copy')}</button>
              <span className="muted-sm">{isAI ? t('adminAi.result.replyDisclaimer') : t('adminAi.result.replyDisclaimer')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
