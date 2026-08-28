// ============================================================================
// Finanze — fatture fornitori, ricevute, note di credito.
//
// ⚠️⚠️ IL MODULO COMPRENDE E PREPARA IL DENARO, NON LO MUOVE.
// In questa schermata non esiste — e non deve esistere — un pulsante «Paga»,
// un file di pagamento, un collegamento generato da un IBAN o un QR
// ricostruito. Un IBAN si mostra accanto alla sua provenienza, e basta.
//
// La domanda a cui la pagina risponde non è «quanto abbiamo speso» ma «che cosa
// richiede attenzione»: per questo i quattro numeri in alto sono da verificare,
// in scadenza, scadute e spese del mese, e per questo l'ordinamento predefinito
// mette davanti ciò che scade o non torna.
//
// Tutto il lavoro sta nel database (`list_finance_items`): filtri, ricerca,
// ordinamento, duplicato sospetto, conteggio totale e composizione delle
// relazioni. Qui si scelgono i filtri e si mostra il risultato — con
// venticinque righe alla volta, anche con duemila fatture.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Tag } from '@/components/ui/Tag';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import { ProvenanceMark } from '@/components/ui/ProvenanceMark';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { ErrorState, EmptyCta, SkeletonLine, SkeletonKpiGrid } from '@/components/ui/states';
import { financeService } from '@/services/financeService';
import { documentHubService } from '@/services/documentHubService';
import { formatDate } from '@/lib/format';
import { causaDelGuasto } from '@/lib/errorCause';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT, type TFunction, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { useDocumentLabel } from '@/i18n/documentLabel';
import {
  DEFAULT_DUE_DAYS, DOCUMENT_SOURCES, EXPENSE_CATEGORIES, FINANCE_COMMON_CURRENCIES,
  FINANCE_PAGE_SIZE, PROCESSINGS, REVIEWS, SORTS, TABS,
  filtersFromParams, financeState, formatDecimal, hasActiveFilters, oldestPendingMinutes,
  paramsFromFilters, queueLooksStalled, stateBadgeKey, withoutCurrency,
  type FinanceBadgeKey, type FinanceTab,
} from './financeModel';
import { cx } from '@/lib/cx';
import styles from './finance.module.css';
import type {
  DocumentHubItem, DocumentSourceType, FinanceExpenseCategory, FinanceFilters, FinanceItem,
  FinanceItemType, FinanceProcessingStatus, FinanceReviewStatus, FinanceSort, FinanceSummary,
  FinanceTotal,
} from '@/types/models';

// ---------------------------------------------------------------------------
// Le chiavi degli elenchi chiusi. Sono `Record` completi e non funzioni con
// ripiego: se domani la 0021 aggiungesse un valore all'enum, il compilatore
// fallirebbe QUI invece di mostrare una casella vuota nei filtri.
// ---------------------------------------------------------------------------
const SORT_KEY: Record<FinanceSort, TKey> = {
  default: 'finance.sort.default',
  due_date: 'finance.sort.dueDate',
  amount: 'finance.sort.amount',
  recent: 'finance.sort.recent',
  supplier: 'finance.sort.supplier',
};
const TAB_KEY: Record<FinanceTab, TKey> = {
  invoices: 'finance.tabs.invoices',
  expenses: 'finance.tabs.expenses',
};
const SOURCE_KEY: Record<DocumentSourceType, TKey> = {
  upload: 'documents.sources.upload',
  email: 'documents.sources.email',
  pasted_text: 'documents.sources.pasted_text',
};

/** Il nome della sezione nell'indirizzo. Vedi `writeParams` per il perché. */
const TAB_PARAM = 'sezione';

/**
 * ⚠️ LA SEZIONE VIAGGIA NELL'INDIRIZZO, MA NON È UN FILTRO.
 *
 * `financeModel` tiene deliberatamente `tab` fuori da `paramsFromFilters`,
 * perché concettualmente è il percorso: fatture e spese sono due elenchi, non
 * due valori di un menu a tendina. Il percorso però è già occupato —
 * `/finanze/spese` sarebbe indistinguibile da `/finanze/:id` — e allora la
 * sezione si scrive accanto ai filtri senza entrare nel loro modello: qui, in
 * un punto solo, e mai dentro `FinanceFilters`.
 *
 * Scartata l'alternativa di tenerla in `useState`: ricaricando la pagina si
 * tornerebbe alle fatture con i filtri delle spese ancora attivi, e nessun
 * collegamento a «le spese di luglio» sarebbe mandabile a un collega.
 */
function writeParams(filters: FinanceFilters, tab: FinanceTab): URLSearchParams {
  const p = paramsFromFilters(filters);
  // La sezione predefinita non si scrive: un indirizzo pulito è anche un
  // indirizzo che si legge.
  if (tab !== 'invoices') p.set(TAB_PARAM, tab);
  return p;
}

function tabFromParams(params: URLSearchParams): FinanceTab {
  const v = params.get(TAB_PARAM);
  return (TABS as readonly string[]).includes(v ?? '') ? (v as FinanceTab) : 'invoices';
}

/**
 * Una pagina alla volta, SOSTITUENDO — non accodando.
 *
 * È la differenza con Documenti, ed è voluta: là si esplora un archivio e
 * «Mostra altri» ha senso; qui si lavora una coda di documenti che richiedono
 * attenzione, e una lista che cresce senza fine fa perdere il segno di dove si
 * era arrivati. La paginazione con il totale dice anche quanto manca.
 */
function useFinanceList(companyId: string, filters: FinanceFilters, tab: FinanceTab) {
  // Le dipendenze sono i VALORI, non l'oggetto: un oggetto nuovo a ogni render
  // rifarebbe la richiesta a ogni battuta di tasto.
  const key = JSON.stringify({ companyId, tab, ...filters });

  // ⚠️ I risultati portano con sé la CHIAVE a cui appartengono, e non si
  // svuotano in un effetto. Svuotarli in un effetto lascerebbe un fotogramma in
  // cui la schermata mostra le fatture dell'azienda precedente sotto il nome di
  // quella nuova — su un prodotto multi-azienda è un difetto, non un dettaglio.
  const [state, setState] = useState<{ key: string; items: FinanceItem[]; total: number }>(
    { key, items: [], total: 0 },
  );
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fresh = state.key === key;

  // Cambiando filtro, sezione o azienda si riparte dalla prima pagina: la
  // pagina tre di un elenco diverso non vuol dire niente.
  useEffect(() => { setPage(0); }, [key]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    financeService.list(companyId, {
      ...filters, tab, limit: FINANCE_PAGE_SIZE, offset: page * FINANCE_PAGE_SIZE,
    })
      .then((result) => { if (active) setState({ key, items: result.items, total: result.total }); })
      .catch((e) => {
        if (!active) return;
        // ⚠️ L'ELENCO SI SVUOTA E L'ERRORE RESTA. Tenere le righe precedenti
        // accanto a un messaggio di errore mostrerebbe dati vecchi come se
        // fossero il risultato dei filtri nuovi.
        setError(toUserMessage(e));
        setState({ key, items: [], total: 0 });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page, tick]);

  return {
    items: fresh ? state.items : [],
    total: fresh ? state.total : 0,
    loading: loading || !fresh,
    error,
    page,
    setPage,
    reload: () => setTick((n) => n + 1),
  };
}

export function FinancePage() {
  const t = useT();
  const L = useLabels();
  const { localeTag } = useI18n();
  const { activeCompanyId } = useCompany();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;

  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const tab = tabFromParams(params);

  // Il campo di ricerca è locale e si applica quando si smette di scrivere:
  // scrivere nell'indirizzo a ogni tasto riempirebbe la cronologia del browser.
  // `replace: true` per la stessa ragione.
  const [search, setSearch] = useState(filters.query ?? '');
  useEffect(() => { setSearch(filters.query ?? ''); }, [filters.query]);
  useEffect(() => {
    const current = filters.query ?? '';
    if (search.trim() === current.trim()) return;
    const timer = setTimeout(() => {
      setParams(writeParams({ ...filters, query: search }, tab), { replace: true });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const list = useFinanceList(companyId, filters, tab);
  const [showFilters, setShowFilters] = useState(false);
  const [adding, setAdding] = useState<FinanceItemType | null>(null);

  // ---- I quattro numeri del cruscotto -------------------------------------
  // Caricati a parte dalla lista: i filtri NON li toccano, perché «tre fatture
  // scadute» è un fatto dell'azienda e non del filtro attivo. Se cambiassero
  // con i filtri, chi ne toglie uno crederebbe che siano cambiate le fatture.
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setSummary(null);
    setSummaryError(null);
    setSummaryLoading(true);
    financeService.summary(companyId, DEFAULT_DUE_DAYS)
      .then((s) => { if (active) setSummary(s); })
      // ⚠️ Un cruscotto che non si è potuto leggere NON diventa quattro zeri:
      // «nessuna fattura scaduta» e «non ho potuto contarle» sono due frasi
      // diverse, e la seconda è quella vera.
      .catch((e) => { if (active) setSummaryError(toUserMessage(e)); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [companyId, list.total]);

  function update(change: Partial<FinanceFilters>) {
    setParams(writeParams({ ...filters, ...change }, tab));
  }

  function selectTab(next: FinanceTab) {
    // Passando alle spese la categoria di spesa non ha più senso sulle fatture
    // e viceversa: si toglie invece di lasciarla attiva e invisibile.
    setParams(writeParams({ ...filters, category: null }, next));
  }

  function resetFilters() {
    setParams(writeParams({}, tab));
  }

  const filtersActive = hasActiveFilters(filters);
  const reviewOnly = filters.review === 'needs_review';
  const totalPages = Math.max(1, Math.ceil(list.total / FINANCE_PAGE_SIZE));

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('finance.title')}</div>
        <div className="page-desc">{t('finance.subtitle')}</div>
      </div>

      {/* ---- I quattro numeri ------------------------------------------- */}
      {summaryLoading && <SkeletonKpiGrid />}
      {/* ⚠️ LO STESSO GUASTO NON SI DICHIARA DUE VOLTE.
          I numeri e l'elenco vengono da due interrogazioni diverse, ma quando a
          mancare è il modulo intero — la migrazione non applicata, i permessi,
          la rete — falliscono ENTRAMBE con lo stesso messaggio, e la pagina lo
          ripeteva in due riquadri rossi identici. Chi legge non ha modo di
          sapere se i problemi sono uno o due. È lo stesso difetto trovato nel
          calendario, dove «Nessun provider configurato» compariva due volte
          perché due rami lo rendevano. Se i due messaggi coincidono, lo dice
          solo quello in testa. */}
      {!summaryLoading && summaryError && summaryError !== list.error && (
        <ErrorState message={summaryError} />
      )}
      {!summaryLoading && !summaryError && summary && (
        <div className="kpi-grid">
          <Link className="kpi kpi-link" to={`/finanze?verifica=needs_review${tab === 'expenses' ? `&${TAB_PARAM}=expenses` : ''}`}>
            <div className="kpi-label">{t('finance.kpi.needsReview')}</div>
            <div className="kpi-value">{summary.needsReview}</div>
            <div className="kpi-sub">{t('finance.kpi.needsReviewHint')}</div>
          </Link>
          <KpiTotals
            label={t('finance.kpi.dueSoon')} hint={t('finance.kpi.dueSoonHint')}
            totals={summary.dueSoon} localeTag={localeTag} t={t}
          />
          <KpiTotals
            label={t('finance.kpi.overdue')} hint={t('finance.kpi.overdueHint')}
            totals={summary.overdue} localeTag={localeTag} t={t} alert
          />
          <KpiTotals
            label={t('finance.kpi.expensesMonth')} hint={t('finance.kpi.expensesMonthHint')}
            totals={summary.expensesMonth} localeTag={localeTag} t={t}
          />
        </div>
      )}

      {/* ---- Sezione, ricerca, aggiunta ---------------------------------- */}
      <div className="tabs mt-16" role="tablist" aria-label={t('finance.title')}>
        {TABS.map((v) => (
          <button
            key={v} role="tab" id={`fin-tab-${v}`} aria-selected={tab === v}
            aria-controls="fin-list"
            className={`tab${tab === v ? ' active' : ''}`}
            onClick={() => selectTab(v)}
          >
            {t(TAB_KEY[v])}
          </button>
        ))}
      </div>

      <div className="row-wrap">
        <div className={cx('field', styles.finSearch)}>
          <label htmlFor="fin-search">{t('finance.filters.search')}</label>
          <input
            id="fin-search" type="search" value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-describedby="fin-search-hint"
          />
          <div className="muted-sm" id="fin-search-hint">{t('finance.filters.searchHint')}</div>
        </div>
        {/* ⚠️ NON SI OFFRE UN'AZIONE CHE NON PUÒ RIUSCIRE.
            Quando l'elenco non si è potuto leggere, aggiungere una spesa o una
            fattura fallirebbe per la stessa ragione: i due pulsanti
            porterebbero a un rifiuto, che è esattamente ciò che è già successo
            con i modelli delle automazioni offerti a migrazione mancante e con
            «Collega calendario» offerto senza credenziali. Il guasto è
            dichiarato sopra: qui non si aggiunge una promessa. */}
        {!list.error && (
          <div className={styles.finActions}>
            <button className="btn btn-sm" onClick={() => setAdding('receipt')}>
              <Icon name="plus" className="ic-sm" /> {t('finance.list.addExpense')}
            </button>
            <button className="btn btn-sm" onClick={() => setAdding('supplier_invoice')}>
              <Icon name="document" className="ic-sm" /> {t('finance.list.addFromDocument')}
            </button>
          </div>
        )}
      </div>

      {adding && (
        <AddFromDocument
          companyId={companyId} initialType={adding}
          onClose={() => setAdding(null)}
          onAdded={(message) => { setAdding(null); showToast(message); list.reload(); }}
        />
      )}

      {/* ---- Filtri ------------------------------------------------------ */}
      <div className="card mt-16">
        <div className="card-title">
          <span className={cx('filter-group', styles.finTools)}>
            {/* Il filtro rapido: la coda di lavoro vera del modulo. */}
            <button
              className="btn btn-sm btn-toggle"
              aria-pressed={reviewOnly}
              onClick={() => update({ review: reviewOnly ? null : 'needs_review' })}
            >
              {t('finance.kpi.needsReview')}
            </button>
            <button
              className="btn btn-sm btn-toggle"
              aria-pressed={filters.duplicates === true}
              onClick={() => update({ duplicates: !filters.duplicates })}
            >
              {t('finance.filters.duplicates')}
            </button>
          </span>
          <span className={cx('filter-group', styles.finTools)}>
            <div className="field m-0">
              <select
                className="select-inline" value={filters.sort ?? 'default'}
                aria-label={t('finance.filters.sort')}
                onChange={(e) => update({ sort: e.target.value as FinanceSort })}
              >
                {SORTS.map((s) => <option key={s} value={s}>{t(SORT_KEY[s])}</option>)}
              </select>
            </div>
            {/* ⚠️ NON `finance.filters.all`, che è «Tutti»: quella parola è la
                voce «nessun filtro» dentro i menu a tendina qui sotto, e su un
                pulsante che apre un pannello non significa niente — provato nel
                browser, si legge come «mostrami tutto». Le due frasi giuste
                esistono già nel dizionario dei Documenti e dicono esattamente
                ciò che il pulsante fa; riscriverle sotto `finance` avrebbe
                creato due testi da tenere allineati a mano. */}
            <button
              className="btn btn-sm btn-toggle"
              aria-pressed={showFilters}
              aria-expanded={showFilters} aria-controls="fin-filters"
              onClick={() => setShowFilters((v) => !v)}
            >
              {showFilters ? t('documents.filtersHide') : t('documents.filtersShow')}
            </button>
          </span>
        </div>

        {showFilters && (
          <div className={styles.finFilters} id="fin-filters">
            <div className="field">
              <label htmlFor="f-review">{t('finance.filters.review')}</label>
              <select
                id="f-review" value={filters.review ?? ''}
                onChange={(e) => update({ review: (e.target.value || null) as FinanceReviewStatus | null })}
              >
                <option value="">{t('finance.filters.all')}</option>
                {REVIEWS.map((r) => <option key={r} value={r}>{L.financeReview(r)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-processing">{t('finance.filters.processing')}</label>
              <select
                id="f-processing" value={filters.processing ?? ''}
                onChange={(e) => update({ processing: (e.target.value || null) as FinanceProcessingStatus | null })}
              >
                <option value="">{t('finance.filters.all')}</option>
                {PROCESSINGS.map((p) => <option key={p} value={p}>{L.financeProcessing(p)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-supplier">{t('finance.filters.supplier')}</label>
              <input
                id="f-supplier" value={filters.supplier ?? ''}
                onChange={(e) => update({ supplier: e.target.value || null })}
              />
            </div>
            <div className="field">
              <label htmlFor="f-currency">{t('finance.filters.currency')}</label>
              {/* ⚠️ Le valute comuni sono una PROPOSTA, non un elenco chiuso: una
                  fattura in SEK esiste, viene letta e deve poter essere filtrata.
                  Perciò un campo con `datalist` e non un menu a tendina. */}
              <input
                id="f-currency" list="fin-currencies" maxLength={3}
                value={filters.currency ?? ''}
                onChange={(e) => update({ currency: e.target.value || null })}
              />
              <datalist id="fin-currencies">
                {FINANCE_COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="f-source">{t('finance.filters.source')}</label>
              <select
                id="f-source" value={filters.source ?? ''}
                onChange={(e) => update({ source: (e.target.value || null) as DocumentSourceType | null })}
              >
                <option value="">{t('finance.filters.all')}</option>
                {DOCUMENT_SOURCES.map((s) => <option key={s} value={s}>{t(SOURCE_KEY[s])}</option>)}
              </select>
            </div>
            {/* La categoria di spesa esiste solo sulle ricevute: mostrarla fra le
                fatture sarebbe un filtro che non restringe niente. */}
            {tab === 'expenses' && (
              <div className="field">
                <label htmlFor="f-category">{t('finance.filters.category')}</label>
                <select
                  id="f-category" value={filters.category ?? ''}
                  onChange={(e) => update({ category: (e.target.value || null) as FinanceExpenseCategory | null })}
                >
                  <option value="">{t('finance.filters.all')}</option>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{L.expenseCategory(c)}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="f-from">{t('finance.filters.dateFrom')}</label>
              <input id="f-from" type="date" value={filters.dateFrom ?? ''}
                onChange={(e) => update({ dateFrom: e.target.value || null })} />
            </div>
            <div className="field">
              <label htmlFor="f-to">{t('finance.filters.dateTo')}</label>
              <input id="f-to" type="date" value={filters.dateTo ?? ''}
                onChange={(e) => update({ dateTo: e.target.value || null })} />
            </div>
            {tab === 'invoices' && (
              <>
                <div className="field">
                  <label htmlFor="f-due-from">{t('finance.filters.dueFrom')}</label>
                  <input id="f-due-from" type="date" value={filters.dueFrom ?? ''}
                    onChange={(e) => update({ dueFrom: e.target.value || null })} />
                </div>
                <div className="field">
                  <label htmlFor="f-due-to">{t('finance.filters.dueTo')}</label>
                  <input id="f-due-to" type="date" value={filters.dueTo ?? ''}
                    onChange={(e) => update({ dueTo: e.target.value || null })} />
                </div>
              </>
            )}
            <div className={cx(styles.finFilterWide, styles.finChecks)}>
              <label className="check-pill" htmlFor="f-flagged">
                <input id="f-flagged" type="checkbox" checked={filters.flagged === true}
                  onChange={(e) => update({ flagged: e.target.checked })} />
                <span>{t('finance.filters.flagged')}</span>
              </label>
              <label className="check-pill" htmlFor="f-archived">
                <input id="f-archived" type="checkbox" checked={filters.archived === true}
                  onChange={(e) => update({ archived: e.target.checked })} />
                <span>{t('finance.filters.archived')}</span>
              </label>
              {filtersActive && (
                <button className="btn btn-sm" onClick={resetFilters}>
                  {t('finance.filters.reset')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ---- L'elenco -------------------------------------------------- */}
        <div id="fin-list" role="tabpanel" aria-labelledby={`fin-tab-${tab}`}>
          {list.loading && (
            <><SkeletonLine width="80%" /><SkeletonLine width="65%" /><SkeletonLine width="72%" /></>
          )}

          {/* ⚠️ TRE STATI DISTINTI, E NON È PEDANTERIA (difetto già pagato su
              Inbox 0013 e automazioni 0020): «non ci sono fatture» invita a
              caricarne una, «nessuna corrisponde ai filtri» invita a toglierli,
              «non ho potuto leggere l'elenco» invita a riprovare. Confonderli
              manda a cercare il problema dalla parte sbagliata. */}
          {!list.loading && list.error && (
            <ErrorState message={list.error} onRetry={list.reload} />
          )}

          {!list.loading && !list.error && list.items.length === 0 && (
            filtersActive ? (
              <div className="empty">
                <div>{t('finance.list.emptyFiltered')}</div>
                <button className="btn btn-sm mt-10" onClick={resetFilters}>
                  {t('finance.filters.reset')}
                </button>
              </div>
            ) : (
              <EmptyCta
                icon="receipt"
                title={t('finance.list.empty')}
                subtitle={t('finance.list.emptyHint')}
                action={
                  <div className="row-wrap" style={{ justifyContent: 'center' }}>
                    <button className="btn btn-primary" onClick={() => setAdding('supplier_invoice')}>
                      <Icon name="document" className="ic-sm" /> {t('finance.list.addFromDocument')}
                    </button>
                  </div>
                }
              />
            )
          )}

          {/* ⚠️ LA CODA CHE ACCETTA LAVORO E NON LO ESEGUE.
              Se un documento aspetta da troppo, il prodotto lo DICE: senza
              questo avviso la riga continuerebbe a mostrare «Lettura in corso»
              per sempre, e un'attesa indefinita travestita da lavoro in corso è
              il guasto che questo progetto evita ovunque. Lo stato è CALCOLATO
              in lettura, come il duplicato sospetto — nessuna tabella, nessun
              registro, niente da tenere aggiornato. */}
          {!list.loading && !list.error && queueLooksStalled(list.items) && (
            <div className="info-box mb-12">
              <strong>
                {t('finance.queueStalled', {
                  minutes: oldestPendingMinutes(list.items) ?? 0,
                })}
              </strong>
              <div className="muted-sm">{t('finance.queueStalledHint')}</div>
            </div>
          )}

          {!list.loading && !list.error && list.items.map((item) => (
            <FinanceRow key={item.id} item={item} tab={tab} t={t} L={L} localeTag={localeTag} />
          ))}

          {!list.loading && !list.error && list.items.length > 0 && (
            <div className="fin-pager">
              <span className="muted-sm">
                {t('finance.list.of', { shown: list.items.length, total: list.total })}
              </span>
              <div className="row-wrap">
                <button className="btn btn-sm" disabled={list.page === 0}
                  onClick={() => list.setPage(list.page - 1)}>
                  <Icon name="arrowLeft" className="ic-sm" /> {t('common.back')}
                </button>
                <span className="muted-sm fin-page-n">{t('finance.list.page', { n: list.page + 1 })}</span>
                <button className="btn btn-sm" disabled={list.page + 1 >= totalPages}
                  onClick={() => list.setPage(list.page + 1)}>
                  {t('common.next')} <Icon name="arrowRight" className="ic-sm" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Un numero del cruscotto con gli importi PER VALUTA
// ---------------------------------------------------------------------------

/**
 * ⚠️ LE VALUTE NON SI SOMMANO (§22/§113).
 * «CHF 12'400» e «EUR 3'100» sono due fatti; «15'500» non è un fatto — sarebbe
 * il risultato di un tasso di cambio, di una data e di una fonte che il
 * prodotto non ha. Perciò le righe stanno una sotto l'altra, e quando ce n'è
 * più di una la frase lo dice esplicitamente.
 *
 * ⚠️ Una riga senza valuta si CONTA e non si somma: il suo importo non è un
 * importo. Compare in fondo, dichiarata.
 */
function KpiTotals({
  label, hint, totals, localeTag, t, alert,
}: {
  label: string; hint: string; totals: FinanceTotal[]; localeTag: string;
  t: TFunction; alert?: boolean;
}) {
  const count = totals.reduce((sum, row) => sum + row.n, 0);
  const unknown = withoutCurrency(totals);
  const known = totals.filter((row) => row.currency);

  return (
    <div className={`kpi${alert && count > 0 ? ' alert' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${alert && count > 0 ? ' hot' : ''}`}>{count}</div>
      {known.length > 0 && (
        <ul className={styles.finAmounts}>
          {known.map((row) => (
            <li key={row.currency}>
              {/* `formatDecimal` e non `formatCurrency`: quest'ultima, quando la
                  valuta manca, la INVENTA mettendo CHF — su una fattura è un
                  dato inventato nel punto peggiore. */}
              {formatDecimal(row.total, row.currency, localeTag) ?? '—'}
            </li>
          ))}
        </ul>
      )}
      {unknown && (
        <div className="muted-sm">{unknown.n} {'·'} {t('finance.kpi.noCurrency')}</div>
      )}
      {known.length > 1 && <div className="muted-sm">{t('finance.kpi.multiCurrencyHint')}</div>}
      <div className="kpi-sub">{hint}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Una riga dell'elenco
// ---------------------------------------------------------------------------

/**
 * Lo stato in UNA parola. CHE COSA dire lo decide `stateBadgeKey` nel modello,
 * in un posto solo e provato offline; qui si sceglie soltanto la veste.
 * ⚠️ Il colore non basta mai: la pastiglia porta sempre il testo (§129).
 */
function stateBadge(key: FinanceBadgeKey, archived: boolean, t: TFunction, L: ReturnType<typeof useLabels>) {
  switch (key) {
    case 'failed': return { text: t('finance.row.failed'), cls: 'badge badge-alta' };
    case 'processing': return { text: t('finance.row.processing'), cls: 'badge badge-neutral' };
    // Una riga archiviata compare solo nella vista archiviata, dove «archiviata»
    // è già detto dal filtro: qui parla la verifica — con il suo valore VERO
    // (la chiave), in una pastiglia spenta perché in archivio non c'è niente
    // da fare.
    case 'ready': return { text: L.financeReview('ready'), cls: archived ? 'badge badge-neutral' : 'badge badge-bassa' };
    default: return { text: L.financeReview('needs_review'), cls: 'badge badge-media' };
  }
}

function FinanceRow({
  item, tab, t, L, localeTag,
}: {
  item: FinanceItem; tab: FinanceTab; t: TFunction;
  L: ReturnType<typeof useLabels>; localeTag: string;
}) {
  const docLabel = useDocumentLabel();
  const state = financeState(item);
  const badgeKey = stateBadgeKey(item);
  const badge = stateBadge(badgeKey, state === 'archived', t, L);
  // Su una ricevuta il fornitore spesso non c'è e l'esercente sì: si mostra
  // quello che il documento dice davvero, senza inventare l'altro. Quando non
  // c'è né l'uno né l'altro resta il titolo del documento, che è un fatto.
  const who = item.supplierName || item.merchant || docLabel(item.documentLabel);
  const date = tab === 'expenses'
    ? item.expenseDate ?? item.invoiceDate
    : item.invoiceDate;
  const amount = formatDecimal(item.grossAmount, item.currency, localeTag);

  const meta = [
    item.invoiceNumber ? t('finance.row.invoiceNumber', { value: item.invoiceNumber }) : null,
    date ? (tab === 'expenses' ? t('finance.row.expenseOn', { date: formatDate(date) }) : formatDate(date)) : null,
    item.expenseCategory ? L.expenseCategory(item.expenseCategory) : null,
    t(SOURCE_KEY[item.documentSource]),
  ].filter(Boolean);

  return (
    <div className={styles.finRow}>
      <Link className={styles.finRowMain} to={`/finanze/${item.id}`}>
        <div className={styles.finRowTitle}>{who}</div>
        <div className={styles.finRowSub}>{meta.join(' · ')}</div>
      </Link>

      <div className={styles.finRowAmount}>
        {/* ⚠️ L'importo mancante si DICHIARA. Uno zero al suo posto sarebbe un
            numero inventato, e su una fattura è il tipo di invenzione che
            nessuno verifica. */}
        {amount ?? <span className="muted-sm">{t('finance.row.noAmount')}</span>}
        {/* Il termine della fattura nella grammatica della famiglia: cifre e
            distanza. Una fattura oltre la data è SCADUTA, e le cifre rosse lo
            dicono — il testo muto di prima non lo diceva a nessuno. */}
        {tab === 'invoices' && item.dueDate && (
          <div><DeadlineMark date={item.dueDate} display={formatDate(item.dueDate)} /></div>
        )}
      </div>

      <div className={styles.finRowSide}>
        {item.duplicateSuspected && (
          <Tag tone="attention">
            <Icon name="alert" className="ic-sm" /> {t('finance.duplicate.banner')}
          </Tag>
        )}
        {/* ⚠️ `finance.row.flagged` e NON `finance.filters.flagged`: quella è
            l'etichetta della casella «Solo con segnalazioni» in cima, e su una
            riga diceva «solo» di un elenco che le mostra tutte. Una riga non si
            nomina con il filtro che la selezionerebbe. */}
        {item.qualityFlags.length > 0 && state !== 'failed' && (
          <Tag tone="attention">{t('finance.row.flagged')}</Tag>
        )}
        {/* «Da verificare» è il segno epistemico di famiglia — anche in
            archivio: un'archiviata mai verificata non si veste da «Verificata».
            Guasti e stati di lavorazione restano pastiglie (il rosso resta al
            guasto). */}
        {badgeKey === 'needs_review'
          ? <ProvenanceMark kind="toVerify" />
          : <span className={badge.cls}>{badge.text}</span>}
        {/* La CAUSA sotto la pastiglia: su `failed` spiega il fallimento, su
            una riga in coda l'ultimo rilascio (es. credito esaurito). Sugli
            stati con verifica umana il codice residuo non si mostra: lì parla
            la revisione, non il worker. */}
        {item.errorCode && (state === 'failed' || state === 'processing') && (
          <div className="muted-sm">{causaDelGuasto(item.errorCode, t)}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// «Aggiungi da un documento» (§15)
//
// Il gesto umano ed esplicito per un documento che il riconoscimento
// deterministico non ha classificato come finanziario. Non carica file e non
// crea documenti: sceglie fra quelli che l'azienda ha già, perché il file
// appartiene al Document Hub e non alle Finanze.
// ---------------------------------------------------------------------------
const TYPE_CHOICES: FinanceItemType[] = ['supplier_invoice', 'receipt', 'credit_note'];

function AddFromDocument({
  companyId, initialType, onClose, onAdded,
}: {
  companyId: string; initialType: FinanceItemType;
  onClose: () => void; onAdded: (message: string) => void;
}) {
  const t = useT();
  const L = useLabels();
  const docLabel = useDocumentLabel();
  const [type, setType] = useState<FinanceItemType>(initialType);
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<DocumentHubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      documentHubService.list(companyId, { query: query || null, sort: 'recent', limit: 10 })
        .then((page) => { if (active) setDocs(page.items); })
        .catch((e) => { if (active) { setError(toUserMessage(e)); setDocs([]); } })
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [companyId, query]);

  async function add(documentId: string) {
    setBusy(true);
    try {
      await financeService.addFromDocument(companyId, documentId, type);
      onAdded(t('finance.add.added'));
    } catch (e) {
      // Il caso «c'era già» ha un messaggio suo, e arriva dal servizio: qui non
      // si indovina nulla, si mostra ciò che il database ha risposto.
      onAdded(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-12">
      <div className="card-title">
        {t('finance.add.title')}
        <button className={cx('btn btn-sm btn-ghost', styles.finClose)} onClick={onClose}>
          <Icon name="close" className="ic-sm" /> {t('common.close')}
        </button>
      </div>

      <div className="field">
        <label htmlFor="fin-add-type">{t('finance.add.chooseType')}</label>
        <select id="fin-add-type" value={type} disabled={busy}
          onChange={(e) => setType(e.target.value as FinanceItemType)}>
          {TYPE_CHOICES.map((v) => <option key={v} value={v}>{L.financeType(v)}</option>)}
        </select>
      </div>

      {/* ⚠️ L'ETICHETTA STA DOVE SI SCEGLIE DAVVERO.
          Prima «Scegli il documento» stava sopra la casella di ricerca, e la
          scelta avveniva in un elenco più in basso: su uno schermo stretto
          quell'elenco è fuori dalla vista, e chi legge fa esattamente quello
          che l'etichetta dice — prova a scrivere il documento in una casella
          che non serve a quello. Un campo che promette una cosa e ne fa
          un'altra è un difetto anche quando il codice sotto funziona. */}
      <div className="field">
        <label htmlFor="fin-add-doc">{t('finance.add.filter')}</label>
        <input id="fin-add-doc" type="search" value={query} disabled={busy}
          placeholder={t('finance.add.filterPlaceholder')}
          onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="group-label">
        {t('finance.add.chooseDocument')}
        {!loading && !error && docs.length > 0 && (
          <span className={styles.finAddCount}>
            {t(docs.length === 1 ? 'finance.add.countOne' : 'finance.add.countMany', { n: docs.length })}
          </span>
        )}
      </div>

      {loading && <SkeletonLine width="70%" />}
      {!loading && error && <ErrorState message={error} />}
      {/* ⚠️ Due vuoti DIVERSI. «Non hai documenti» e «la ricerca non trova
          niente» chiedono due cose diverse a chi legge: la prima di caricarne
          uno, la seconda di cambiare parola. Renderli con la stessa frase è la
          confusione che questo progetto evita ovunque. */}
      {!loading && !error && docs.length === 0 && (
        <div className="empty">
          {query ? t('finance.add.noMatch') : t('finance.add.noDocuments')}
        </div>
      )}
      {!loading && !error && docs.map((doc) => (
        <div className="list-row" key={doc.id}>
          <div className="list-main">
            <div className="list-title">{docLabel(doc.label)}</div>
            <div className="list-sub">{formatDate(doc.documentDate ?? doc.createdAt)}</div>
          </div>
          <button className="btn btn-sm" disabled={busy} onClick={() => void add(doc.id)}>
            {t('finance.add.confirm')}
          </button>
        </div>
      ))}
    </div>
  );
}
