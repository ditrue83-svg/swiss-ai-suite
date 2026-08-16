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
import { Tag } from '@/components/ui/Tag';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { CrmLinkPicker } from '@/features/crm/CrmLinkPicker';
import { useCrmLink } from '@/features/crm/useCrmLink';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/ActionMenu';
import { PrintSheet } from '@/features/print/PrintSheet';
import { amountTypeKey, buildFooter, collectCitations, deadlineKindKey, splitActions } from '@/features/print/printModel';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { documentHubService } from '@/services/documentHubService';
import { documentService } from '@/services/documentService';
import { analyzeStoredDocument } from '@/features/admin-ai/analyzeStored';
import { createTaskFromDocument } from '@/features/tasks/taskFromDocument';
import { documentTaskDraft } from '@/features/tasks/documentToTask';
import { TaskCreateForm } from '@/features/tasks/TaskCreateForm';
import {
  EMPTY_TASK_FORM, createSubmitLatch, taskFormSubmission, type TaskFormValues,
} from '@/features/tasks/taskCreateModel';
import { dueLabel, statusLabelKey, taskDateKind } from '@/features/tasks/taskFormat';
import { useMembers } from '@/features/tasks/useMembers';
import { NextStepCard, NextStepPrimary, NextStepSecondary, type NextStepActionProps } from './NextStepCard';
import { nextStepFor, proposedTaskTitle } from './nextStep';
import { formatBytes, formatCurrency, formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { useDocumentLabel } from '@/i18n/documentLabel';
import { etichettaComposta } from '@/lib/documentTitle';
import { CATEGORIES } from './documentModel';
import { EvidenceLink } from '@/components/ui/EvidenceLink';
import { ConfidenceBadge } from '@/components/ui/ConfidenceBadge';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import { AppointmentMark } from '@/components/ui/AppointmentMark';
import { MarkGlyph } from '@/components/ui/MarkGlyph';
import { ActionOriginMark, ProvenanceMark } from '@/components/ui/ProvenanceMark';
import { MarkLegend } from '@/components/ui/MarkLegend';
import type { AnalysisCorrection, Confidence, DocumentCategory, DocumentDetail, DocumentTag, Evidence } from '@/types/models';
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
  const docLabel = useDocumentLabel();
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
  // ⚠️ Il guardiano del doppio invio è QUESTO, non `savingTask`: uno stato
  // React due clic nello stesso tick lo leggono entrambi a `false`, e il
  // 2026-07-31 due clic ravvicinati hanno creato due attività identiche a 14
  // millisecondi di distanza sul database vero. Il fermo qui cambia
  // nell'istante del primo clic.
  const latch = useRef(createSubmitLatch());
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
      title: proposedTaskTitle(detail, docLabel(detail.item.label)),
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
    if (!detail || !user || !taskForm) return;
    const values = taskFormSubmission(taskForm);
    if (!values.title.trim()) return;
    if (!latch.current.tryAcquire()) return;
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
        // ⚠️ `appointmentDate` NON si passa: non è un campo del modulo, e la
        // derivazione lo prende dall'analisi. Passarlo da qui vorrebbe dire
        // che qualcuno lo ha digitato — cioè inventato.
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
      latch.current.release();
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
  // ⚠️ IL NOME MOSTRATO e il TITOLO GREZZO sono due cose diverse, e qui
  // convivono di proposito: `nome` è ciò che si legge in cima, in stampa e nel
  // modulo attività; `doc.title` resta il valore del database, che il campo
  // «Titolo» dell'organizzazione deve poter modificare. Se una persona ci
  // scrive dentro qualcosa di leggibile, la regola smette di intervenire da
  // sola — il titolo scritto a mano vince sempre.
  const nome = docLabel(detail.item.label);
  // Il residuo, quando c'è: serve a RICONOSCERE il documento, mai a descriverlo.
  // ⚠️ PRIMA IL NOME DEL FILE, poi il titolo grezzo: la frase dice «nel file», e
  // con l'ordine inverso mostrava «nel file: 2.5» — cioè il titolo — mentre il
  // file si chiama `2.5.pdf`. Visto a schermo, non leggendo il codice.
  const grezzo = (doc.originalFilename ?? '').trim() || (doc.title ?? '').trim() || null;
  const archived = !!doc.archivedAt;
  // Chi può cancellare per sempre: chi amministra l'azienda, oppure chi ha
  // caricato personalmente il documento. È la stessa regola della policy del
  // database — qui si nasconde un pulsante, là si impedisce l'operazione.
  const canDelete = isAdmin || (!!doc.uploadedBy && doc.uploadedBy === user?.id);
  // Che cosa conviene fare adesso. La decisione è una funzione PURA e vive in
  // `nextStep.ts`: una guardia di questo tipo si sbaglia in silenzio — propone
  // la cosa sbagliata e non lo dice nessuno.
  const step = nextStepFor(detail, nome);
  // §40 — le azioni dell'analisi e le attività sono cose diverse, e dopo la
  // conversione non esiste un collegamento fra le due liste. Perciò questo
  // avviso compare SOLO quando non è nata nessuna attività da questo documento:
  // è l'unico caso in cui la deduzione è certa.
  const actionsNotConverted = detail.tasks.length === 0 ? step.facts.openActions : 0;

  // I comandi che rendono l'azione del prossimo passo, in UN posto solo. Prima
  // il riquadro «Prossimo passo» aveva la sua riga di pulsanti e la testata ne
  // aveva un'altra: due punti che rendono la stessa decisione prima o poi ne
  // rendono due diverse.
  const stepActions: NextStepActionProps = {
    step, documentId: doc.id, busy, progress,
    onAnalyze: () => void analyze(),
    onCreateTask: openTaskForm,
  };

  // ---- il menu di trabocco --------------------------------------------------
  // Qui dentro finisce ciò che è raro o irreversibile. ⚠️ Nessuna di queste voci
  // deve poter competere con la primaria: non sono pulsanti, sono righe di un
  // menu che si apre solo se lo si chiede.
  const menuItems: ActionMenuItem[] = [
    {
      key: 'archive',
      label: archived ? t('documents.restore') : t('documents.archive'),
      icon: 'archive',
      disabled: busy,
      onSelect: () => void toggleArchive(),
    },
  ];
  // ⚠️ Il comando di stampa compare SOLO quando c'è un'analisi: stampare un
  // documento non analizzato produrrebbe un foglio d'archivio senza niente
  // dentro, e un foglio vuoto in un fascicolo sembra un'analisi che non ha
  // trovato nulla.
  if (analysis && analysis.analysisStatus !== 'failed') {
    menuItems.push({
      key: 'print',
      label: t('print.button.label'),
      icon: 'document',
      onSelect: () => window.print(),
    });
  }
  // La voce resta VISIBILE anche a chi non può cancellare, spenta e con il
  // motivo accanto: un comando che sparisce non si distingue da un comando che
  // non esiste, e la differenza qui è «non ti è permesso», che è un'informazione.
  menuItems.push({
    key: 'delete',
    label: t('documents.deleteConfirm'),
    icon: 'trash',
    danger: true,
    disabled: !canDelete || busy,
    hint: canDelete ? undefined : t('documents.deleteNotAllowed'),
    onSelect: () => setArmedDelete(true),
  });

  return (
    <div className="reading-col">
      <div className="page-head">
        <Link className="btn btn-sm btn-ghost mb-8" to="/documenti">
          <Icon name="arrowLeft" className="ic-sm" /> {t('documents.back')}
        </Link>
        <div className="page-title">{nome}</div>
        {/* §6 — QUANDO IL NOME L'ABBIAMO MESSO NOI, LO SI DICE. Il documento
            «2.5» non dichiarava un titolo leggibile: l'etichetta è composta dai
            dati che il sistema conosce davvero, e chi legge deve poter capire
            che quel nome non viene dal documento. Il segno è quello che il
            vocabolario usa già per un valore ricavato e non letto —
            «Inferenza», stessa famiglia della provenienza. */}
        {etichettaComposta(item.label) && (
          <div className="doc-name-composed">
            <ProvenanceMark kind="inference" />
            <span className="muted-sm">
              {grezzo
                ? t('documents.composedName', { raw: grezzo })
                : t('documents.composedNameNoRaw')}
            </span>
          </div>
        )}
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
      </div>

      {archived && (
        <div className="info-box" role="status">
          <Icon name="archive" className="ic-sm" /> {t('documents.archivedNotice')}
          {doc.archivedAt ? ` ${t('documents.archivedOn', { date: formatDate(doc.archivedAt) })}` : ''}
        </div>
      )}

      {/* ---- La riga delle azioni: UNA primaria -------------------------
           L'azione del momento è quella che «Prossimo passo» indica, e la
           rende lo stesso codice che spiega perché. Accanto, in second'ordine,
           le due cose che si fanno su QUALUNQUE documento a prescindere dallo
           stato dell'analisi. In fondo, staccato dal margine automatico, il
           trabocco: archivia, stampa, elimina. ------------------------- */}
      <div className="action-bar mt-12">
        <NextStepPrimary {...stepActions} />
        <div className="action-bar-secondary">
          <NextStepSecondary {...stepActions} />
          {doc.storagePath && (
            <button className="btn btn-sm" onClick={() => void openFile()} disabled={busy}>
              <Icon name="eye" className="ic-sm" /> {t('documents.openFile')}
            </button>
          )}
          {/* §120 — la domanda parte dalla scheda che si sta guardando. */}
          <AskAbout type="document" id={doc.id} label={nome} />
        </div>
        <div className="action-bar-more">
          <ActionMenu label={t('documents.moreActions')} items={menuItems} />
        </div>
      </div>

      {/* La conferma dell'eliminazione compare QUI, sotto la riga che l'ha
          chiesta, e non in fondo alla pagina: chi ha appena scelto «Elimina»
          nel menu deve trovare la domanda dove stava guardando. Finché non si
          arma, di questo blocco non c'è traccia — un riquadro rosso permanente
          in fondo a ogni documento è un avvertimento che si smette di leggere. */}
      {armedDelete && (
        <div className="warn-box mt-12" role="alert">
          <Icon name="alert" className="ic-sm" />
          <div>
            <div><b>{t('documents.dangerZone')}</b></div>
            <div className="prose">{t('documents.deleteExplain')}</div>
            <div className="row-wrap mt-10">
              <span>{t('documents.deleteAsk')}</span>
              <button className="btn btn-sm btn-danger" onClick={() => void removeForever()} disabled={busy}
                aria-busy={busy || undefined}>
                {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('documents.deleteConfirm')}
              </button>
              <button className="btn btn-sm" onClick={() => setArmedDelete(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Origine: da dove è arrivato -------------------------------
           Livello 3, riga di metadati inline. Occupava una scheda intera per
           una riga di testo, e una scheda dice «questo conta quanto l'analisi»
           — che non è vero: dice da dove arriva il foglio, non che cosa
           contiene. Resta prima di tutto perché «che cos'è questo documento»
           viene comunque prima di «che cosa devo farne». --------------- */}
      <div className="surface-3 mt-16">
        <span className="sf-k">{t('documents.origin')}</span>
        {doc.sourceType === 'email' || detail.emails.length > 0 ? (
          detail.emails.length === 0 ? (
            <span className="sf-v">{t('documents.sources.email')}</span>
          ) : (
            detail.emails.map((mail) => (
              <span className="sf-v" key={`${mail.messageId}-${mail.relation}`}>
                {[
                  mail.subject || t('documents.sources.email'),
                  mail.senderName || mail.senderEmail,
                  formatDate(mail.receivedAt),
                  mail.relation === 'attachment' ? t('documents.originAttachment') : t('documents.originBody'),
                  mail.accountEmail ? t('documents.originAccount', { email: mail.accountEmail }) : null,
                ].filter(Boolean).join(' · ')}
                {' '}
                <Link to={`/inbox?msg=${mail.messageId}`}>{t('documents.openInInbox')}</Link>
              </span>
            ))
          )
        ) : (
          <span className="sf-v">
            {doc.sourceType === 'pasted_text'
              ? t('documents.originText')
              : t('documents.originUploadUnknown')}
            {' · '}{t('documents.originOn', { date: formatDate(doc.createdAt) })}
          </span>
        )}
      </div>

      {/* Il duplicato NON è un metadato: è una cosa da decidere, e resta un
          avviso a sé. */}
      {detail.sameContentIds.length > 0 && (
        <div className="info-box mt-12">
          <div><b>{t('documents.sameContent')}</b></div>
          <div className="muted-sm prose">{t('documents.sameContentSub')}</div>
          <Link className="btn btn-sm mt-8" to={`/documenti/${detail.sameContentIds[0]}`}>
            {t('documents.sameContentOpen')}
          </Link>
        </div>
      )}

      {/* ---- Prossimo passo -------------------------------------------
           Sta QUI, sotto la riga delle azioni e sopra l'analisi, perché è la
           domanda a cui una persona vuole rispondere aprendo un documento: che
           cosa devo fare? Non introduce dati nuovi — legge quelli che la pagina
           ha già — e ora non porta più pulsanti: quelli sono là sopra, uno
           solo primario. ---------------------------------------------- */}
      <NextStepCard step={step} />

      {/* ---- Analisi ---------------------------------------------------- */}
      <div className="surface-1 mt-16">
        <div className="card-title">{t('documents.analysis')}</div>

        {item.lastAttemptFailed && (
          <div className="warn-box" role="status">{t('documents.lastAttemptFailed')}</div>
        )}

        {/* ⚠️ QUI NON C'È PIÙ UN PULSANTE «Analizza» / «Riprova», e non è una
            dimenticanza: in questi due stati l'azione primaria della schermata
            È quella, e sta nella riga in cima — che su questa pagina resta
            visibile poco sopra. Un secondo pulsante identico a mezzo schermo di
            distanza non offre una seconda possibilità, moltiplica soltanto i
            posti in cui la stessa cosa può divergere. */}
        {item.state === 'none' && (
          <div className="empty">
            <div>{t('documents.analysisNone')}</div>
            <div className="muted-sm mt-10">{t('documents.analysisNoneSub')}</div>
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
          </div>
        )}

        {(item.state === 'analyzed' || item.state === 'to_verify' || item.lastAttemptFailed) && (
          <>
            {/* ⚠️ Ogni campo che AFFERMA qualcosa sul documento porta la sua
                evidenza in linea (EvidenceLink): la frase originale si apre
                qui, senza cambiare pagina. Dove il modello non registra
                un'evidenza (tipo, data del documento) la riga LO DICE con
                `evidence={null}` — dichiarato, non taciuto. La confidenza non
                ha evidenza perché non è un'affermazione sul documento: è un
                giudizio di sintesi dell'analisi. */}
            <dl className="detail-list">
              <Field label={t('documents.sender')} value={item.sender}
                corrected={item.senderCorrected} aiValue={aiValueOf(detail.corrections, 'sender')}
                evidence={analysis ? (analysis.senderEvidence ?? null) : undefined} />
              <Field label={t('documents.documentType')} value={item.documentType ? L.docType(item.documentType) : null}
                corrected={item.documentTypeCorrected} aiValue={aiValueOf(detail.corrections, 'document_type')}
                evidence={analysis ? null : undefined} />
              <Field label={t('documents.documentDate')} value={item.documentDate ? formatDate(item.documentDate) : null}
                evidence={analysis ? null : undefined} />
              <Field
                label={t('documents.deadline')}
                // §36 — se l'analisi dichiara che la scadenza va verificata, non
                // la si presenta come un fatto: la marcatura del termine lo dice
                // con il segno «?» e senza contare giorni su una data incerta.
                value={item.deadline ? formatDate(item.deadline) : null}
                mark={item.deadline
                  ? <DeadlineMark date={item.deadline} display={formatDate(item.deadline)} toVerify={item.deadlineRequiresVerification} />
                  : null}
                corrected={item.deadlineCorrected} aiValue={aiValueOf(detail.corrections, 'deadline')}
                evidence={analysis ? (analysis.deadlineEvidence ?? null) : undefined} />
              {/* Una riga SUA, sotto la scadenza e mai al posto suo: 0040. */}
              {item.appointmentDate && (
                <Field
                  label={t('documents.appointment')}
                  value={formatDate(item.appointmentDate)}
                  mark={<AppointmentMark date={item.appointmentDate} display={formatDate(item.appointmentDate)} />}
                  evidence={analysis ? (analysis.appointmentEvidence ?? null) : undefined} />
              )}
              <Field label={t('documents.amount')} value={formatCurrency(item.amount, item.amountCurrency)}
                corrected={item.amountCorrected} aiValue={aiValueOf(detail.corrections, 'amount')}
                evidence={analysis ? (analysis.amountEvidence ?? null) : undefined} />
              {analysis?.referenceNumbers.length ? (
                <Field label={t('documents.references')}
                  value={analysis.referenceNumbers.map((r) => `${r.label ? `${r.label}: ` : ''}${r.value}`).join(' · ')} />
              ) : null}
              <Field label={t('documents.confidence')} value={item.confidence ? L.confidence(item.confidence) : null}
                mark={item.confidence === 'alta' || item.confidence === 'media' || item.confidence === 'bassa'
                  ? <ConfidenceBadge level={item.confidence as Confidence} />
                  : null} />
            </dl>

            {/* ⚠️ `prose`: il riassunto è testo CORRENTE, e correva per tutta la
                larghezza della schermata — oltre cento caratteri per riga, dove
                l'occhio perde il capo della riga successiva. Le tabelle e gli
                elenchi qui sopra restano larghi: sono strutture, e la misura di
                lettura non li riguarda. */}
            {analysis?.summary && <p className="muted-sm prose mt-12">{analysis.summary}</p>}

            {analysis && analysis.uncertaintyItems.length > 0 && (
              /* ⚠️ NON è un guasto, e fino al 2026-08-12 era vestito da guasto:
                 `.warn-box` rosso, il linguaggio dell'analisi fallita, per il
                 blocco in cui il prodotto DICHIARA ciò che non ha potuto
                 determinare — cioè per il prodotto che funziona. Ora sta su
                 `.verify-note`: superficie neutra, filetto puntinato «da
                 verificare», il rosso resta a ciò che è andato storto davvero. */
              <div className="verify-note mt-12" role="note">
                <span className="vn-title">
                  <MarkGlyph name="question" />
                  {t('documents.uncertainties')}
                </span>
                <ul>
                  {analysis.uncertaintyItems.map((u, i) => <li key={i}>{u.description}</li>)}
                </ul>
              </div>
            )}

            {/* ---- LE AZIONI, CIASCUNA CON LA SUA PROVENIENZA ----------------
                ⚠️ PRIMA QUI NON C'ERANO AFFATTO: la pagina diceva soltanto
                «N azioni non sono ancora diventate attività», cioè un numero
                senza le cose che contava. E il dato che serve davvero per
                decidere non è quante siano, ma QUALI il documento CHIEDA e
                quali stiamo proponendo noi — che è esattamente ciò che
                `sourceType` sa e che nessuna schermata al di fuori del foglio
                d'analisi mostrava.

                Elenco in sola lettura: le caselle da spuntare vivono nel
                foglio d'analisi, e due checklist per la stessa lista sono due
                liste che prima o poi non si somigliano più. Le citazioni si
                aprono in linea solo per le azioni ESTRATTE — un suggerimento
                non ha una frase nel documento, e mostrargli «senza evidenza
                verificata» accanto sarebbe un rimprovero per un'assenza già
                dichiarata dal suo stesso segno. */}
            {analysis && analysis.actions.length > 0 && (
              <div className="mt-16">
                <div className="card-title">{t('documents.actionsTitle')}</div>
                <ul className="stack-sm">
                  {analysis.actions.map((a) => (
                    <li key={a.id}>
                      <div className={a.done ? 'muted-sm' : undefined}>{a.text}</div>
                      <div className="row-wrap gap-2">
                        <ActionOriginMark source={a.sourceType} />
                        {a.sourceType === 'extracted' && (
                          <EvidenceLink quote={a.evidence?.quote ?? null} page={a.evidence?.pageNumber ?? null} />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link className="btn btn-sm mt-10" to={`/admin?doc=${doc.id}`}>
              {t('documents.openAnalysis')} <Icon name="arrowRight" className="ic-sm" />
            </Link>

            {/* La legenda dei segni: la stessa in ogni schermata che li usa,
                si impara una volta e si richiude. */}
            <MarkLegend />
          </>
        )}
      </div>

      {/* ⚠️ LA VERSIONE PER LA CARTA. Non compare mai a schermo. Esiste perché
          il foglio che finisce nel fascicolo del cliente porti ciò che qui
          sopra è un COMANDO o un dettaglio da aprire: le citazioni per esteso
          (a schermo sono il pulsante «Mostra nel documento»), il tipo della
          scadenza, il tipo degli importi, la provenienza delle azioni e il piè
          di pagina d'archivio. */}
      {analysis && analysis.analysisStatus !== 'failed' && (
        <PrintSheet
          title={nome}
          facts={[
            { labelKey: 'documents.sender', value: item.sender },
            { labelKey: 'documents.documentType', value: item.documentType ? L.docType(item.documentType) : null },
            { labelKey: 'documents.documentDate', value: item.documentDate ? formatDate(item.documentDate) : null },
            { labelKey: 'documents.references', value: analysis.referenceNumbers.map((r) => `${r.label ? `${r.label}: ` : ''}${r.value}`).join(' · ') },
          ]}
          deadline={item.deadline
            ? { value: formatDate(item.deadline), kindKey: deadlineKindKey(analysis) }
            : null}
          appointment={item.appointmentDate ? { value: formatDate(item.appointmentDate) } : null}
          amounts={[
            ...(item.amount !== null ? [{
              display: formatCurrency(item.amount, item.amountCurrency) ?? String(item.amount),
              typeKey: amountTypeKey(analysis.amountType),
              description: null,
            }] : []),
            ...analysis.amounts.map((a) => ({
              display: a.display,
              typeKey: amountTypeKey(a.type),
              description: a.description,
            })),
          ]}
          actions={splitActions(analysis.actions)}
          citations={collectCitations(analysis)}
          toVerify={analysis.uncertaintyItems.map((u) => u.description)}
          footer={buildFooter({
            companyName: activeCompany?.legalName,
            now: new Date(),
            // ⚠️ `engine` e non un campo «model»: il modello di dominio non lo
            // porta, e per il percorso AI `engine` È il nome del modello che ha
            // scritto lo snapshot (`analyze-document` lo salva così). Si legge
            // quello che c'è, invece di aggiungere un campo per far tornare una
            // riga di piè di pagina.
            engine: analysis.engine,
            analysisVersion: analysis.analysisVersion,
          })}
        />
      )}

      {/* ---- Attività ----------------------------------------------------
           Livello 2: blocco piano, separato da un filetto. Non è una scheda
           perché non si LEGGE come l'analisi — si consulta, e a volte ci si
           lavora dentro. La differenza fra le due cose è tutto ciò che questa
           pagina non diceva quando erano sette schede uguali. -------- */}
      <div className="surface-2" id="doc-tasks" ref={tasksCardRef}>
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
                  {/* ⚠️ «Nessuna scadenza» su un'attività che ha un
                      appuntamento sarebbe vero e monco: qui si dice l'altra
                      cosa vera, con la parola che la distingue da un termine. */}
                  {[assigneeName(task.assigneeUserId), t(statusLabelKey(task.status)),
                    taskDateKind(task) === 'appointment'
                      ? `${t('marks.appointment.label')} · ${formatDate(task.appointmentDate as string)}`
                      : t(due.key, due.params)]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <Tag>{t('documents.openTask')}</Tag>
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
              <b>{t('documents.taskForm.linkedDocument')}</b> — {nome}
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
              appointmentDate={analysis?.appointmentDate ?? null}
              submitLabel={t('documents.createTask')}
              autoFocus
            />
          </div>
        ) : (
          <>
            <button ref={createTaskButtonRef} className="btn btn-sm mt-10"
              onClick={openTaskForm} disabled={busy || !step.canCreateTask}>
              <Icon name="plus" className="ic-sm" />
              {' '}{detail.tasks.length ? t('documents.nextStep.actionCreateAnother') : t('documents.createTask')}
            </button>
            {/* Un pulsante spento senza una ragione accanto è un pulsante che
                sembra rotto: la spiegazione sta anche in cima, ma chi arriva
                qui scorrendo non l'ha necessariamente letta. */}
            {!step.canCreateTask && (
              <div className="muted-sm mt-8">{t('documents.nextStep.noticeProcessing')}</div>
            )}
          </>
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
        className="surface-2"
        linkedId={crmLink.linked?.id ?? null}
        linkedName={crmLink.linked?.displayName ?? null}
        extractedName={item.sender}
        onLink={crmLink.link}
        onUnlink={crmLink.unlink}
        disabled={busy}
      />

      {/* ---- Organizzazione ---------------------------------------------- */}
      <div className="surface-2">
        <div className="card-title">{t('documents.organization')}</div>
        <div className="muted-sm prose">{t('documents.organizationHint')}</div>

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
          <div className="field m-0" style={{ minWidth: 200 }}>
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
      <details className="surface-2">
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

      {/* ⚠️ QUI C'ERA LA SCHEDA «Eliminazione definitiva», ed è sparita.
          Era una scheda con un pulsante rosso in fondo a OGNI documento, anche
          a quelli che nessuno vuole cancellare: un avvertimento permanente si
          smette di leggere, e un pulsante distruttivo sempre a schermo compete
          con l'azione del momento (regola 8 del sistema di design — un solo
          colore forte per riga). Il comando ora sta nel menu di trabocco, e la
          conferma — con la stessa spiegazione, `deleteExplain`, e la stessa
          domanda, `deleteAsk` — compare in cima, dove è stata chiesta. */}
    </div>
  );
}

/**
 * Una riga di scheda. Quando il valore è stato corretto da una persona lo dice,
 * e mostra accanto quello che l'analisi aveva rilevato: la correzione non
 * cancella l'originale, gli si affianca — l'analisi resta verificabile.
 *
 * `evidence`: la citazione che sostiene il valore, mostrabile IN LINEA senza
 * cambiare pagina. Passare `null` significa «per questo campo un'evidenza non
 * esiste», e la riga LO DICE — tacere lascerebbe credere che la prova ci sia
 * ma non sia stata mostrata. `undefined` = la riga non parla di evidenza
 * (contatori, giudizi di sintesi come la confidenza).
 * `mark`: una marcatura al posto del testo piano (scadenza, confidenza).
 */
function Field({
  label, value, corrected, aiValue, evidence, mark,
}: {
  label: string; value: string | null; corrected?: boolean; aiValue?: string | null;
  evidence?: Evidence | null; mark?: React.ReactNode;
}) {
  const t = useT();
  if (!value && !corrected) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {mark ?? value ?? '—'}
        {corrected && (
          <>
            {' '}<Tag tone="info">{t('documents.correctedBadge')}</Tag>
            <div className="muted-sm">
              {aiValue ? t('documents.aiValue', { value: aiValue }) : t('documents.aiValueEmpty')}
            </div>
          </>
        )}
        {evidence !== undefined && (
          <div>
            <EvidenceLink quote={evidence?.quote ?? null} page={evidence?.pageNumber ?? null} />
          </div>
        )}
      </dd>
    </>
  );
}
