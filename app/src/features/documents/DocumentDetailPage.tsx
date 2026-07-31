// ============================================================================
// Dettaglio di un documento — dove un file diventa una cosa che si capisce.
//
// La pagina mette insieme quattro cose che appartengono a moduli diversi e non
// ne copia nessuna:
//   · ciò che il documento DICE          → l'analisi di Admin AI (immutabile)
//   · ciò che una persona ha CORRETTO    → analysis_corrections
//   · da DOVE è arrivato                 → la comunicazione dell'Inbox
//   · che LAVORO ne è nato               → le attività del Work Hub
// e aggiunge l'unica parte che le appartiene davvero: dove l'azienda lo tiene.
//
// I valori mostrati in testata sono quelli EFFETTIVI — la correzione umana se
// c'è — e arrivano dalla stessa funzione del database che compone la lista, non
// da una seconda ricostruzione: due implementazioni della stessa regola col
// tempo direbbero due mittenti diversi. Accanto a ogni valore corretto resta
// visibile quello che l'analisi aveva rilevato: la correzione non cancella
// nulla, si affianca.
// ============================================================================
import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { CrmLinkPicker } from '@/features/crm/CrmLinkPicker';
import { useCrmLink } from '@/features/crm/useCrmLink';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { documentHubService } from '@/services/documentHubService';
import { documentService } from '@/services/documentService';
import { analyzeStoredDocument } from '@/features/admin-ai/analyzeStored';
import { createTaskFromDocument } from '@/features/tasks/taskFromDocument';
import { documentTaskDraft } from '@/features/tasks/documentToTask';
import { TaskCreateForm } from '@/features/tasks/TaskCreateForm';
import {
  EMPTY_TASK_FORM, taskFormSubmission, type TaskFormValues,
} from '@/features/tasks/taskCreateModel';
import { dueLabel, statusLabelKey } from '@/features/tasks/taskFormat';
import { useMembers } from '@/features/tasks/useMembers';
import { NextStepCard } from './NextStepCard';
import { nextStepFor, proposedTaskTitle } from './nextStep';
import { formatBytes, formatCurrency, formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { CATEGORIES } from './documentModel';
import type { AnalysisCorrection, DocumentCategory, DocumentDetail, DocumentTag } from '@/types/models';
import { AskAbout } from '@/features/assistant/AskAbout';

const TECH_METHOD_KEY: Record<string, TKey> = {
  native_pdf: 'documents.techMethods.native_pdf',
  ocr: 'documents.techMethods.ocr',
  text: 'documents.techMethods.text',
};

/** Il valore dell'analisi come testo, per poterlo mostrare accanto alla correzione. */
function aiValueOf(corrections: AnalysisCorrection[], field: string): string | null {
  const c = corrections.find((x) => x.field === field);
  if (!c) return null;
  const v = c.originalAiValue;
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

export function DocumentDetailPage() {
  const t = useT();
  const L = useLabels();
  const { locale } = useI18n();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { activeCompanyId, activeCompany, isAdmin } = useCompany();
  // 0026 — la controparte di cui questo documento parla.
  const crmLink = useCrmLink('document', activeCompanyId, id);
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;

  const { loading, error, data, reload } = useAsync<{
    detail: DocumentDetail | null; allTags: DocumentTag[];
  }>(async () => {
    const [detail, allTags] = await Promise.all([
      documentHubService.get(id, companyId),
      documentHubService.listTags(companyId),
    ]);
    return { detail, allTags };
  }, [id, companyId]);

  // La rubrica dell'azienda: `profiles` è leggibile solo dal proprietario,
  // quindi il nome di un collega arriva da qui e non da un join.
  const { members, byId: membersById } = useMembers();
  /** Il responsabile di un'attività. Senza responsabile è «Non assegnata». */
  function assigneeName(userId: string | null): string {
    if (!userId) return t('tasks.unassigned');
    const m = membersById.get(userId);
    if (!m) return t('tasks.eventUnknownActor');
    return m.name || t('tasks.unnamedMember');
  }

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [armedDelete, setArmedDelete] = useState(false);

  const detail = data?.detail ?? null;
  const item = detail?.item ?? null;

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { showToast(toUserMessage(e)); } finally { setBusy(false); }
  }

  async function openFile() {
    if (!detail?.document.storagePath) { showToast(t('documents.fileUnavailable')); return; }
    await withBusy(async () => {
      // URL firmato di breve durata: il bucket resta privato e nessun
      // indirizzo permanente esce dall'applicazione.
      const url = await documentService.getSignedUrl(detail.document.storagePath as string, 120);
      window.open(url, '_blank', 'noopener');
    });
  }

  async function analyze() {
    if (!detail) return;
    setBusy(true);
    setProgress(t('documents.analyzeNow'));
    try {
      // Stessa pipeline di Admin AI e dell'Inbox: non esiste un terzo modo di
      // analizzare un documento in questo prodotto.
      await analyzeStoredDocument({
        document: detail.document,
        companyName: activeCompany?.legalName ?? null,
        outputLanguage: locale,
        onProgress: setProgress,
      });
      reload();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // ---- da documento ad attività, CON un passaggio di revisione -------------
  // Prima si creava di colpo: chi premeva «Crea attività» scopriva soltanto
  // dopo quale titolo, quale scadenza e quale priorità erano finiti
  // nell'attività — e se la scadenza era una di quelle che l'analisi dichiara
  // da verificare, se ne accorgeva a cose fatte. Ora i valori si vedono prima,
  // e sono gli stessi che verranno salvati perché li calcola `documentTaskDraft`,
  // cioè la funzione che poi scrive davvero.
  const [taskForm, setTaskForm] = useState<TaskFormValues | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [createdTask, setCreatedTask] = useState<{ id: string; steps: number; stepsFailed: boolean } | null>(null);
  const tasksCardRef = useRef<HTMLDivElement>(null);
  // ⚠️ Il fuoco torna al pulsante che POSSIEDE il modulo — quello nella scheda
  // «Attività» — e non a quello che è stato premuto: il modulo può essere
  // aperto anche dal riquadro in cima, e riportare il fuoco lassù lo
  // allontanerebbe da dove il lavoro sta avvenendo. Serve un ref di CALLBACK e
  // non un `useRef`: mentre il modulo è aperto quel pulsante non esiste, e
  // chiamare `.focus()` subito dopo aver chiuso troverebbe un nodo non ancora
  // montato — un fallimento silenzioso, che è precisamente il modo in cui una
  // regola di accessibilità smette di funzionare senza che nessuno se ne accorga.
  const [refocusOnClose, setRefocusOnClose] = useState(false);
  const createTaskButtonRef = useCallback((el: HTMLButtonElement | null) => {
    if (el && refocusOnClose) { el.focus(); setRefocusOnClose(false); }
  }, [refocusOnClose]);

  function openTaskForm() {
    if (!detail || !user) return;
    // I valori iniziali NON si ricostruiscono qui: si chiedono alla funzione
    // che li userà per scrivere. Due derivazioni della stessa cosa prima o poi
    // mostrano una priorità e ne salvano un'altra.
    const draft = documentTaskDraft({
      companyId,
      userId: user.id,
      documentId: detail.document.id,
      title: proposedTaskTitle(detail),
      analysis: detail.analysis,
      // Valori EFFETTIVI: se una persona ha corretto il mittente o la scadenza,
      // il modulo mostra il dato corretto, non quello che l'AI aveva letto.
      authority: detail.item.sender,
      dueDate: detail.item.deadline,
    });
    setTaskForm({
      ...EMPTY_TASK_FORM,
      title: draft.payload.title,
      // `<input type="date">` vuole `YYYY-MM-DD` e niente altro.
      dueDate: (draft.payload.dueDate ?? '').slice(0, 10),
      priority: draft.payload.priority ?? '',
    });
    setTaskError(null);
    setCreatedTask(null);
    tasksCardRef.current?.scrollIntoView({ block: 'nearest' });
  }

  function closeTaskForm() {
    setTaskForm(null);
    setTaskError(null);
    // Non si chiama `.focus()` qui: il pulsante non è ancora tornato nel DOM.
    // Lo farà il suo ref di callback quando si rimonta.
    setRefocusOnClose(true);
  }

  async function submitTaskForm() {
    if (!detail || !user || !taskForm || savingTask) return;
    const values = taskFormSubmission(taskForm);
    if (!values.title.trim()) return;
    setSavingTask(true);
    setTaskError(null);
    try {
      const outcome = await createTaskFromDocument({
        companyId,
        userId: user.id,
        documentId: detail.document.id,
        title: values.title,
        analysis: detail.analysis,
        authority: detail.item.sender,
        dueDate: values.dueDate,
        priority: values.priority,
        assigneeUserId: values.assigneeUserId,
      });
      // Il modulo si chiude: un secondo invio da questa apertura non è più
      // possibile. L'esito resta a schermo con il collegamento all'attività,
      // perché cercarla in «Attività» sarebbe lavoro in più per una cosa
      // appena fatta.
      setTaskForm(null);
      setCreatedTask({ id: outcome.task.id, steps: outcome.steps, stepsFailed: outcome.stepsFailed });
      reload();
    } catch (e) {
      // Il guasto resta accanto al modulo, che resta aperto: quello che la
      // persona aveva scritto non si perde e si può riprovare.
      setTaskError(toUserMessage(e));
    } finally {
      setSavingTask(false);
    }
  }

  async function setCategory(category: DocumentCategory | null) {
    await withBusy(async () => {
      await documentHubService.setCategory(id, category);
      showToast(t('documents.saved'));
      // Si rilegge invece di aggiornare a mano: l'origine della categoria
      // («automatico» o «impostato a mano») la decide il database, e indovinarla
      // qui vorrebbe dire raccontare una storia parallela a quella vera.
      reload();
    });
  }

  async function addTag() {
    const name = newTag.trim();
    if (!name || !detail) return;
    await withBusy(async () => {
      // Un'etichetta con lo stesso nome, a parte le maiuscole, è la stessa
      // etichetta: si riusa invece di crearne una gemella.
      const existing = (data?.allTags ?? []).find(
        (tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      const tag = existing ?? await documentHubService.createTag(companyId, name);
      await documentHubService.attachTag(companyId, id, tag.id);
      setNewTag('');
      reload();
    });
  }

  async function removeTag(tagId: string) {
    await withBusy(async () => {
      await documentHubService.detachTag(id, tagId);
      reload();
    });
  }

  async function saveTitle() {
    if (title === null || !detail || title.trim() === detail.document.title) { setTitle(null); return; }
    await withBusy(async () => {
      await documentHubService.rename(id, title);
      setTitle(null);
      showToast(t('documents.saved'));
      reload();
    });
  }

  async function saveNotes() {
    if (notes === null) return;
    await withBusy(async () => {
      await documentHubService.setNotes(id, notes);
      setNotes(null);
      showToast(t('documents.saved'));
      reload();
    });
  }

  async function toggleArchive() {
    if (!detail) return;
    await withBusy(async () => {
      const archived = !!detail.document.archivedAt;
      if (archived) await documentHubService.restore(id);
      else await documentHubService.archive(id);
      showToast(archived ? t('documents.restoreDone') : t('documents.archiveDone'));
      reload();
    });
  }

  async function removeForever() {
    if (!detail) return;
    await withBusy(async () => {
      const outcome = await documentService.remove(detail.document);
      // Se il file è rimasto in archiviazione lo si DICE: riportare un successo
      // pieno quando metà dell'operazione non è riuscita sarebbe un fallback
      // silenzioso.
      showToast(outcome.storageOrphan ? t('documents.deletedOrphan') : t('documents.deleted'));
      navigate('/documenti');
    });
  }

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!detail || !item) {
    return (
      <>
        <div className="page-head">
          <Link className="btn btn-sm btn-ghost mb-8" to="/documenti">
            <Icon name="arrowLeft" className="ic-sm" /> {t('documents.back')}
          </Link>
          <div className="page-title">{t('documents.notFound')}</div>
          <div className="page-desc">{t('documents.notFoundSub')}</div>
        </div>
      </>
    );
  }

  const doc = detail.document;
  const analysis = detail.analysis;
  const archived = !!doc.archivedAt;
  // Chi può cancellare per sempre: chi amministra l'azienda, oppure chi ha
  // caricato personalmente il documento. È la stessa regola della policy del
  // database — qui si nasconde un pulsante, là si impedisce l'operazione.
  const canDelete = isAdmin || (!!doc.uploadedBy && doc.uploadedBy === user?.id);
  // Che cosa conviene fare adesso. La decisione è una funzione PURA e vive in
  // `nextStep.ts`: una guardia di questo tipo si sbaglia in silenzio — propone
  // la cosa sbagliata e non lo dice nessuno.
  const step = nextStepFor(detail);
  // §40 — le azioni dell'analisi e le attività sono cose diverse, e dopo la
  // conversione non esiste un collegamento fra le due liste. Perciò questo
  // avviso compare SOLO quando non è nata nessuna attività da questo documento:
  // è l'unico caso in cui la deduzione è certa.
  const actionsNotConverted = detail.tasks.length === 0 ? step.facts.openActions : 0;

  return (
    <>
      <div className="page-head">
        <Link className="btn btn-sm btn-ghost mb-8" to="/documenti">
          <Icon name="arrowLeft" className="ic-sm" /> {t('documents.back')}
        </Link>
        <div className="page-title">{doc.title}</div>
        <div className="page-desc">
          {(() => {
            // Categoria e tipo possono avere la STESSA etichetta («Assicurazioni
            // sociali» in entrambe): stamparle di fila fa sembrare rotta la
            // pagina. Stessa regola della riga di lista, in un posto solo
            // sarebbe stato meglio — qui i due valori arrivano da fonti diverse.
            const cat = item.category ? L.category(item.category) : t('documents.uncategorized');
            const tipo = item.documentType ? L.docType(item.documentType) : null;
            return [
              cat,
              tipo && tipo !== cat ? tipo : null,
              formatDate(item.documentDate ?? doc.createdAt),
              t(`documents.sources.${doc.sourceType}` as TKey),
            ].filter(Boolean).join(' · ');
          })()}
        </div>
        <div className="row-wrap mt-12">
          {/* §120 — la domanda parte dalla scheda che si sta guardando. */}
          <AskAbout type="document" id={doc.id} label={doc.title} />
        </div>
      </div>

      {archived && (
        <div className="info-box" role="status">
          <Icon name="archive" className="ic-sm" /> {t('documents.archivedNotice')}
          {doc.archivedAt ? ` ${t('documents.archivedOn', { date: formatDate(doc.archivedAt) })}` : ''}
        </div>
      )}

      <div className="row-wrap mt-12">
        {doc.storagePath && (
          <button className="btn btn-primary" onClick={() => void openFile()} disabled={busy}>
            <Icon name="eye" className="ic-sm" /> {t('documents.openFile')}
          </button>
        )}
        {analysis && (
          <Link className="btn" to={`/admin?doc=${doc.id}`}>
            <Icon name="fileSearch" className="ic-sm" /> {t('documents.openAnalysis')}
          </Link>
        )}
        <button className="btn" onClick={() => void toggleArchive()} disabled={busy}>
          <Icon name="archive" className="ic-sm" /> {archived ? t('documents.restore') : t('documents.archive')}
        </button>
      </div>

      {/* ---- Origine: da dove è arrivato. Sta subito sotto l'intestazione
           perché «che cos'è questo documento» viene prima di «che cosa devo
           farne»: senza sapere da quale comunicazione è nato, il resto della
           pagina è un foglio senza mittente. ---------------------------- */}
      <div className="card mt-16">
        <div className="card-title">{t('documents.origin')}</div>
        {doc.sourceType === 'email' || detail.emails.length > 0 ? (
          detail.emails.length === 0 ? (
            <div className="muted-sm">{t('documents.sources.email')}</div>
          ) : (
            detail.emails.map((mail) => (
              <div className="list-row" key={`${mail.messageId}-${mail.relation}`}>
                <div className="list-main">
                  <div className="list-title">{mail.subject || t('documents.sources.email')}</div>
                  <div className="list-sub">
                    {[
                      mail.senderName || mail.senderEmail,
                      formatDate(mail.receivedAt),
                      mail.relation === 'attachment' ? t('documents.originAttachment') : t('documents.originBody'),
                      mail.accountEmail ? t('documents.originAccount', { email: mail.accountEmail }) : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Link className="btn btn-sm" to={`/inbox?msg=${mail.messageId}`}>{t('documents.openInInbox')}</Link>
              </div>
            ))
          )
        ) : (
          <div className="muted-sm">
            {doc.sourceType === 'pasted_text'
              ? t('documents.originText')
              : t('documents.originUploadUnknown')}
            {' · '}{t('documents.originOn', { date: formatDate(doc.createdAt) })}
          </div>
        )}
        {detail.sameContentIds.length > 0 && (
          <div className="info-box mt-12">
            <div><b>{t('documents.sameContent')}</b></div>
            <div className="muted-sm">{t('documents.sameContentSub')}</div>
            <Link className="btn btn-sm mt-8" to={`/documenti/${detail.sameContentIds[0]}`}>
              {t('documents.sameContentOpen')}
            </Link>
          </div>
        )}
      </div>

      {/* ---- Prossimo passo -------------------------------------------
           Sta QUI, sopra l'analisi, perché è la domanda a cui una persona
           vuole rispondere aprendo un documento: che cosa devo fare? Non
           introduce dati nuovi — legge quelli che la pagina ha già — e
           mette in primo piano UNA azione sola. -------------------- */}
      <NextStepCard
        step={step}
        documentId={doc.id}
        busy={busy}
        progress={progress}
        onAnalyze={() => void analyze()}
        onCreateTask={openTaskForm}
      />

      {/* ---- Analisi ---------------------------------------------------- */}
      <div className="card mt-16">
        <div className="card-title">{t('documents.analysis')}</div>

        {item.lastAttemptFailed && (
          <div className="warn-box" role="status">{t('documents.lastAttemptFailed')}</div>
        )}

        {item.state === 'none' && (
          <div className="empty">
            <div>{t('documents.analysisNone')}</div>
            <div className="muted-sm mt-10">{t('documents.analysisNoneSub')}</div>
            <button className="btn btn-sm btn-primary mt-10" onClick={() => void analyze()} disabled={busy}
              aria-busy={busy || undefined}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null} {progress ?? t('documents.analyzeNow')}
            </button>
          </div>
        )}

        {item.state === 'processing' && (
          <div className="muted-sm" role="status">{t('documents.analysisProcessing')}</div>
        )}

        {item.state === 'failed' && (
          <div className="empty">
            {/* Un'analisi fallita NON si racconta come un risultato: niente
                mittente, niente tipo, niente scadenza — sarebbero valori di
                ripiego, non dati estratti da questo documento. */}
            <div>{analysis?.errorMessageSafe ?? t('documents.analysisFailedSub')}</div>
            <button className="btn btn-sm mt-10" onClick={() => void analyze()} disabled={busy}
              aria-busy={busy || undefined}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null} {progress ?? t('documents.retryAnalysis')}
            </button>
          </div>
        )}

        {(item.state === 'analyzed' || item.state === 'to_verify' || item.lastAttemptFailed) && (
          <>
            <dl className="detail-list">
              <Field label={t('documents.sender')} value={item.sender}
                corrected={item.senderCorrected} aiValue={aiValueOf(detail.corrections, 'sender')} />
              <Field label={t('documents.documentType')} value={item.documentType ? L.docType(item.documentType) : null}
                corrected={item.documentTypeCorrected} aiValue={aiValueOf(detail.corrections, 'document_type')} />
              <Field label={t('documents.documentDate')} value={item.documentDate ? formatDate(item.documentDate) : null} />
              <Field
                label={t('documents.deadline')}
                // §36 — se l'analisi dichiara che la scadenza va verificata, non
                // la si presenta come un fatto: si dice che va verificata.
                value={item.deadline
                  ? `${formatDate(item.deadline)}${item.deadlineRequiresVerification ? ` · ${t('documents.deadlineToVerify')}` : ''}`
                  : null}
                corrected={item.deadlineCorrected} aiValue={aiValueOf(detail.corrections, 'deadline')} />
              <Field label={t('documents.amount')} value={formatCurrency(item.amount, item.amountCurrency)}
                corrected={item.amountCorrected} aiValue={aiValueOf(detail.corrections, 'amount')} />
              {analysis?.referenceNumbers.length ? (
                <Field label={t('documents.references')}
                  value={analysis.referenceNumbers.map((r) => `${r.label ? `${r.label}: ` : ''}${r.value}`).join(' · ')} />
              ) : null}
              <Field label={t('documents.confidence')} value={item.confidence ? L.confidence(item.confidence) : null} />
            </dl>

            {analysis?.summary && <p className="muted-sm">{analysis.summary}</p>}

            {analysis && analysis.uncertaintyItems.length > 0 && (
              <div className="warn-box">
                <b>{t('documents.uncertainties')}</b>
                <ul>
                  {analysis.uncertaintyItems.map((u, i) => <li key={i}>{u.description}</li>)}
                </ul>
              </div>
            )}

            <Link className="btn btn-sm mt-10" to={`/admin?doc=${doc.id}`}>
              {t('documents.openAnalysis')} <Icon name="arrowRight" className="ic-sm" />
            </Link>
          </>
        )}
      </div>

      {/* ---- Attività ---------------------------------------------------- */}
      <div className="card mt-16" id="doc-tasks" ref={tasksCardRef}>
        <div className="card-title">{t('documents.tasks')}</div>

        {/* L'esito della creazione appena fatta. Resta a schermo con il
            collegamento: cercare in «Attività» una cosa creata un istante fa
            sarebbe lavoro in più. ⚠️ Se i passaggi non sono stati aggiunti NON
            si dichiara un successo pieno — l'attività c'è ed è raggiungibile,
            la checklist no, e sono due fatti diversi. */}
        {createdTask && (
          <div className={createdTask.stepsFailed ? 'warn-box' : 'info-box'} role="status">
            <div>
              {createdTask.stepsFailed ? t('documents.taskCreatedStepsFailed')
                : createdTask.steps ? t('documents.taskCreatedWithSteps', { n: createdTask.steps })
                : t('documents.taskCreated')}
            </div>
            <Link className="btn btn-sm btn-primary mt-8" to={`/attivita/${createdTask.id}`}>
              <Icon name="arrowRight" className="ic-sm" /> {t('documents.taskForm.openCreated')}
            </Link>
          </div>
        )}

        {detail.tasks.length === 0 && <div className="muted-sm">{t('documents.tasksNone')}</div>}
        {detail.tasks.map((task) => {
          const due = dueLabel(task.dueDate);
          return (
            <Link className="list-row is-link" to={`/attivita/${task.id}`} key={task.id}>
              <div className="list-main">
                <div className="list-title">{task.title}</div>
                <div className="list-sub">
                  {[assigneeName(task.assigneeUserId), t(statusLabelKey(task.status)), t(due.key, due.params)]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="badge badge-neutral">{t('documents.openTask')}</span>
            </Link>
          );
        })}
        {actionsNotConverted > 0 && (
          <div className="muted-sm mt-10">
            {actionsNotConverted === 1
              ? t('documents.actionsNotConvertedOne')
              : t('documents.actionsNotConvertedMany', { n: actionsNotConverted })}
          </div>
        )}
        {/* ---- revisione prima di creare -------------------------------- */}
        {taskForm ? (
          <div className="mt-10">
            <div className="card-title">{t('documents.taskForm.title')}</div>
            <p className="muted-sm">{t('documents.taskForm.intro')}</p>
            <p className="muted-sm">
              <b>{t('documents.taskForm.linkedDocument')}</b> — {doc.title}
            </p>
            {/* Le stesse avvertenze del riquadro in cima, accanto ai campi:
                qui è dove si sta per decidere, e chi apre il modulo dal
                fondo della pagina non le ha necessariamente lette. */}
            {step.notices.length > 0 && (
              <ul className="stack-sm muted-sm">
                {step.notices.map((n) => <li key={n.key}>{t(n.key, n.params)}</li>)}
              </ul>
            )}
            <TaskCreateForm
              idPrefix="doc-task"
              values={taskForm}
              onChange={setTaskForm}
              onSubmit={() => void submitTaskForm()}
              onCancel={closeTaskForm}
              saving={savingTask}
              error={taskError}
              members={members}
              submitLabel={t('documents.createTask')}
              autoFocus
            />
          </div>
        ) : (
          <button ref={createTaskButtonRef} className="btn btn-sm mt-10"
            onClick={openTaskForm} disabled={busy || !step.canCreateTask}>
            <Icon name="plus" className="ic-sm" />
            {' '}{detail.tasks.length ? t('documents.nextStep.actionCreateAnother') : t('documents.createTask')}
          </button>
        )}
        {/* §79 — da un documento di categoria «contratti» si arriva ai Contratti.
            ⚠️ NON si crea niente da soli: il pulsante porta al modulo di
            creazione con il documento già scelto, e a decidere è una persona
            (§80: un candidato non si dichiara attivo da sé). */}
        {doc.category === 'contracts' && (
          <Link className="btn btn-sm mt-10" to={`/contratti/nuovo?documento=${doc.id}`}>
            <Icon name="fileSignature" className="ic-sm" /> {t('contracts.create.fromDocument')}
          </Link>
        )}
      </div>

      {/* §75 e §146 — i Documenti restano la memoria documentale; il CRM
          aggiunge di CHI parla quel documento. Il mittente effettivo — analisi
          più correzioni — resta del Document Hub e si mostra accanto. */}
      <CrmLinkPicker
        linkedId={crmLink.linked?.id ?? null}
        linkedName={crmLink.linked?.displayName ?? null}
        extractedName={item.sender}
        onLink={crmLink.link}
        onUnlink={crmLink.unlink}
        disabled={busy}
      />

      {/* ---- Organizzazione ---------------------------------------------- */}
      <div className="card mt-16">
        <div className="card-title">{t('documents.organization')}</div>
        <div className="muted-sm">{t('documents.organizationHint')}</div>

        <div className="grid-2 mt-12">
          <div className="field">
            <label htmlFor="doc-category">{t('documents.category')}</label>
            <select id="doc-category" value={doc.category ?? ''} disabled={busy}
              onChange={(e) => void setCategory((e.target.value || null) as DocumentCategory | null)}>
              <option value="">{t('documents.uncategorized')}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{L.category(c)}</option>)}
            </select>
            {doc.category && (
              <div className="muted-sm">
                {doc.categorySource === 'manual' ? t('documents.categoryManual') : t('documents.categoryAuto')}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="doc-title">{t('documents.titleField')}</label>
            <input id="doc-title" value={title ?? doc.title} disabled={busy}
              onChange={(e) => setTitle(e.target.value)} onBlur={() => void saveTitle()} />
            <div className="muted-sm">{t('documents.titleHint')}</div>
          </div>
        </div>

        <div className="field">
          <span className="group-label">{t('documents.tags')}</span>
          <div className="row-wrap">
            {detail.tags.length === 0 && <span className="muted-sm">{t('documents.tagsNone')}</span>}
            {detail.tags.map((tag) => (
              <span className="doc-tag" key={tag.id}>
                {tag.name}
                <button type="button" className="doc-tag-x" disabled={busy}
                  onClick={() => void removeTag(tag.id)}
                  aria-label={t('documents.tagRemoveAria', { name: tag.name })}>
                  <Icon name="close" className="ic-sm" />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="row-wrap">
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            {/* La lista delle etichette esistenti è un `datalist`: propone senza
                impedire di scriverne una nuova, e non richiede un componente di
                completamento automatico tutto da rendere accessibile. */}
            <input id="doc-newtag" list="doc-tag-options" value={newTag} disabled={busy}
              onChange={(e) => setNewTag(e.target.value)}
              aria-label={t('documents.addTag')} placeholder={t('documents.tagPlaceholder')} />
            <datalist id="doc-tag-options">
              {(data?.allTags ?? []).map((tag) => <option key={tag.id} value={tag.name} />)}
            </datalist>
          </div>
          <button className="btn btn-sm" onClick={() => void addTag()} disabled={busy || !newTag.trim()}>
            <Icon name="plus" className="ic-sm" /> {t('documents.addTag')}
          </button>
        </div>

        <div className="field mt-12">
          <label htmlFor="doc-notes">{t('documents.notes')}</label>
          <textarea id="doc-notes" rows={3} value={notes ?? doc.internalNotes ?? ''} disabled={busy}
            onChange={(e) => setNotes(e.target.value)} placeholder={t('documents.notesPlaceholder')} />
          <div className="muted-sm">{t('documents.notesHint')}</div>
          {notes !== null && (
            <button className="btn btn-sm mt-8" onClick={() => void saveNotes()} disabled={busy}>
              {t('documents.save')}
            </button>
          )}
          {notes === null && doc.notesUpdatedAt && (
            <div className="muted-sm">{t('documents.notesUpdated', { date: formatDate(doc.notesUpdatedAt) })}</div>
          )}
        </div>
      </div>

      {/* ---- Informazioni tecniche --------------------------------------- */}
      <details className="card mt-16">
        <summary className="card-title">{t('documents.technical')}</summary>
        <dl className="detail-list mt-10">
          <Field label={t('documents.techFilename')} value={doc.originalFilename} />
          <Field label={t('documents.techSize')} value={doc.fileSize ? formatBytes(doc.fileSize) : null} />
          <Field label={t('documents.techPages')} value={doc.pageCount ? String(doc.pageCount) : null} />
          <Field label={t('documents.techImported')} value={formatDate(doc.createdAt)} />
          {detail.technical && (
            <>
              <Field label={t('documents.techMethod')}
                value={detail.technical.extractionMethod
                  ? t(TECH_METHOD_KEY[detail.technical.extractionMethod] ?? 'documents.techMethods.text')
                  : null} />
              <Field label={t('documents.techOcr')}
                value={detail.technical.ocrConfidence !== null
                  ? `${Math.round(detail.technical.ocrConfidence * 100)}%` : null} />
              <Field label={t('documents.techProvider')} value={detail.technical.provider ?? detail.technical.engine} />
              <Field label={t('documents.techModel')} value={detail.technical.model} />
              <Field label={t('documents.techPrompt')} value={detail.technical.promptVersion} />
              <Field label={t('documents.techAnalysedAt')}
                value={detail.technical.analysisCreatedAt ? formatDate(detail.technical.analysisCreatedAt) : null} />
            </>
          )}
        </dl>
        {detail.technical?.truncated && (
          <div className="warn-box">{t('documents.techTruncated')}</div>
        )}
      </details>

      {/* ---- Eliminazione definitiva -------------------------------------
          Separata da «Archivia» e in fondo: archiviare è la cosa che si fa
          tutti i giorni, cancellare è quella che non si può disfare. */}
      <div className="card mt-16">
        <div className="card-title">{t('documents.dangerZone')}</div>
        {!canDelete ? (
          <div className="muted-sm">{t('documents.deleteNotAllowed')}</div>
        ) : (
          <>
            <div className="muted-sm">{t('documents.deleteExplain')}</div>
            {armedDelete ? (
              <div className="row-wrap mt-10">
                <span>{t('documents.deleteAsk')}</span>
                <button className="btn btn-sm btn-danger" onClick={() => void removeForever()} disabled={busy}
                  aria-busy={busy || undefined}>
                  {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('documents.deleteConfirm')}
                </button>
                <button className="btn btn-sm" onClick={() => setArmedDelete(false)}>{t('common.cancel')}</button>
              </div>
            ) : (
              <button className="btn btn-sm btn-danger mt-10" onClick={() => setArmedDelete(true)}>
                <Icon name="trash" className="ic-sm" /> {t('documents.deleteConfirm')}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Una riga di scheda. Quando il valore è stato corretto da una persona lo dice,
 * e mostra accanto quello che l'analisi aveva rilevato: la correzione non
 * cancella l'originale, gli si affianca — l'analisi resta verificabile.
 */
function Field({
  label, value, corrected, aiValue,
}: { label: string; value: string | null; corrected?: boolean; aiValue?: string | null }) {
  const t = useT();
  if (!value && !corrected) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value ?? '—'}
        {corrected && (
          <>
            {' '}<span className="badge badge-blue">{t('documents.correctedBadge')}</span>
            <div className="muted-sm">
              {aiValue ? t('documents.aiValue', { value: aiValue }) : t('documents.aiValueEmpty')}
            </div>
          </>
        )}
      </dd>
    </>
  );
}
