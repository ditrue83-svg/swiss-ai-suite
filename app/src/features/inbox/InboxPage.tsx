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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tag } from '@/components/ui/Tag';
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
// L'elenco dei filtri arriva dal modulo PURO, non dal servizio: la barra li
// disegna, `counts()` li conta, e la fonte dev'essere una sola.
import { INBOX_FILTERS } from './scope';
import { INITIAL_SYNC_DAYS, INITIAL_SYNC_MAX_MESSAGES } from './constants';
import { MessageDetail } from './MessageDetail';
import { inboxEmphasis, type InboxEmphasis } from './emphasis';
import { AttentionBadge, ProcessingNote, senderLabel, subjectLabel } from './parts';
import type { EmailConnection, EmailMessageSummary, EmailProvider, InboxFilter } from '@/types/models';

const FILTERS = INBOX_FILTERS;
const FILTER_KEY = {
  all: 'inbox.filters.all',
  to_handle: 'inbox.filters.toHandle',
  urgent: 'inbox.filters.urgent',
  to_verify: 'inbox.filters.toVerify',
  handled: 'inbox.filters.handled',
  dismissed: 'inbox.filters.dismissed',
} as const;

/**
 * Una riga dell'elenco.
 *
 * Il PESO della riga arriva dalla classificazione, non dalla posizione: è tutta
 * qui la differenza fra un modulo che classifica e un modulo che si vede
 * classificare. Nel gruppo compresso la pastiglia non si ripete — direbbe «Non
 * amministrativa» su ogni riga di un gruppo che si chiama già così.
 */
function InboxRow({ message, emphasis, showBadge = true, onOpen }: {
  message: EmailMessageSummary;
  emphasis: InboxEmphasis;
  showBadge?: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const { localeTag } = useI18n();
  return (
    <button
      className={`inbox-row${emphasis === 'action' ? '' : ` is-${emphasis}`}${message.seenAt ? '' : ' is-unseen'}`}
      onClick={onOpen}
    >
      <span className="inbox-row-main">
        <span className="inbox-sender">{senderLabel(message, t)}</span>
        <span className="inbox-subject">{subjectLabel(message.subject, t)}</span>
        <span className="inbox-meta">
          {formatReceived(message.receivedAt, localeTag)}
          {message.attachmentCount > 0 && (
            <> · {message.attachmentCount === 1 ? t('inbox.attachmentOne') : t('inbox.attachmentMany', { n: message.attachmentCount })}</>
          )}
          {message.deadline && <> · {t('inbox.deadlineFound', { date: formatDate(message.deadline) })}</>}
        </span>
        <ProcessingNote message={message} />
      </span>
      {showBadge && (
        <span className="inbox-row-side">
          <AttentionBadge message={message} />
        </span>
      )}
    </button>
  );
}

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

  // ⚠️ SI DIVIDE SOLO «TUTTE», ed è una scelta, non una dimenticanza. Gli altri
  // quattro filtri sono una domanda esplicita dell'utente — «fammi vedere le
  // messe via» — e a una domanda esplicita si risponde per intero: comprimere
  // là significherebbe rispondere a metà a chi ha già detto cosa vuole.
  // È il DEFAULT a essere sbagliato oggi, non il filtro.
  const splitByEmphasis = filter === 'all';
  // Nell'indirizzo e non nello stato React: chi apre le compresse e ricarica la
  // pagina deve ritrovarle aperte, e il collegamento deve poter essere condiviso.
  const collapsedOpen = params.get('compresse') === '1';

  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [providers, setProviders] = useState<EmailProvider[] | null>(null);
  const [items, setItems] = useState<EmailMessageSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // I compressi: quanti sono, e — solo se aperti — quali. Finché la riga resta
  // chiusa quei messaggi non si scaricano affatto; il numero sì, perché una
  // riga che dicesse «alcuni messaggi» non direbbe niente.
  // ⚠️ `null` finché non si sa, e MAI zero come ripiego: un bottone che dice
  // «0» prima di aver contato afferma che quella vista è vuota, ed è la stessa
  // bugia del fallback silenzioso — solo scritta più piccola.
  const [counts, setCounts] = useState<Record<InboxFilter, number> | null>(null);
  const [evidenceCount, setEvidenceCount] = useState<number | null>(null);
  const [collapsedCount, setCollapsedCount] = useState<number | null>(null);
  const [collapsedItems, setCollapsedItems] = useState<EmailMessageSummary[]>([]);
  const [collapsedCursor, setCollapsedCursor] = useState<string | null>(null);
  const [collapsedLoading, setCollapsedLoading] = useState(false);
  const [collapsedError, setCollapsedError] = useState<string | null>(null);
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
    setCounts(null);
    setEvidenceCount(null);
    setCollapsedCount(null);
    setCollapsedItems([]);
    setCollapsedCursor(null);
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

  // ⚠️⚠️ QUALE RISPOSTA STA GUARDANDO LA PAGINA. L'effetto qui sopra svuota
  // l'elenco al cambio azienda, ma NON ferma la richiesta già partita: quella
  // continua per conto suo e, se risolve dopo, ridipinge la posta dell'azienda
  // PRECEDENTE sotto l'intestazione di quella nuova — §75 violato da una
  // promessa in ritardo, e nessuno stato React che lo dichiari. Lo stesso con
  // la ricerca: due richieste in volo, e vince quella che risolve per ultima,
  // che non è quella che l'utente sta aspettando.
  //
  // Il contatore dice qual è la richiesta CORRENTE. Ogni chiamata prende il suo
  // numero prima di partire e, al ritorno, scrive solo se è ancora lei: è lo
  // schema di `useAsync` (`let active = true` + pulizia), portato qui dove la
  // chiamata non nasce da un effetto ma da un pulsante «carica altri».
  const richiestaElenco = useRef(0);

  const loadPage = useCallback(async (reset: boolean, from: string | null) => {
    const mia = ++richiestaElenco.current;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const base = {
        companyId,
        filter,
        search: search || null,
        connectionId: connectionFilter,
      };
      // ⚠️ ELENCO E CONTEGGIO VIAGGIANO INSIEME, e non è un'ottimizzazione.
      // Separandoli esisterebbe un istante — e un caso di errore permanente —
      // in cui la pagina ha l'elenco vuoto e non sa ancora dei compressi: lì
      // direbbe «Inbox vuota» con 72 messaggi dietro. Se il conteggio non si
      // legge, non si legge nemmeno l'elenco, e si vede un errore con «riprova»
      // invece di una pagina serenamente vuota.
      const [page, conteggi] = await Promise.all([
        inboxService.list({
          ...base,
          emphasis: splitByEmphasis ? 'in_evidence' : undefined,
          cursor: from,
        }),
        // ⚠️ I CONTEGGI VIAGGIANO CON L'ELENCO, e non è un'ottimizzazione: è la
        // stessa ragione di prima. Separandoli esisterebbe un istante in cui la
        // pagina ha l'elenco vuoto e non sa ancora quanto ha compresso, e lì
        // direbbe «Inbox vuota» con 72 messaggi dietro. Costa sei
        // interrogazioni di sola testata anche quando si cambia solo filtro:
        // il prezzo è misurabile, la contraddizione no.
        reset ? inboxService.counts(base) : Promise.resolve(null),
      ]);
      // ⚠️ PRIMA di ogni scrittura, non solo della prima: fra l'`await` e qui
      // può essere partita una richiesta nuova. Un `return` dentro il `try`
      // esegue comunque il `finally`, che ha la stessa guardia.
      if (mia !== richiestaElenco.current) return;
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      if (reset && conteggi) {
        setCounts(conteggi);
        // ⚠️ «In evidenza» non si conta: SI SOTTRAE. Le due metà di «Tutte»
        // sono un complemento esatto (`emphasis.ts`), quindi una sesta
        // interrogazione direbbe un numero che questi due già dicono — e il
        // giorno in cui non coincidessero avremmo due verità invece di un rosso.
        setEvidenceCount(splitByEmphasis ? conteggi.all - conteggi.collapsed : null);
        setCollapsedCount(splitByEmphasis ? conteggi.collapsed : null);
      }
      setListError(null);
    } catch (e) {
      // ⚠️ Anche il GUASTO di una richiesta sorpassata va taciuto: mostrare
      // l'errore dell'azienda precedente su quella nuova manderebbe a cercare
      // il problema dalla parte sbagliata.
      if (mia !== richiestaElenco.current) return;
      setListError(toUserMessage(e));
    } finally {
      // ⚠️ E la rotella: se la spegnesse anche una richiesta sorpassata, la
      // pagina si dichiarerebbe pronta mentre quella vera è ancora in volo.
      if (mia === richiestaElenco.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [companyId, filter, search, connectionFilter, splitByEmphasis]);

  /**
   * I compressi, quando qualcuno li chiede. Paginati come l'elenco principale:
   * settantadue righe non si scaricano in blocco solo perché stanno dietro un
   * clic.
   */
  // Contatore SUO, non quello dell'elenco: i compressi sono una richiesta
  // indipendente, e condividere il contatore farebbe annullare l'una dall'altra.
  const richiestaCompressi = useRef(0);

  const loadCollapsed = useCallback(async (reset: boolean, from: string | null) => {
    const mia = ++richiestaCompressi.current;
    setCollapsedLoading(true);
    try {
      const page = await inboxService.list({
        companyId,
        filter: 'all',
        emphasis: 'collapsed',
        search: search || null,
        connectionId: connectionFilter,
        cursor: from,
      });
      if (mia !== richiestaCompressi.current) return;
      setCollapsedItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCollapsedCursor(page.nextCursor);
      setCollapsedError(null);
    } catch (e) {
      if (mia !== richiestaCompressi.current) return;
      setCollapsedError(toUserMessage(e));
    } finally {
      if (mia === richiestaCompressi.current) setCollapsedLoading(false);
    }
  }, [companyId, search, connectionFilter]);

  useEffect(() => { void loadConnections(); }, [loadConnections]);
  useEffect(() => { void loadPage(true, null); }, [loadPage]);
  useEffect(() => {
    if (!splitByEmphasis || !collapsedOpen) {
      setCollapsedItems([]);
      setCollapsedCursor(null);
      setCollapsedError(null);
      return;
    }
    void loadCollapsed(true, null);
  }, [splitByEmphasis, collapsedOpen, loadCollapsed]);

  /** Dopo un cambiamento vero (sincronizzazione, «messa via») si rilegge ciò che è a schermo. */
  const reloadVisible = () => {
    void loadPage(true, null);
    if (splitByEmphasis && collapsedOpen) void loadCollapsed(true, null);
  };


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
      if (splitByEmphasis && collapsedOpen) void loadCollapsed(true, null);
    }, 10_000);
    return () => clearInterval(timer);
  }, [syncInProgress, loadConnections, loadPage, loadCollapsed, splitByEmphasis, collapsedOpen]);

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
      reloadVisible();
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
        onChanged={reloadVisible}
      />
    );
  }

  const hasConnection = activeConnections.length > 0;
  // Quanti messaggi sono piegati in fondo. Arriva dal server insieme
  // all'elenco, non dal conteggio delle righe già caricate: la pagina ne tiene
  // 30 alla volta, e su questa casella i compressi sono 72.
  const compressi = splitByEmphasis ? (collapsedCount ?? 0) : 0;

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
              <Tag key={c.id} tone="alert">
                <Icon name="alert" className="ic-sm" /> {c.emailAddress} · {t('inbox.accounts.reauthRequired')}
              </Tag>
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
            art="inbox"
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
              {/* ⚠️ IL NUMERO STA SUL BOTTONE, e serve a una cosa sola: dire
                  PRIMA del clic che cosa si trova. Misurato il 2026-08-16 sulla
                  casella vera: dei cinque filtri, «Con scadenza vicina» e
                  «Messe via» erano entrambi a zero — due bottoni su cinque che
                  portavano a una schermata vuota senza dirlo. Non erano
                  ridondanti: erano muti.
                  Lo zero si MOSTRA, e il bottone resta premibile: spegnerlo
                  toglierebbe anche il modo di verificare che è davvero vuoto, e
                  lo stato vuoto della pagina lo spiega meglio di un bottone
                  spento. Un numero assente (`null`) è «non lo so ancora», e si
                  tace: è diverso da zero e non va confuso con esso. */}
              {FILTERS.map((f) => (
                <button
                  key={f}
                  className={`btn btn-sm${filter === f ? ' btn-primary' : ''}`}
                  onClick={() => updateParam('filter', f === 'all' ? null : f)}
                  aria-pressed={filter === f}
                >
                  {t(FILTER_KEY[f])}
                  {counts && <span className="filter-count">{counts[f]}</span>}
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

          {/* ⚠️ «Non c'è niente» e «non c'è niente DA GESTIRE» sono due frasi
              diverse, e dirne una per l'altra sarebbe assurdo: una pagina vuota
              con sotto «72 messaggi nascosti» racconta due cose che non stanno
              insieme. Quando qualcosa è stato compresso, lo stato vuoto parla
              solo dell'insieme che ha davvero svuotato. */}
          {!loading && !listError && items.length === 0 && (
            <div className="empty">
              {compressi > 0
                ? (search ? t('inbox.search.noneInEvidence') : t('inbox.emptyAdministrative.title'))
                : (search ? t('inbox.search.none') : filter === 'all' ? t('inbox.emptyInbox.title') : t('inbox.emptyFilter'))}
              {compressi > 0 && !search && (
                <div className="muted-sm mt-10">{t('inbox.emptyAdministrative.subtitle')}</div>
              )}
              {compressi === 0 && !search && filter === 'all' && (
                <div className="muted-sm mt-10">{t('inbox.emptyInbox.subtitle')}</div>
              )}
            </div>
          )}

          {!loading && !listError && items.length > 0 && (
            <ul className="inbox-list" aria-label={t('inbox.listAria')}>
              {items.map((m) => (
                <li key={m.id}>
                  {/* ⚠️ IL PESO SOLO DOVE SI DIVIDE. Gli altri quattro filtri sono
                      una domanda esplicita — «fammi vedere le messe via» — e la
                      scelta scritta in cima a questa pagina è che a una domanda
                      esplicita si risponde per intero. Senza questa condizione il
                      markup contraddiceva quel commento: su «Messe via» ogni riga
                      è `handled`, quindi l'elenco INTERO usciva a peso ridotto. */}
                  <InboxRow
                    message={m}
                    emphasis={splitByEmphasis ? inboxEmphasis(m) : 'action'}
                    onOpen={() => openMessage(m.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {!loading && !listError && cursor && (
            <div className="inbox-more">
              <Button loading={loadingMore} onClick={() => loadPage(false, cursor)}>{t('inbox.loadMore')}</Button>
            </div>
          )}
          {/* ⚠️ Il numero dichiara l'INSIEME, non la memoria del browser: con 76
              in evidenza e 30 caricate, «30 comunicazioni» sarebbe falso di 46.
              La forma «30 di 76» compare solo quando le due cifre differiscono —
              a elenco completo un «76 di 76» sarebbe rumore. */}
          {!loading && !listError && items.length > 0 && (
            <div className="muted-sm mt-10">
              {splitByEmphasis
                ? (evidenceCount !== null && evidenceCount > items.length
                    ? t('inbox.shownEvidenceOf', { shown: items.length, total: evidenceCount })
                    : items.length === 1 ? t('inbox.shownEvidenceOne') : t('inbox.shownEvidence', { n: items.length }))
                : (items.length === 1 ? t('inbox.shownOne') : t('inbox.shown', { n: items.length }))}
            </div>
          )}

          {/* ---- I compressi ---------------------------------------------
              Una riga sola, in fondo, che dice quanti sono e li riapre. Non
              sono archiviati, non sono messi via, non sono usciti dalla
              ricerca: sono soltanto piegati. */}
          {!loading && !listError && splitByEmphasis && compressi > 0 && (
            <div className="inbox-collapsed">
              <div className="inbox-collapsed-head">
                <span className="inbox-collapsed-count">
                  {compressi === 1 ? t('inbox.collapsed.one') : t('inbox.collapsed.many', { n: compressi })}
                </span>
                {' — '}
                <button
                  type="button"
                  className="btn-link"
                  aria-expanded={collapsedOpen}
                  aria-controls="inbox-collapsed-list"
                  onClick={() => updateParam('compresse', collapsedOpen ? null : '1')}
                >
                  {collapsedOpen ? t('inbox.collapsed.hide') : t('inbox.collapsed.show')}
                </button>
              </div>

              <div id="inbox-collapsed-list">
                {collapsedOpen && collapsedError && (
                  <ErrorState message={collapsedError} onRetry={() => loadCollapsed(true, null)} />
                )}
                {collapsedOpen && collapsedLoading && !collapsedItems.length && (
                  <><SkeletonLine width="70%" /><SkeletonLine width="55%" /></>
                )}
                {collapsedOpen && collapsedItems.length > 0 && (
                  <>
                    <ul className="inbox-list" aria-label={t('inbox.collapsed.listAria')}>
                      {collapsedItems.map((m) => (
                        <li key={m.id}>
                          <InboxRow
                            message={m}
                            emphasis="collapsed"
                            showBadge={false}
                            onOpen={() => openMessage(m.id)}
                          />
                        </li>
                      ))}
                    </ul>
                    {collapsedCursor && (
                      <div className="inbox-more">
                        <Button loading={collapsedLoading} onClick={() => loadCollapsed(false, collapsedCursor)}>
                          {t('inbox.loadMore')}
                        </Button>
                      </div>
                    )}
                    {/* Il numero in cima promette 72; qui sotto se ne vedono 30.
                        Ogni conteggio dichiara il proprio insieme, o si contraddicono. */}
                    {collapsedItems.length < compressi && (
                      <div className="muted-sm mt-10">
                        {t('inbox.collapsed.shown', { shown: collapsedItems.length, total: compressi })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
