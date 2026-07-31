// ============================================================================
// Inbox — l'elenco delle comunicazioni che possono richiedere attenzione.
//
// Non è un client di posta e non prova a esserlo: ogni riga porta soltanto ciò
// che serve a decidere se aprirla. Il corpo dei messaggi non entra mai in
// questa schermata (§105), la lista è paginata a cursore e la ricerca è
// server-side (§10/§104).
//
// Gli stati che l'utente vede sono quelli VERI: se una casella ha un problema
// di connessione lo dice, se una sincronizzazione è in corso lo dice, e se non
// c'è nulla da fare lo dice — invece di mostrare uno zero.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Button, EmptyCta, ErrorState, SkeletonLine } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { useCompany } from '@/contexts/CompanyContext';
import { useI18n, useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import { emailConnectionService, inboxErrorMessage } from '@/services/emailConnectionService';
import { inboxService } from '@/services/inboxService';
import { INITIAL_SYNC_DAYS, INITIAL_SYNC_MAX_MESSAGES } from './constants';
import { MessageDetail } from './MessageDetail';
import { AttentionBadge, ProcessingNote, senderLabel, subjectLabel } from './parts';
import type { EmailConnection, EmailMessageSummary, EmailProvider, InboxFilter } from '@/types/models';

const FILTERS: InboxFilter[] = ['all', 'to_handle', 'urgent', 'to_verify', 'handled'];
const FILTER_KEY = {
  all: 'inbox.filters.all',
  to_handle: 'inbox.filters.toHandle',
  urgent: 'inbox.filters.urgent',
  to_verify: 'inbox.filters.toVerify',
  handled: 'inbox.filters.handled',
} as const;

/** Data e ora nel formato locale: la posta si distingue anche per l'ora. */
function formatReceived(iso: string, localeTag: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(localeTag, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function InboxPage() {
  const t = useT();
  const { locale, localeTag } = useI18n();
  const { activeCompanyId, isAdmin } = useCompany();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const companyId = activeCompanyId as string;

  // ⚠️ Un identificativo MALFORMATO non è una selezione. Passato al servizio,
  // PostgREST risponde «invalid input syntax for type uuid: "abc"» e quella
  // stringa tecnica, in inglese, finisce a schermo dentro un'interfaccia che
  // può essere tedesca. È il difetto già chiuso su `/incentivi?progetto=abc`:
  // l'Inbox aveva la stessa apertura, e `/inbox?msg=abc` la mostrava.
  // Uno BEN FORMATO che non esiste RESTA una selezione, perché «non trovato»
  // è la risposta vera e va detta.
  const selectedId = isUuid(params.get('msg')) ? params.get('msg') : null;
  const filter = (FILTERS.includes(params.get('filter') as InboxFilter) ? params.get('filter') : 'all') as InboxFilter;
  const connectionFilter = params.get('account');

  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [providers, setProviders] = useState<EmailProvider[] | null>(null);
  const [items, setItems] = useState<EmailMessageSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Due errori distinti, di proposito. «Non riesco a leggere le caselle
  // collegate» e «non riesco a leggere i messaggi» sono guasti diversi, e
  // soprattutto NESSUNO dei due è «non hai caselle collegate»: mostrare lo
  // stato vuoto quando la lettura è fallita significa presentare un guasto come
  // una situazione normale — il fallback silenzioso che questo progetto non
  // ammette. Verificato nel browser il 2026-07-26: con la 0013 non ancora
  // applicata la pagina invitava serenamente a collegare un account.
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);

  // La ricerca non parte a ogni tasto: si aspetta che l'utente si fermi.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // §75 — al cambio azienda si ricomincia da capo: nessun residuo in stato
  // React dell'azienda precedente, nemmeno per un istante.
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setConnections([]);
    setProviders(null);
    setConnectionsLoaded(false);
  }, [companyId]);

  const loadConnections = useCallback(async () => {
    try {
      const [list, available] = await Promise.all([
        emailConnectionService.list(companyId),
        // §140 — lo stato mostrato deve essere quello REALE. Se il server non
        // ha credenziali per nessun provider, invitare a collegare una casella
        // sarebbe un invito a un errore. `null` = non lo sappiamo, e in quel
        // caso non si afferma nulla.
        emailConnectionService.availableProviders().catch(() => null),
      ]);
      setConnections(list);
      setProviders(available);
      setConnectionsError(null);
    } catch (e) {
      setConnections([]);
      setConnectionsError(toUserMessage(e));
    } finally {
      setConnectionsLoaded(true);
    }
  }, [companyId]);

  const loadPage = useCallback(async (reset: boolean, from: string | null) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const page = await inboxService.list({
        companyId,
        filter,
        search: search || null,
        connectionId: connectionFilter,
        cursor: from,
      });
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      setListError(null);
    } catch (e) {
      setListError(toUserMessage(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [companyId, filter, search, connectionFilter]);

  useEffect(() => { void loadConnections(); }, [loadConnections]);
  useEffect(() => { void loadPage(true, null); }, [loadPage]);


  // Esito del ritorno dal consenso OAuth. Il codice arriva nell'URL, mai un token.
  useEffect(() => {
    const connect = params.get('connect');
    if (!connect) return;
    if (connect === 'ok') showToast(`${t('inbox.connect.ok')} · ${t('inbox.connect.initialSync')}`);
    else if (connect === 'cancelled') showToast(t('inbox.connect.cancelled'));
    else showToast(inboxErrorMessage(params.get('code')) ?? t('inbox.connect.failed'));
    const next = new URLSearchParams(params);
    next.delete('connect');
    next.delete('code');
    setParams(next, { replace: true });
    void loadConnections();
    void loadPage(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('connect')]);

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'msg') next.delete('msg');
    setParams(next, { replace: true });
  };

  /**
   * Aprire un messaggio AGGIUNGE una voce alla cronologia, non la sostituisce.
   *
   * ⚠️ Era `replace`, e il tasto indietro del browser saltava l'elenco: da un
   * messaggio aperto dalla lista si usciva dall'Inbox in un colpo solo,
   * perché la voce della lista era stata sovrascritta. Con `push`:
   *   · dalla lista → indietro riporta ALLA LISTA;
   *   · da un documento (`/inbox?msg=…`) → indietro riporta AL DOCUMENTO,
   *     perché quella voce non è mai stata toccata.
   * Chiudere il messaggio con «Indietro» resta invece un `replace`: aggiungere
   * una seconda voce identica alla lista renderebbe il tasto indietro del
   * browser un clic a vuoto.
   */
  const openMessage = (messageId: string) => {
    const next = new URLSearchParams(params);
    next.set('msg', messageId);
    setParams(next);
  };

  const activeConnections = useMemo(
    () => connections.filter((c) => c.status !== 'disconnected'),
    [connections],
  );
  const syncable = useMemo(
    () => activeConnections.filter((c) => c.status === 'active' && c.syncEnabled),
    [activeConnections],
  );
  const needsReauth = useMemo(
    () => activeConnections.filter((c) => c.status === 'reauth_required'),
    [activeConnections],
  );
  // §66 — durante un import lungo l'intestazione diceva «Non ancora
  // sincronizzata» mentre decine di messaggi comparivano nella lista sotto.
  // Tecnicamente vero (`lastSuccessfulSyncAt` si valorizza a fine corsa), ma
  // per chi guarda è una contraddizione. Il lease è il fatto che dice se la
  // sincronizzazione sta lavorando ADESSO.
  const syncInProgress = useMemo(
    () => activeConnections.some((c) => c.syncLeaseUntil && new Date(c.syncLeaseUntil).getTime() > Date.now()),
    [activeConnections],
  );
  // Mentre una sincronizzazione lavora, la lista si aggiorna da sola: senza,
  // l'utente resterebbe davanti a un elenco fermo proprio nel momento in cui
  // sta cambiando. Polling e non realtime (§77): dura quanto la sincronizzazione
  // e si spegne da solo, che è la cosa più semplice che funziona.
  useEffect(() => {
    if (!syncInProgress) return;
    const timer = setInterval(() => {
      void loadConnections();
      void loadPage(true, null);
    }, 10_000);
    return () => clearInterval(timer);
  }, [syncInProgress, loadConnections, loadPage]);

  const lastSync = useMemo(() => {
    const times = activeConnections
      .map((c) => c.lastSuccessfulSyncAt)
      .filter((v): v is string => !!v)
      .sort();
    return times.length ? times[times.length - 1] : null;
  }, [activeConnections]);

  async function handleSync() {
    if (!syncable.length) return;
    setSyncing(true);
    try {
      const results = await Promise.all(
        syncable.map((c) => emailConnectionService.sync(c.id, locale).catch((e) => ({ error: e }))),
      );
      const added = results.reduce(
        (sum, r) => sum + (('counters' in (r as object)) ? (r as { counters: { messagesNew: number } }).counters.messagesNew : 0),
        0,
      );
      const failure = results.find((r) => 'error' in (r as object)) as { error: unknown } | undefined;
      // Il tempo di una singola esecuzione è finito prima del lavoro. Non è un
      // guasto e non è «niente di nuovo»: dirlo com'è evita che l'utente prema
      // di nuovo un pulsante per una cosa che sta già andando avanti da sola.
      const truncated = results.some((r) => (r as { code?: string }).code === 'TIME_BUDGET');
      if (failure) showToast(toUserMessage(failure.error));
      else if (truncated) showToast(inboxErrorMessage('TIME_BUDGET') ?? t('inbox.syncNothingNew'));
      else showToast(added === 0 ? t('inbox.syncNothingNew') : added === 1 ? t('inbox.syncNewOne') : t('inbox.syncNew', { n: added }));
      await loadConnections();
      await loadPage(true, null);
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setSyncing(false);
    }
  }

  // Il dettaglio è una schermata a sé su mobile e una colonna su desktop:
  // stessa rotta, stesso stato, nessuna duplicazione di logica.
  if (selectedId) {
    return (
      <MessageDetail
        messageId={selectedId}
        onBack={() => updateParam('msg', null)}
        onChanged={() => { void loadPage(true, null); }}
      />
    );
  }

  const hasConnection = activeConnections.length > 0;

  return (
    <>
      <div className="page-head">
        <div className="inbox-head">
          <div>
            <div className="page-title">{t('inbox.title')}</div>
            <div className="page-desc">{t('inbox.subtitle')}</div>
          </div>
          <div className="inbox-head-actions">
            {hasConnection && (
              <Button
                icon="refresh"
                loading={syncing}
                onClick={handleSync}
                disabled={!syncable.length}
              >
                {syncing ? t('inbox.syncing') : t('inbox.syncNow')}
              </Button>
            )}
            <Button icon="user" onClick={() => navigate('/inbox/account')}>
              {t('inbox.manageAccounts')}
            </Button>
          </div>
        </div>
        {hasConnection && (
          <div className="inbox-status">
            <span className="text-muted">
              {syncInProgress ? (
                <><span className="spinner" aria-hidden="true" /> {t('inbox.syncing')}</>
              ) : lastSync
                ? t('inbox.lastSync', { when: `${formatDate(lastSync)} ${new Date(lastSync).toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' })}` })
                : t('inbox.lastSyncNever')}
            </span>
            {needsReauth.map((c) => (
              <span key={c.id} className="badge badge-alta">
                <Icon name="alert" className="ic-sm" /> {c.emailAddress} · {t('inbox.accounts.reauthRequired')}
              </span>
            ))}
          </div>
        )}
      </div>

      {!connectionsLoaded && (
        <div className="card"><SkeletonLine width="60%" /><SkeletonLine width="80%" /><SkeletonLine width="45%" /></div>
      )}

      {/* Il guasto viene PRIMA di qualunque interpretazione: finché non si è
          potuto leggere lo stato delle caselle, non si afferma che non ce ne
          sono. */}
      {connectionsLoaded && connectionsError && (
        <div className="card">
          <ErrorState message={connectionsError} onRetry={() => { void loadConnections(); void loadPage(true, null); }} />
        </div>
      )}

      {connectionsLoaded && !connectionsError && !hasConnection && (
        <div className="card">
          <EmptyCta
            icon="inbox"
            title={t('inbox.empty.title')}
            subtitle={t('inbox.empty.subtitle')}
            action={
              providers !== null && providers.length === 0
                ? <span className="text-muted">{t('inbox.connect.noneConfigured')}</span>
                : isAdmin
                  ? <Button variant="primary" icon="plus" onClick={() => navigate('/inbox/account')}>{t('inbox.empty.cta')}</Button>
                  : <span className="text-muted">{t('inbox.connect.adminOnly')}</span>
            }
          />
          {(providers === null || providers.length > 0) && (
            <p className="muted-sm">{t('inbox.connect.scope', { days: INITIAL_SYNC_DAYS, max: INITIAL_SYNC_MAX_MESSAGES })}</p>
          )}
        </div>
      )}

      {connectionsLoaded && !connectionsError && hasConnection && (
        <div className="card">
          <div className="card-title">
            <span className="filter-group" role="group" aria-label={t('inbox.filtersAria')}>
              {FILTERS.map((f) => (
                <button
                  key={f}
                  className={`btn btn-sm${filter === f ? ' btn-primary' : ''}`}
                  onClick={() => updateParam('filter', f === 'all' ? null : f)}
                  aria-pressed={filter === f}
                >
                  {t(FILTER_KEY[f])}
                </button>
              ))}
            </span>
            <span className="inbox-tools">
              {activeConnections.length > 1 && (
                <select
                  className="select-inline"
                  value={connectionFilter ?? ''}
                  onChange={(e) => updateParam('account', e.target.value || null)}
                  aria-label={t('inbox.account.filterAria')}
                >
                  <option value="">{t('inbox.account.all')}</option>
                  {activeConnections.map((c) => (
                    <option key={c.id} value={c.id}>{c.emailAddress}</option>
                  ))}
                </select>
              )}
              <input
                className="inbox-search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('inbox.search.placeholder')}
                aria-label={t('inbox.search.aria')}
              />
            </span>
          </div>

          {loading && <><SkeletonLine width="70%" /><SkeletonLine width="85%" /><SkeletonLine width="60%" /></>}
          {listError && !loading && <ErrorState message={listError} onRetry={() => loadPage(true, null)} />}

          {!loading && !listError && items.length === 0 && (
            <div className="empty">
              {search ? t('inbox.search.none') : filter === 'all' ? t('inbox.emptyInbox.title') : t('inbox.emptyFilter')}
              {!search && filter === 'all' && <div className="muted-sm mt-10">{t('inbox.emptyInbox.subtitle')}</div>}
            </div>
          )}

          {!loading && !listError && items.length > 0 && (
            <ul className="inbox-list" aria-label={t('inbox.listAria')}>
              {items.map((m) => (
                <li key={m.id}>
                  <button
                    className={`inbox-row${m.seenAt ? '' : ' is-unseen'}`}
                    onClick={() => openMessage(m.id)}
                  >
                    <span className="inbox-row-main">
                      <span className="inbox-sender">{senderLabel(m, t)}</span>
                      <span className="inbox-subject">{subjectLabel(m.subject, t)}</span>
                      <span className="inbox-meta">
                        {formatReceived(m.receivedAt, localeTag)}
                        {m.attachmentCount > 0 && (
                          <> · {m.attachmentCount === 1 ? t('inbox.attachmentOne') : t('inbox.attachmentMany', { n: m.attachmentCount })}</>
                        )}
                        {m.deadline && <> · {t('inbox.deadlineFound', { date: formatDate(m.deadline) })}</>}
                      </span>
                      <ProcessingNote message={m} />
                    </span>
                    <span className="inbox-row-side">
                      <AttentionBadge message={m} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!loading && !listError && cursor && (
            <div className="inbox-more">
              <Button loading={loadingMore} onClick={() => loadPage(false, cursor)}>{t('inbox.loadMore')}</Button>
            </div>
          )}
          {!loading && !listError && items.length > 0 && (
            <div className="muted-sm mt-10">
              {items.length === 1 ? t('inbox.shownOne') : t('inbox.shown', { n: items.length })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
