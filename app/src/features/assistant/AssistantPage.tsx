// ============================================================================
// Chiedi ad AI-Swisse — la schermata
//
// Tre colonne su schermo largo: conversazioni a sinistra, la conversazione al
// centro, le fonti a destra. Su telefono una colonna sola, con elenco e fonti
// in due pannelli che si aprono.
//
// ⚠️ NESSUN PULSANTE CHE AGISCE. Questa versione legge. Le pastiglie delle
// fonti dicono «Apri», mai «Crea» o «Correggi»: §132 — un pulsante che il
// server non sa eseguire è una promessa, e la copy è il primo posto in cui una
// funzione inesistente sembra esistere.
//
// ⚠️ IL CAMBIO DI AZIENDA AZZERA TUTTO (§33). Conversazione, messaggi, fonti,
// stato della richiesta in corso: l'effetto che osserva `activeCompanyId` li
// riporta a zero e interrompe una risposta eventualmente in arrivo. Senza,
// resterebbe a schermo la risposta di un'altra impresa sotto il nome nuovo.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useI18n, useT } from '@/i18n';
import { Button, EmptyCta, ErrorState, Spinner } from '@/components/ui/states';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { assistantService } from '@/services/assistantService';
import type {
  AssistantCitation, AssistantFeedbackReason, AssistantMessage, AssistantPublicAnswer,
  AssistantThread,
} from '@/types/models';
import {
  ENTITY_LABEL_PARAM, ENTITY_PARAM, citationLabel, dedupeCitations, groupItems, parseEntityContext,
  runningKey, sourceIcon, sourceTypeKey, statusBadgeClass, statusKey, statusNeedsHint,
} from './assistantModel';

// ---------------------------------------------------------------------------

/**
 * Quanto si aspetta, dopo un'interruzione, prima di rileggere la conversazione.
 *
 * Non è un tempo scelto a occhio: è il margine perché una risposta già composta
 * quando l'interruzione è partita finisca di essere scritta. Più corto direbbe
 * «interrotta» su una risposta che sta per comparire; più lungo lascerebbe la
 * schermata ferma senza motivo.
 */
const LATE_ANSWER_GRACE_MS = 1500;

/** Un messaggio dell'assistente ancora in arrivo: esiste solo a schermo. */
interface PendingAnswer {
  question: string;
  statusLine: string;
  running: boolean;
}

export function AssistantPage() {
  const t = useT();
  const { locale } = useI18n();
  const { user } = useAuth();
  const { activeCompanyId } = useCompany();
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();

  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  const [threadsOpen, setThreadsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  // §120/§121 — la scheda da cui la domanda è partita.
  const entityContext = useMemo(
    () => parseEntityContext(params.get(ENTITY_PARAM), params.get(ENTITY_LABEL_PARAM)),
    [params],
  );

  // -- Azzeramento al cambio azienda (§33) ----------------------------------
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setThreadId(null);
    setMessages([]);
    setPending(null);
    setSelectedMessageId(null);
    setAskError(null);
    setMessagesError(null);
  }, [activeCompanyId]);

  // -- Elenco delle conversazioni -------------------------------------------
  const loadThreads = useCallback(async () => {
    if (!activeCompanyId) return;
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      setThreads(await assistantService.listThreads(activeCompanyId, showArchived));
    } catch (e) {
      setThreadsError(toUserMessage(e));
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }, [activeCompanyId, showArchived]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  // -- Messaggi della conversazione scelta ----------------------------------
  useEffect(() => {
    let active = true;
    if (!threadId) { setMessages([]); return () => { active = false; }; }
    setMessagesError(null);
    assistantService.getMessages(threadId)
      .then((list) => { if (active) { setMessages(list); setSelectedMessageId(lastAssistantId(list)); } })
      .catch((e) => { if (active) setMessagesError(toUserMessage(e)); });
    return () => { active = false; };
  }, [threadId]);

  // Il fuoco torna alla conversazione quando una risposta arriva (§167).
  //
  // ⚠️ SI SCORRE IL CONTENITORE, NON LA FINESTRA. Con `scrollIntoView` sul
  // fondo del flusso scorreva l'intero documento, e siccome il composer sta
  // SOTTO il flusso finiva fuori schermo a ogni risposta: misurati 163px sotto
  // la piega il 2026-07-30, con il pulsante «Chiedi» invisibile. Per scrivere
  // la domanda successiva bisognava scorrere giù ogni volta.
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending?.statusLine]);

  // Alla chiusura della schermata una risposta in corso viene interrotta:
  // lasciarla correre continuerebbe a consumare quota per nessuno.
  useEffect(() => () => abortRef.current?.abort(), []);

  const selected = useMemo(
    () => messages.find((m) => m.id === selectedMessageId) ?? null,
    [messages, selectedMessageId],
  );

  // L'ultima riga è una domanda: quella richiesta non è mai arrivata in fondo.
  const unanswered = messages.length > 0 && messages[messages.length - 1].role === 'user';

  // -- La domanda ------------------------------------------------------------
  const ask = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || !activeCompanyId || pending?.running) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setAskError(null);
    setQuestion('');
    setPending({ question: q, statusLine: t('assistant.running.start'), running: true });

    // ⚠️ Un oggetto e non tre variabili: TypeScript non vede le assegnazioni
    // fatte dentro il callback del flusso e restringerebbe le variabili a
    // `null`, facendo fallire la compilazione su un valore che a runtime c'è.
    const got: {
      answered: { messageId: string; answer: AssistantPublicAnswer } | null;
      threadId: string | null;
      failureCode: string | null;
    } = { answered: null, threadId: null, failureCode: null };

    try {
      await assistantService.ask({
        companyId: activeCompanyId,
        threadId,
        question: q,
        locale,
        entityContext: entityContext ? { type: entityContext.type, id: entityContext.id } : null,
        signal: controller.signal,
        onEvent: (event) => {
          switch (event.type) {
            case 'run_started':
              got.threadId = event.threadId;
              break;
            case 'tool_started':
              setPending((p) => (p ? { ...p, statusLine: t(runningKey(event.module)) } : p));
              break;
            case 'composing':
              setPending((p) => (p ? { ...p, statusLine: t('assistant.running.composing') } : p));
              break;
            case 'answer':
              got.answered = { messageId: event.messageId, answer: event.answer };
              break;
            case 'error':
              got.failureCode = event.code;
              break;
            default:
              break;
          }
        },
      });
    } catch (e) {
      got.failureCode = null;
      if (!controller.signal.aborted) setAskError(toUserMessage(e));
    } finally {
      abortRef.current = null;
    }

    setPending(null);

    if (got.failureCode) {
      // Il server manda un CODICE, non una frase: la frase la compone qui la
      // lingua dell'utente (§146).
      setAskError(errorMessage(t, got.failureCode));
      return;
    }

    // ⚠️ DOPO UN'INTERRUZIONE SI ASPETTA, POI SI GUARDA.
    //
    // Il server smette davvero quando l'interruzione lo raggiunge in tempo
    // (provato: interrotta durante la prima ricerca, non viene scritto nulla).
    // Ma fra il momento in cui il modello consegna la risposta e quello in cui
    // viene scritta passano poche decine di millisecondi di lavoro locale,
    // mentre la disconnessione deve attraversare la rete: quella corsa non si
    // vince. Provato il 2026-07-30 abortendo esattamente sull'evento
    // `composing` — la risposta è stata scritta lo stesso.
    // Quindi non si dichiara: si CONTROLLA. Si lascia al server il tempo di
    // finire, si rilegge la conversazione, e si dice ciò che c'è davvero.
    if (controller.signal.aborted) await new Promise((r) => { setTimeout(r, LATE_ANSWER_GRACE_MS); });

    if (got.threadId && got.threadId !== threadId) setThreadId(got.threadId);
    const target = got.threadId ?? threadId;
    if (target) {
      try {
        const list = await assistantService.getMessages(target);
        setMessages(list);
        setSelectedMessageId(got.answered?.messageId ?? lastAssistantId(list));
        // La risposta è arrivata comunque: l'avviso «interrotta» sarebbe falso.
        if (controller.signal.aborted && list[list.length - 1]?.role === 'assistant') {
          setAskError(null);
        }
      } catch (e) {
        setMessagesError(toUserMessage(e));
      }
    }
    void loadThreads();
  }, [activeCompanyId, threadId, locale, entityContext, pending?.running, t, loadThreads]);

  // L'avviso compare subito, perché il gesto deve avere una risposta immediata.
  // Se poi la risposta arriva lo stesso, `ask` lo toglie: vedi il commento là.
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(null);
    setAskError(t('assistant.errors.CANCELLED'));
  }, [t]);

  // -- Azioni sulle conversazioni -------------------------------------------
  const removeThread = useCallback(async (id: string) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`${t('assistant.threads.deleteConfirm')}\n\n${t('assistant.threads.deleteExplain')}`)) return;
    try {
      await assistantService.deleteThread(id);
      if (id === threadId) { setThreadId(null); setMessages([]); }
      void loadThreads();
    } catch (e) {
      showToast(toUserMessage(e));
    }
  }, [t, threadId, loadThreads, showToast]);

  const toggleArchive = useCallback(async (thread: AssistantThread) => {
    try {
      await assistantService.archiveThread(thread.id, thread.status === 'active');
      if (thread.id === threadId && thread.status === 'active') { setThreadId(null); setMessages([]); }
      void loadThreads();
    } catch (e) {
      showToast(toUserMessage(e));
    }
  }, [threadId, loadThreads, showToast]);

  const sendFeedback = useCallback(async (
    messageId: string, rating: 'helpful' | 'not_helpful', reason?: AssistantFeedbackReason,
  ) => {
    if (!activeCompanyId || !user) return;
    try {
      await assistantService.sendFeedback({
        messageId, companyId: activeCompanyId, userId: user.id, rating, reason: reason ?? null,
      });
      showToast(t('assistant.feedback.thanks'));
    } catch (e) {
      showToast(toUserMessage(e));
    }
  }, [activeCompanyId, user, showToast, t]);

  const openThread = useCallback((id: string) => {
    abortRef.current?.abort();
    setPending(null);
    setAskError(null);
    setThreadId(id);
    setThreadsOpen(false);
  }, []);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    setPending(null);
    setAskError(null);
    setThreadId(null);
    setMessages([]);
    setSelectedMessageId(null);
    setThreadsOpen(false);
    composerRef.current?.focus();
  }, []);

  const clearContext = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete(ENTITY_PARAM);
    next.delete(ENTITY_LABEL_PARAM);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const busy = pending?.running === true;

  return (
    <div className="as-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('assistant.title')}</h1>
          <p className="page-desc">{t('assistant.subtitle')}</p>
        </div>
      </div>

      <div className="as-layout">
        {/* ---- Conversazioni ------------------------------------------- */}
        <button
          type="button"
          className="btn btn-sm as-only-narrow"
          onClick={() => setThreadsOpen(true)}
          aria-expanded={threadsOpen}
          aria-haspopup="dialog"
        >
          <Icon name="menu" className="ic-sm" /> {t('assistant.threads.title')}
        </button>

        <ThreadColumn
          threads={threads}
          loading={threadsLoading}
          error={threadsError}
          activeId={threadId}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived((v) => !v)}
          onOpen={openThread}
          onNew={newThread}
          onArchive={toggleArchive}
          onDelete={removeThread}
          onRetry={() => void loadThreads()}
          drawerOpen={threadsOpen}
          onCloseDrawer={() => setThreadsOpen(false)}
        />

        {/* ---- Conversazione ------------------------------------------- */}
        <section className="as-main" aria-label={t('assistant.title')}>
          {entityContext && (
            <div className="as-context">
              <Icon name="fileSearch" className="ic-sm" />
              <span>{t('assistant.context.label', { entity: entityContext.label || entityContext.id })}</span>
              <button type="button" className="as-context-x" onClick={clearContext} aria-label={t('assistant.context.remove')}>
                <Icon name="close" className="ic-sm" />
              </button>
            </div>
          )}

          <div className="as-stream" ref={streamRef}>
            {/* Ordine obbligatorio: prima il guasto, poi il vuoto, poi i dati. */}
            {messagesError && <ErrorState message={messagesError} />}

            {!messagesError && !messages.length && !pending && (
              <EmptyCta
                icon="fileSearch"
                title={t('assistant.emptyTitle')}
                subtitle={t('assistant.emptySubtitle')}
                action={
                  <div className="as-suggestions">
                    {(['attention', 'finance', 'contracts', 'tasks', 'clients'] as const).map((k) => (
                      <button key={k} type="button" className="as-suggestion" onClick={() => void ask(t(`assistant.suggestions.${k}` as never))}>
                        {t(`assistant.suggestions.${k}` as never)}
                      </button>
                    ))}
                  </div>
                }
              />
            )}

            {messages.map((m) => (
              m.role === 'user'
                ? <QuestionBubble key={m.id} message={m} />
                : (
                  <AnswerBlock
                    key={m.id}
                    message={m}
                    selected={m.id === selectedMessageId}
                    onSelect={() => { setSelectedMessageId(m.id); setSourcesOpen(true); }}
                    onFollowUp={(text) => void ask(text)}
                    onFeedback={(rating, reason) => void sendFeedback(m.id, rating, reason)}
                  />
                )
            ))}

            {pending && (
              <>
                <div className="as-q"><div className="as-q-text">{pending.question}</div></div>
                <div className="as-progress" role="status" aria-live="polite" aria-label={t('assistant.running.live')}>
                  <Spinner /> <span>{pending.statusLine}</span>
                </div>
              </>
            )}

            {askError && (
              <div className="as-error" role="alert">
                <Icon name="alert" className="ic-sm" /> <span>{askError}</span>
              </div>
            )}

            {/* Una domanda rimasta in fondo senza risposta non si spiega da
                sola: riaprendo la conversazione il giorno dopo sembra che il
                prodotto l'abbia ignorata. L'avviso a schermo di un'eventuale
                interruzione vive solo finché la schermata è aperta — questa
                riga resta, e vale anche per una richiesta non riuscita. */}
            {unanswered && !pending && !askError && (
              <p className="as-a-hint as-unanswered">{t('assistant.unanswered')}</p>
            )}
          </div>

          {/* ---- Composer --------------------------------------------- */}
          <form
            className="as-composer"
            onSubmit={(e) => { e.preventDefault(); void ask(question); }}
          >
            <label className="sr-only" htmlFor="as-question">{t('assistant.composer.label')}</label>
            <textarea
              id="as-question"
              ref={composerRef}
              className="as-input"
              rows={2}
              value={question}
              maxLength={1000}
              placeholder={t('assistant.composer.placeholder')}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                // Invio invia, Maiusc+Invio va a capo: è la convenzione che
                // chiunque abbia scritto in una chat si aspetta.
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(question); }
              }}
            />
            <div className="as-composer-actions">
              <span className="muted-sm as-hint">{t('assistant.composer.hint')}</span>
              {busy
                ? <Button type="button" variant="default" icon="close" onClick={stop}>{t('assistant.composer.stop')}</Button>
                : <Button type="submit" variant="primary" icon="arrowRight" disabled={!question.trim()}>{t('assistant.composer.send')}</Button>}
            </div>
          </form>

          <p className="legal-note as-note">{t('assistant.readOnly')} {t('assistant.privacy')}</p>
        </section>

        {/* ---- Fonti ---------------------------------------------------- */}
        <SourcesColumn
          message={selected}
          drawerOpen={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const lastAssistantId = (list: AssistantMessage[]): string | null => {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].role === 'assistant') return list[i].id;
  return null;
};

/**
 * Il codice d'errore diventa una frase nella lingua di chi legge.
 * ⚠️ Un codice sconosciuto NON diventa una frase inventata: diventa quella
 * generica, che è vera anche quando il codice è nuovo.
 */
function errorMessage(t: ReturnType<typeof useT>, code: string): string {
  const known = [
    'RATE_LIMITED', 'CREDIT_EXHAUSTED', 'AI_NOT_CONFIGURED', 'PROVIDER_ERROR', 'PROVIDER_REFUSAL',
    'TIME_BUDGET', 'CANCELLED', 'FORBIDDEN', 'THREAD_NOT_FOUND', 'INVALID_REQUEST',
    'INVALID_ANSWER', 'GROUNDING_FAILED', 'UNKNOWN_ERROR',
  ];
  return known.includes(code)
    ? t(`assistant.errors.${code}` as never)
    : t('assistant.errors.UNKNOWN_ERROR');
}

function QuestionBubble({ message }: { message: AssistantMessage }) {
  return (
    <div className="as-q">
      <div className="as-q-text">{message.content}</div>
    </div>
  );
}

function AnswerBlock({
  message, selected, onSelect, onFollowUp, onFeedback,
}: {
  message: AssistantMessage;
  selected: boolean;
  onSelect: () => void;
  onFollowUp: (text: string) => void;
  onFeedback: (rating: 'helpful' | 'not_helpful', reason?: AssistantFeedbackReason) => void;
}) {
  const t = useT();
  const [askWhy, setAskWhy] = useState(false);
  const status = message.answerStatus ?? 'answered';
  const badge = statusBadgeClass(status);
  const citations = useMemo(() => dedupeCitations(message.citations), [message.citations]);

  return (
    <article className={`as-a${selected ? ' is-selected' : ''}`} aria-label={t(statusKey(status))}>
      {badge && (
        <div className="as-a-head">
          <span className={badge}>{t(statusKey(status))}</span>
        </div>
      )}
      {statusNeedsHint(status) && (
        <p className="as-a-hint">{t(`assistant.statusHint.${status}` as never, {})}</p>
      )}

      <div className="as-a-text">{message.content}</div>

      {message.uncertainty && (
        <div className="info-box mt-12">
          <Icon name="alert" className="ic-sm" />{' '}
          <b>{t('assistant.uncertainty')}</b> — {message.uncertainty}
        </div>
      )}

      {citations.length > 0 && (
        <div className="as-chips">
          {citations.map((c) => <CitationChip key={c.index} citation={c} />)}
          <button type="button" className="as-chip as-chip-more" onClick={onSelect}>
            <Icon name="eye" className="ic-sm" />
            {citations.length === 1
              ? t('assistant.sources.countOne')
              : t('assistant.sources.count', { count: citations.length })}
          </button>
        </div>
      )}

      {message.followUps.length > 0 && (
        <div className="as-follow">
          <div className="as-follow-title">{t('assistant.followUps')}</div>
          <div className="row-wrap">
            {message.followUps.map((f) => (
              <button key={f} type="button" className="as-suggestion" onClick={() => onFollowUp(f)}>{f}</button>
            ))}
          </div>
        </div>
      )}

      <div className="as-a-foot">
        <span className="muted-sm">{formatDate(message.createdAt)}</span>
        <div className="as-feedback">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onFeedback('helpful')}>
            <Icon name="checkCircle" className="ic-sm" /> {t('assistant.feedback.helpful')}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAskWhy((v) => !v)} aria-expanded={askWhy}>
            <Icon name="alert" className="ic-sm" /> {t('assistant.feedback.notHelpful')}
          </button>
        </div>
      </div>

      {askWhy && (
        <div className="as-why">
          <div className="muted-sm">{t('assistant.feedback.why')}</div>
          <div className="row-wrap mt-8">
            {(['wrong_data', 'wrong_source', 'incomplete', 'misunderstood'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className="as-suggestion"
                onClick={() => { onFeedback('not_helpful', r); setAskWhy(false); }}
              >
                {t(`assistant.feedback.${r}` as never)}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function CitationChip({ citation }: { citation: AssistantCitation }) {
  const t = useT();
  const typeLabel = t(sourceTypeKey(citation.sourceType));
  // Il singolare è una chiave a parte, come per il conteggio delle fonti: in
  // tedesco e in francese «1 Einträge» e «1 éléments» erano sbagliati quanto
  // «1 elementi» in italiano.
  const label = citationLabel(citation, typeLabel, (count) => (count === 1
    ? t('assistant.sources.groupOne')
    : t('assistant.sources.group', { count })));
  return (
    <Link className="as-chip" to={citation.route} title={citation.title}>
      <Icon name={sourceIcon(citation.sourceType)} className="ic-sm" />
      <span className="as-chip-text">{label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------

function ThreadColumn(props: {
  threads: AssistantThread[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  showArchived: boolean;
  onToggleArchived: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onArchive: (thread: AssistantThread) => void;
  onDelete: (id: string) => void;
  onRetry: () => void;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  const t = useT();
  const body = (
    <>
      <div className="as-col-head">
        <span className="section-title">{t('assistant.threads.title')}</span>
        <Button size="sm" variant="primary" icon="plus" onClick={props.onNew}>{t('assistant.threads.newShort')}</Button>
      </div>

      {props.error && <ErrorState message={props.error} onRetry={props.onRetry} />}

      {!props.error && props.loading && <div className="as-col-empty"><Spinner /></div>}

      {!props.error && !props.loading && !props.threads.length && (
        <div className="empty">
          <div>{t('assistant.threads.empty')}</div>
          <div className="muted-sm">{t('assistant.threads.emptyHint')}</div>
        </div>
      )}

      {!props.error && !props.loading && props.threads.length > 0 && (
        <ul className="crm-list as-threads">
          {props.threads.map((th) => (
            <li key={th.id} className={`as-thread${th.id === props.activeId ? ' is-active' : ''}`}>
              <button type="button" className="as-thread-open" onClick={() => props.onOpen(th.id)}>
                <span className="as-thread-title">{th.title || t('assistant.threads.new')}</span>
                <span className="as-thread-meta">
                  {formatDate(th.updatedAt)}
                  {th.status === 'archived' ? ` · ${t('assistant.threads.archived')}` : ''}
                </span>
              </button>
              <div className="as-thread-actions">
                <button type="button" className="as-icon-btn" onClick={() => props.onArchive(th)}
                  aria-label={th.status === 'active' ? t('assistant.threads.archive') : t('assistant.threads.unarchive')}>
                  <Icon name="archive" className="ic-sm" />
                </button>
                <button type="button" className="as-icon-btn" onClick={() => props.onDelete(th.id)}
                  aria-label={t('assistant.threads.remove')}>
                  <Icon name="trash" className="ic-sm" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn btn-sm btn-ghost mt-12" onClick={props.onToggleArchived} aria-pressed={props.showArchived}>
        {props.showArchived ? t('assistant.threads.hideArchived') : t('assistant.threads.showArchived')}
      </button>
    </>
  );

  return (
    <>
      <aside className="as-side as-side-left" aria-label={t('assistant.threads.list')}>{body}</aside>

      <div className={`as-overlay${props.drawerOpen ? ' open' : ''}`} hidden={!props.drawerOpen} onClick={props.onCloseDrawer} />
      <aside
        className={`as-drawer as-drawer-left${props.drawerOpen ? ' open' : ''}`}
        aria-label={t('assistant.threads.list')}
        aria-hidden={!props.drawerOpen}
      >
        <button type="button" className="as-drawer-close" onClick={props.onCloseDrawer} aria-label={t('assistant.threads.close')}>
          <Icon name="close" />
        </button>
        {body}
      </aside>
    </>
  );
}

function SourcesColumn({
  message, drawerOpen, onClose,
}: { message: AssistantMessage | null; drawerOpen: boolean; onClose: () => void }) {
  const t = useT();
  const citations = useMemo(() => dedupeCitations(message?.citations ?? []), [message?.citations]);
  const body = (
    <>
      <div className="as-col-head">
        <span className="section-title">{t('assistant.sources.title')}</span>
      </div>
      <p className="muted-sm">{t('assistant.sources.subtitle')}</p>

      {!message && <div className="empty">{t('assistant.sources.selectHint')}</div>}
      {message && !citations.length && <div className="empty">{t('assistant.sources.empty')}</div>}

      {message && citations.length > 0 && (
        <ul className="crm-list as-sources">
          {citations.map((c) => <SourceCard key={c.index} citation={c} />)}
        </ul>
      )}
    </>
  );

  return (
    <>
      <aside className="as-side as-side-right" aria-label={t('assistant.sources.title')}>{body}</aside>

      <div className={`as-overlay${drawerOpen ? ' open' : ''}`} hidden={!drawerOpen} onClick={onClose} />
      <aside
        className={`as-drawer as-drawer-right${drawerOpen ? ' open' : ''}`}
        aria-label={t('assistant.sources.title')}
        aria-hidden={!drawerOpen}
      >
        <button type="button" className="as-drawer-close" onClick={onClose} aria-label={t('assistant.sources.close')}>
          <Icon name="close" />
        </button>
        {body}
      </aside>
    </>
  );
}

function SourceCard({ citation }: { citation: AssistantCitation }) {
  const t = useT();
  const items = groupItems(citation);
  return (
    <li className="as-source">
      <div className="as-source-head">
        <Icon name={sourceIcon(citation.sourceType)} className="ic-sm" />
        <span className="as-source-type">{t(sourceTypeKey(citation.sourceType))}</span>
        {/* Il grado di verifica della fonte, nella grammatica della famiglia
            provenienza: verificata da una persona = filetto pieno, non
            verificata = puntinato «da verificare». Le PAROLE restano quelle
            dell'assistente. ⚠️ 'deterministic', 'ai_with_evidence' e null non
            hanno mai avuto un marcatore: dargliene uno è una decisione di
            prodotto, non un refactoring — restano senza. */}
        {citation.verification === 'human_verified' && (
          <span className="mark mark-prov mp-doc">{t('assistant.sources.verified')}</span>
        )}
        {citation.verification === 'ai_unverified' && (
          <span className="mark mark-prov mp-verify">{t('assistant.sources.unverified')}</span>
        )}
      </div>

      <Link className="as-source-title" to={citation.route}>{citation.title}</Link>
      {citation.subtitle && <div className="muted-sm">{citation.subtitle}</div>}
      {citation.pageNumber != null && (
        <div className="muted-sm">{t('assistant.sources.page', { page: citation.pageNumber })}</div>
      )}

      {/* §69/§171 — l'evidenza si mostra COSÌ COM'È, nella lingua della fonte.
          L'etichetta lo dice, perché una citazione in tedesco dentro
          un'interfaccia italiana sembra altrimenti una traduzione mancata. */}
      {citation.citedText && (
        <>
          <div className="as-source-quote-label">{t('assistant.sources.original')}</div>
          <blockquote className="ev-quote show as-quote" lang="">{citation.citedText}</blockquote>
          <div className="muted-sm">{t('assistant.sources.originalHint')}</div>
        </>
      )}

      {items.length > 0 && (
        <ul className="as-group">
          {items.map((i) => (
            <li key={i.route}><Link to={i.route}>{i.title}</Link></li>
          ))}
        </ul>
      )}

      <Link className="btn btn-sm mt-8" to={citation.route}>
        <Icon name="external" className="ic-sm" /> {t('assistant.sources.open')}
      </Link>
    </li>
  );
}
