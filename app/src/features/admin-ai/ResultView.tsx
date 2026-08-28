// Vista risultato analisi (porting fedele di renderResult): due colonne desktop,
// documento originale con evidenziazione, checklist, rischio, bozza modificabile.
import { useEffect, useRef, useState } from 'react';
import { PriorityMark } from '@/components/ui/PriorityMark';
import { Tag } from '@/components/ui/Tag';
import { Icon } from '@/components/ui/Icon';
import { analysisService } from '@/services/analysisService';
import { actionProgressService } from '@/services/actionProgressService';
import { replyService } from '@/services/replyService';
import { correctionService } from '@/services/correctionService';
import { createTaskFromDocument, appartenenzaDa } from '@/features/tasks/taskFromDocument';
import { looksLikeScan } from '../../../supabase/functions/_shared/extractionQuality.ts';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { TONI } from '@/features/admin-ai/engine';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { useDocumentLabel } from '@/i18n/documentLabel';
import { etichettaDocumento } from '@/lib/documentTitle';
import { PdfViewer } from '@/features/admin-ai/PdfViewer';
import { ActionOriginMark, ProvenanceMark } from '@/components/ui/ProvenanceMark';
import { AppointmentMark } from '@/components/ui/AppointmentMark';
import { TrustIndicator } from '@/features/documents/TrustIndicator';
import { useAnalysisTrust } from '@/features/documents/useAnalysisTrust';
import { MarkGlyph } from '@/components/ui/MarkGlyph';
import { MarkLegend } from '@/components/ui/MarkLegend';
import { cx } from '@/lib/cx';
import styles from './admin-ai.module.css';
import type { AnalysisCorrection, ChecklistAction, DocumentAnalysis, DocumentReply, DocumentRecord, Evidence } from '@/types/models';

/** Tono predefinito della bozza, come prima della 0010 (era il default di reply_tone). */
const DEFAULT_TONE = 'formale';

function EvidenceButton({ evidence, label, onShow }: { evidence: Evidence | null; label?: string; onShow: (ev: Evidence) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!evidence) return null;
  return (
    <>
      <button type="button" className={styles.evBtn} onClick={() => { setOpen((o) => !o); onShow(evidence); }}>
        <Icon name="fileSearch" className="ic-sm" />{label ?? t('adminAi.result.showInDocument')}
      </button>
      <div className={`ev-quote${open ? ' show' : ''}`}>«{evidence.quote}»</div>
    </>
  );
}

/**
 * LA PROVA DI UN DATO CHE GENERA LAVORO — visibile, senza un clic.
 *
 * ⚠️⚠️ PERCHÉ NON È `EvidenceButton`. Il 2026-08-15 la scheda «Scadenza
 * 10.09.2026 · affidabilità alta» aveva sotto, chiusa, la citazione che la
 * smentiva: «Il sopralluogo è previsto per il 10.09.2026 presso la vostra
 * sede». Bastava leggerla per vedere che quella data non era un termine. Era
 * dietro «Mostra nel documento», e nessuno aveva motivo di premerlo: il
 * sistema si dichiarava sicuro. Una prova che compare solo a chi già sospetta
 * non protegge nessuno — protegge chi non ne ha bisogno.
 *
 * ⚠️ IL CLIC RESTA, ma cambia mestiere: non serve più a SCOPRIRE che una prova
 * esiste, serve ad ANDARE al punto del documento originale.
 *
 * ⚠️ E QUANDO LA PROVA NON C'È, LO SPAZIO LO DICE. Un campo muto e un campo
 * senza appiglio nel testo si somigliavano — entrambi niente — e sono due cose
 * opposte: nel secondo caso c'è un dato che nessuna frase del documento
 * sostiene, ed è proprio quello da guardare per primo.
 *
 * ⚠️ NON SI APPLICA A TUTTI I CAMPI, di proposito: solo a quelli da cui nascono
 * attività e termini (scadenza, appuntamento, importi, mittente). Venti
 * citazioni aperte in una pagina non si leggono — e una pagina che non si legge
 * riporta al punto di partenza per un'altra strada.
 */
function EvidenceShown({ evidence, onShow }: { evidence: Evidence | null; onShow: (ev: Evidence) => void }) {
  const t = useT();
  if (!evidence) {
    return (
      <div className={styles.evNone}>
        <MarkGlyph name="dash" />{t('adminAi.result.noEvidenceInDocument')}
      </div>
    );
  }
  return (
    <div className={styles.evShown}>
      {/* `lang=""` — la citazione è nella lingua del DOCUMENTO, non
          dell'interfaccia: dichiararlo evita che un lettore di schermo la
          pronunci con la fonetica sbagliata. */}
      <blockquote className={styles.evShownQ} lang="">«{evidence.quote}»</blockquote>
      <button type="button" className={styles.evBtn} onClick={() => onShow(evidence)}>
        <Icon name="fileSearch" className="ic-sm" />{t('adminAi.result.goToPoint')}
      </button>
    </div>
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
      <div className={styles.axDocView} ref={ref}>
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
    return <div className={styles.axDocView}><span className="muted-sm">{t('adminAi.result.noOriginalText')}</span></div>;
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
  return <div className={styles.axDocView} ref={ref}>{content}</div>;
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
    <div className={styles.axFieldRow}>
      <div className={styles.axFieldHead}>
        <div><b>{label}:</b>{' '}
          {current != null
            ? <span>{current} <Tag>{tt('adminAi.result.correctedByHand')}</Tag></span>
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
        <div className={styles.axFieldEdit}>
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
  const docLabel = useDocumentLabel();
  // ⚠️ LO STESSO NOME CHE MOSTRA L'ARCHIVIO, composto dagli stessi ingredienti.
  // Questa schermata è il primo posto in cui si legge un documento appena
  // analizzato: se qui dicesse «2.5» e l'elenco dicesse «Altro documento
  // amministrativo», sarebbero due nomi per la stessa cosa a due minuti di
  // distanza. La differenza con il Document Hub è solo da DOVE arrivano gli
  // ingredienti: là dalla riga di `list_documents`, qui dall'analisi che si sta
  // guardando.
  const nome = docLabel(etichettaDocumento({
    titolo: document.title,
    nomeFile: document.originalFilename,
    mittente: analysis.sender,
    confidenza: analysis.confidence,
    tipoDocumento: analysis.documentType,
  }));
  const { activeCompany } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyName = activeCompany?.legalName ?? null;
  // L'attendibilità la decide `analysisTrust`, non il campo grezzo: questa
  // testata è il PRIMO posto in cui si legge un'analisi appena prodotta, ed è
  // dove il 2026-08-15 «●●● alta» copriva un sopralluogo preso per scadenza.
  // Finché il verdetto non c'è (letture in corso o fallite) non si mostra
  // niente — mai il grezzo al suo posto.
  const trust = useAnalysisTrust(analysis);
  // ⚠️⚠️ IL CANCELLO DELL'APPARTENENZA, che qui MANCAVA.
  // Il dettaglio del documento lo aveva dal 2026-08-19 e il commento accanto
  // dichiarava che valeva per «tutti i punti di creazione»: questa schermata
  // non lo ereditava, e il 2026-08-21 da una fattura intestata a una persona
  // fisica è nata un'attività vera. Ora la regola sta nel modulo puro e questa
  // pagina la dichiara; il pulsante disabilitato è la cortesia, il rifiuto di
  // `runCreateFromDocument` è la garanzia.
  const appartenenzaDubbia = trust?.unavailable === 'ownership';
  const appartenenza = appartenenzaDa(trust, 'verdetto di attendibilità non ancora disponibile');

  const isAI = analysis.engine.startsWith('claude');
  const [actions, setActions] = useState<ChecklistAction[]>(analysis.actions);
  const [highlight, setHighlight] = useState<Evidence | null>(null);
  const [reply, setReply] = useState<DocumentReply | null>(null);
  // 0010 — lingua e tono non stanno più sull'analisi: si parte dalla lingua del
  // documento e dal tono predefinito, poi vince la bozza salvata se esiste.
  // ⚠️ La lingua del DOCUMENTO non è la lingua della RISPOSTA, e da quando
  // `language` può valere `en` o `other` (2026-08-11) le due possono divergere:
  // di un documento inglese si dice la verità, ma la bozza si scrive comunque in
  // una delle tre lingue del prodotto. Il ripiego è QUI, dove si sa perché —
  // non nella validazione, dove diventava «ogni documento è italiano».
  const REPLY_LANGS = ['it', 'de', 'fr'] as const;
  const docLang = String(analysis.language ?? '');
  const defaultLang = (REPLY_LANGS as readonly string[]).includes(docLang) ? docLang : 'it';
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
        appartenenza,
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
        <div className={cx('card', styles.axHeader)}>
          <div className="ax-head-top">
            <div className="ax-title">{nome}</div>
            <div className="ax-badges"><Tag tone="alert">{t('adminAi.result.failedTitle')}</Tag></div>
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

      <div className={cx('card', styles.axHeader)}>
        <div className="ax-head-top">
          <div className="ax-title">{nome}</div>
          <div className="ax-badges">
            {r.analysisStatus === 'needs_review' && <ProvenanceMark kind="toVerify" />}
            {/* L'urgenza del documento È una priorità, e la priorità ha la sua
                famiglia: una direzione, non una pastiglia colorata. Prima erano
                tre pastiglie identiche di tre colori — la forma non diceva
                niente, lo diceva solo il colore, che è la cosa che il
                vocabolario della fiducia esiste per correggere.

                ⚠️ MA QUI LE DUE FAMIGLIE SI TOCCANO, e da sole non bastano.
                Visto in produzione il 2026-08-14, questa testata diceva
                «› media  ●●● alta»: due aggettivi nudi affiancati, e chi non ha
                ancora imparato i segni non sa quale misura cosa. Prima della
                migrazione il primo diceva «urgenza media» — la parola c'era, ed
                è stata tolta insieme alla pastiglia. Torna, ma come NOME DELLA
                FAMIGLIA, non come parola inventata qui: `marks.legend.*` è la
                stessa stringa che intesta il blocco nella legenda in fondo alla
                pagina, quindi chi legge «Priorità» qui la ritrova là.
                Altrove i due segni non si toccano e non serve: nella riga di
                un'attività l'ordine stato · priorità · termine è fisso, e nel
                dettaglio del documento stanno dentro campi già intestati. */}
            <span className={styles.axBadgePair}>
              <span className={styles.axBadgeKey}>{t('marks.legend.priority')}</span>
              <PriorityMark level={r.urgency} />
            </span>
            {/* ⚠️⚠️ QUI STAVA LA SICUREZZA FALSA. Il 2026-08-15 questa testata
                diceva «●●● alta» sopra una data che era un sopralluogo preso
                per scadenza, e il «da verificare» stava quaranta centimetri
                più in basso. Dal 2026-08-19 il livello è l'ATTENDIBILITÀ —
                il grezzo del modello abbassato dai tetti di `analysisTrust`,
                col motivo accanto — e il grezzo si legge nei dettagli tecnici
                del documento, col suo nome («confidenza di lettura»).
                ⚠️ Il caveat del termine resta un segno suo: la verifica che
                manca non è fiducia, e le due cose hanno due segni. */}
            {trust && (
              <span className={styles.axBadgePair}>
                <TrustIndicator verdict={trust} schemaVersion={analysis.schemaVersion} analysedAt={analysis.createdAt} />
                {r.deadlineRequiresVerification && r.analysisStatus !== 'needs_review'
                  && <ProvenanceMark kind="toVerify" />}
              </span>
            )}
          </div>
        </div>
        <div className="ax-meta">
          <span className="ax-chip"><Icon name="banknote" className="ic-sm" /> <b>{r.sender ?? L.authorityType('unknown')}</b>{r.senderUncertain && <ProvenanceMark kind="toVerify" />}</span>
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
        {/* ⚠️ NON più condizionata a `r.senderEvidence`: prima, senza citazione,
            qui non compariva niente — e «mittente senza appiglio nel documento»
            è un'informazione, non un vuoto. */}
        <EvidenceShown evidence={r.senderEvidence} onShow={setHighlight} />
      </div>

      {/* Callout: cosa devi fare adesso */}
      <div className={styles.axCallout}>
        <div className={styles.coIco}><Icon name="checkCircle" /></div>
        <div className={styles.coMain}>
          <div className={styles.coKicker}>{t('adminAi.result.whatToDoNow')}</div>
          <div className={styles.coAction}>{r.primaryAction ?? t('adminAi.result.fallbackAction')} <ActionOriginMark source={r.primaryActionSource} /></div>
          {/* ⚠️ Tre casi, non due. Senza scadenza ma con un appuntamento, qui
              diceva soltanto «nessuna scadenza individuata» — vero e monco: la
              data che il documento fissa esiste, e tacerla manda a cercarla
              altrove. La si nomina per quello che è. */}
          <div className={styles.coWhen}>{r.deadline
            ? <>{t('adminAi.result.by')} <b>{formatDate(r.deadline)}</b>{remaining ? ' · ' + remaining : ''}</>
            : r.appointmentDate
              ? <>{t('adminAi.result.noDeadlineFound')} · <AppointmentMark date={r.appointmentDate} display={formatDate(r.appointmentDate)} /></>
              : t('adminAi.result.noDeadlineFound')}</div>
        </div>
        {/* ⚠️ Disabilitato NON basta: un pulsante spento e muto manda a cercare
            il guasto altrove. La frase è la stessa del dettaglio del documento
            — una regola sola, una spiegazione sola. */}
        <div className={styles.coAct}>
          <button className="btn btn-primary" disabled={appartenenzaDubbia}
            onClick={() => createTask(r.primaryAction || nome)}>
            <Icon name="calendar" className="ic-sm" /> {t('adminAi.result.createTask')}
          </button>
          {appartenenzaDubbia && (
            <div className="muted-sm">{t('documents.ownership.warnGate')}</div>
          )}
        </div>
      </div>

      <div className={styles.axGrid}>
        <div className={cx(styles.axCol, styles.axDoc)}>
          <div className="card">
            <div className="card-title">
              <Icon name="document" className="ic-sm" /> {t('adminAi.result.originalDocument')}
              {isPdf && (
                <span className="gap-2" style={{ marginLeft: 'auto', display: 'inline-flex' }}>
                  <button type="button" className="btn btn-sm btn-toggle"
                    aria-pressed={docMode === 'pdf'} onClick={() => setDocMode('pdf')}>PDF</button>
                  <button type="button" className="btn btn-sm btn-toggle"
                    aria-pressed={docMode === 'text'} onClick={() => setDocMode('text')}>{t('adminAi.result.docModeText')}</button>
                </span>
              )}
            </div>
            {docMode === 'pdf' && document.storagePath
              ? <PdfViewer storagePath={document.storagePath} highlight={highlight} />
              : <DocViewer text={r.originalText} pages={r.pages} highlight={highlight} />}
          </div>
        </div>

        <div className={styles.axCol}>
          {r.deadline ? (
            <div className={`card lvl-${lvl}`}>
              <div className={styles.deadlineCard}>
                <div className={styles.dlIco}><Icon name="calendar" /></div>
                <div className={styles.dlMain}>
                  <div className={styles.dlKicker}>{t('adminAi.result.deadlineKicker')} · {L.deadlineLevel(lvl)}</div>
                  <div className={styles.dlDate}>{formatDate(r.deadline)}</div>
                  <div className={styles.dlRem}>{remaining}</div>
                </div>
                {/* ⚠️ Qui c'era una pastiglia che RIPETEVA il livello già scritto
                    nel kicker due righe sopra: colore in più, informazione in
                    meno di zero. Il termine parla con le sue cifre. */}
              </div>
              <EvidenceShown evidence={r.deadlineEvidence} onShow={setHighlight} />
              {r.deadlineRequiresVerification && (
                <div className="muted-sm mt-2">
                  <Icon name="alert" className="ic-sm" /> {r.deadlineType === 'relative'
                    ? t('adminAi.result.deadlineRelative')
                    : t('adminAi.result.deadlineIndicative')}
                </div>
              )}
            </div>
          ) : (
            <div className="card"><div className={styles.deadlineNone}><Icon name="alert" /><div><strong>{t('adminAi.result.deadlineNoneTitle')}</strong><br /><span className="muted-sm">{t('adminAi.result.deadlineNoneSub')}</span></div></div></div>
          )}

          {/* ⚠️⚠️ L'APPUNTAMENTO HA UNA SCHEDA SUA, E VIENE DOPO LA SCADENZA.
              L'ordine non è estetico: chi apre questa colonna deve leggere
              prima «nessun termine individuato» e poi «c'è un appuntamento il
              …». Invertirli rimetterebbe la data dell'evento nel posto in cui
              l'occhio cerca la scadenza — cioè il difetto del 2026-08-15 rifatto
              con due schede invece che con una.

              ⚠️ Nessun pulsante «crea attività» qui: da un appuntamento non
              nasce un termine. Se qualcosa va preparato PRIMA, la data di quel
              lavoro la decide una persona, non questa scheda — ed è esattamente
              ciò che è mancato alle tre attività datate 10.09.2026. */}
          {r.appointmentDate && (
            <div className="card">
              <div className={styles.deadlineCard}>
                <div className={styles.dlIco}><Icon name="calendar" /></div>
                <div className={styles.dlMain}>
                  <div className={styles.dlKicker}>{t('adminAi.result.appointmentKicker')}</div>
                  <div className={styles.dlDate}>{formatDate(r.appointmentDate)}</div>
                  <div className={styles.dlRem}><AppointmentMark date={r.appointmentDate} /></div>
                </div>
              </div>
              <div className="muted-sm mt-2">{t('adminAi.result.appointmentNotADeadline')}</div>
              <EvidenceShown evidence={r.appointmentEvidence} onShow={setHighlight} />
            </div>
          )}

          <div className={cx('card', styles.axActionsCard)}>
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
                    <div className="ai-text"><label htmlFor={`act-${r.id}-${c.id}`}>{c.text}</label> <ActionOriginMark source={c.sourceType} /></div>
                    <div className={styles.aiMeta}>
                      {c.sourceType === 'extracted' && c.evidence && <EvidenceButton evidence={c.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} />}
                      <button type="button" className="mini-btn" disabled={appartenenzaDubbia}
                        onClick={() => createTask(c.text)}><Icon name="calendar" className="ic-sm" /> {t('adminAi.result.addToTasks')}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* La legenda dei segni, qui dove il vocabolario è più fitto: ogni
                azione porta la sua provenienza, e questa è la pagina in cui si
                impara che cosa vuol dire un filetto pieno. È la STESSA legenda
                di Documenti, Attività e Incentivi. */}
            <MarkLegend />
          </div>

          {r.uncertainties.length ? (
            /* ⚠️ NON è un guasto: è il prodotto che dichiara ciò che non ha
               potuto determinare. Superficie neutra, segno «da verificare» —
               niente icona d'allarme, niente lista col «?» ambra in cerchio. */
            <div className="card">
              <div className="verify-note" role="note">
                <span className="vn-title"><MarkGlyph name="question" />{t('adminAi.result.needsReview')}</span>
                <ul>{r.uncertainties.map((v, i) => <li key={i}>{v}</li>)}</ul>
              </div>
            </div>
          ) : (
            trust?.level
              ? <div className="card"><div className={styles.verifyOk}><Icon name="checkCircle" className="ic-sm" /> {t('adminAi.result.mainInfoConfirmed', { level: L.confidence(trust.level) })}</div></div>
              : null
          )}

          {/* Il tag sta nella riga del titolo: quando il rischio non è
              determinabile la scheda diceva «non determinabile» su una riga
              tutta sua, occupando lo spazio di un'informazione che non c'è. */}
          {/* Il livello del rischio È una provenienza: esplicito nel documento
              (filetto pieno), inferenza (tratteggiato), non determinabile
              (puntinato «da verificare»). Le parole restano quelle del rischio;
              il filetto lo classifica nella stessa grammatica di tutto il resto. */}
          <div className="card"><div className="card-title">{t('adminAi.result.risk')}
            <span className={`mark mark-prov ${r.risk.level === 'explicit' ? 'mp-doc' : r.risk.level === 'possible' ? 'mp-inf' : 'mp-verify'}`}>
              {r.risk.level === 'explicit' ? t('adminAi.result.riskExplicit') : r.risk.level === 'possible' ? t('adminAi.result.riskInferred') : t('adminAi.result.riskUnknown')}
            </span>
          </div>
            {r.risk.level !== 'unknown' && <div className={styles.riskText}>{r.risk.text}</div>}
            <EvidenceButton evidence={r.risk.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} />
          </div>

          <div className="card"><div className="card-title">{t('adminAi.result.requestedDocumentsTitle')}</div>
            {r.requestedDocuments.length > 0 ? r.requestedDocuments.map((d, i) => (
              <div className="action-item py-2" key={i}>
                <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400 }}>{d.label}</span>
                  {d.evidence && <div className={styles.aiMeta}><EvidenceButton evidence={d.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} /></div>}
                </span>
              </div>
            )) : <span className="muted-sm">{t('adminAi.result.noRequestedDocuments')}</span>}
          </div>

          {r.amounts.length > 0 && (
            <div className="card"><div className="card-title"><Icon name="banknote" className="ic-sm" /> {t('adminAi.result.amountsFound')}</div>
              {r.amounts.map((m, i) => (
                <div className="action-item py-2" key={`amt-${i}`}>
                  <span className="ai-main">
                    <span className="ai-text"><b>{m.display}</b>{m.description ? ` — ${m.description}` : ''} <Tag>{L.amountType(m.type)}</Tag></span>
                    {/* Un importo fa partire regole di automazione e finisce in
                        una richiesta di pagamento: la sua prova sta sotto, non
                        dietro un clic. E se non c'è, si dice. */}
                    <EvidenceShown evidence={m.evidence} onShow={setHighlight} />
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
                    {ref.evidence && <div className={styles.aiMeta}><EvidenceButton evidence={ref.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} /></div>}
                  </span>
                </div>
              ))}
              {r.legalReferences.map((leg, i) => (
                <div className="action-item py-2" key={`leg-${i}`}>
                  <span className="ai-main"><span className="ai-text" style={{ fontWeight: 400 }}>{leg.text}</span>
                    {leg.evidence && <div className={styles.aiMeta}><EvidenceButton evidence={leg.evidence} label={t('adminAi.result.showInDocument')} onShow={setHighlight} /></div>}
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

          <div className={cx('card', styles.draftEditor)}>
            <div className="card-title">{t('adminAi.result.replyDraftTitle')}</div>
            <div className={styles.draftControls}>
              <div className={styles.dcField}><label htmlFor="draft-lang">{t('adminAi.result.replyLanguage')}</label>
                <select id="draft-lang" className="select-inline" value={lang} onChange={(e) => setLang(e.target.value)}>
                  {(['it', 'de', 'fr'] as const).map((k) => <option key={k} value={k}>{L.language(k)}</option>)}
                </select></div>
              <div className={styles.dcField}><label htmlFor="draft-tone">{t('adminAi.result.replyTone')}</label>
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
