// ============================================================================
// Documenti — la memoria documentale dell'azienda.
//
// Risponde a una domanda diversa da quella dell'Inbox e da quella delle
// Attività: non «cosa è appena arrivato» né «cosa dobbiamo fare», ma «cosa
// sappiamo e dove lo ritroviamo». Per questo la barra di ricerca è l'elemento
// dominante e la riga dice ciò che serve a riconoscere un documento — categoria,
// controparte, provenienza, data, scadenza — invece del nome del file.
//
// Tutto il lavoro sta nel database (`list_documents`): filtri, ricerca nel
// testo, ordinamento, conteggi e composizione delle relazioni. Qui si scelgono
// i filtri e si mostra il risultato. Con duemila documenti la pagina chiede
// sempre e solo venticinque righe.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tag } from '@/components/ui/Tag';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { ErrorState, EmptyCta, SkeletonLine } from '@/components/ui/states';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import { AppointmentMark } from '@/components/ui/AppointmentMark';
import { ProvenanceMark } from '@/components/ui/ProvenanceMark';
import { MarkLegend } from '@/components/ui/MarkLegend';
import { Input, Select } from '@/components/ui/forms';
import { documentHubService } from '@/services/documentHubService';
import { DocumentStatsPanel } from './DocumentStatsPanel';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { useT, type TFunction, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { useDocumentLabel } from '@/i18n/documentLabel';
import {
  CATEGORIES, DOCUMENTS_PAGE_SIZE, SORTS, SOURCES, STATES,
  filtersFromParams, hasActiveFilters, paramsFromFilters, passoSegnali, rowMarks, splitSnippet,
} from './documentModel';
import { cognomiDaRubrica } from './analysisTrust';
import { useMembers } from '@/features/tasks/useMembers';
import type {
  DocumentCategory, DocumentHubFilters, DocumentHubItem, DocumentSort, DocumentSourceType,
  DocumentState, DocumentTag,
} from '@/types/models';

/**
 * Una pagina alla volta, accumulando.
 *
 * Non è `useAsync` perché qui il risultato si SOMMA a quello precedente:
 * ricaricare tutto a ogni «Mostra altri» sarebbe traffico speso per righe già
 * sullo schermo. Il conteggio totale invece arriva dal database a ogni
 * richiesta — è il numero di documenti che soddisfano il filtro, non quanti
 * ne abbiamo caricati.
 */
function useDocumentList(companyId: string, filters: DocumentHubFilters) {
  // Il filtro per appartenenza dipende da CHI è l'azienda: la regola
  // (`analysisTrust`) confronta destinatario, ragione sociale e cognomi della
  // rubrica. Per questo nome e cognomi entrano nella chiave: quando arrivano,
  // l'interrogazione si rifà da sola.
  const { activeCompany } = useCompany();
  const { members } = useMembers();
  const legalName = activeCompany?.legalName ?? '';
  const surnames = useMemo(() => cognomiDaRubrica(members.map((m) => m.name)), [members]);

  // Le dipendenze sono i VALORI dei filtri, non l'oggetto: un oggetto nuovo a
  // ogni render rifarebbe la richiesta a ogni battuta di tasto.
  const key = JSON.stringify({
    companyId, ...filters, limit: undefined, offset: undefined,
    ...(filters.ownership ? { legalName, surnames } : {}),
  });

  // ⚠️ I risultati portano con sé la CHIAVE a cui appartengono, e non si
  // svuotano in un effetto. Svuotarli in un effetto lascerebbe un fotogramma in
  // cui la schermata mostra i documenti dell'azienda precedente sotto il nome
  // di quella nuova — il «lampo di dati di prima» che, su un prodotto
  // multi-azienda, è un difetto e non un dettaglio estetico.
  const [state, setState] = useState<{ key: string; items: DocumentHubItem[]; total: number; parziale: boolean }>(
    { key, items: [], total: 0, parziale: false },
  );
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fresh = state.key === key;

  useEffect(() => {
    // Cambiando filtro o azienda si riparte dalla prima pagina: mostrare la
    // pagina tre di un elenco diverso confonderebbe e basta.
    setOffset(0);
  }, [key]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    // ⚠️ Senza la ragione sociale la regola d'appartenenza non si può valutare:
    // si resta in caricamento invece di mostrare uno zero falso. Il nome arriva
    // col contesto azienda ed entra nella chiave, quindi l'attesa si risolve da
    // sola alla prima lettura completa.
    if (filters.ownership && !legalName) return () => { active = false; };
    const carica = filters.ownership
      ? documentHubService
        .listOwnership(companyId, { legalName, memberSurnames: surnames })
        .then((r) => ({ items: r.items, total: r.total, parziale: r.parziale }))
      : documentHubService
        .list(companyId, { ...filters, limit: DOCUMENTS_PAGE_SIZE, offset })
        .then((page) => ({ items: page.items, total: page.total, parziale: false }));
    carica
      .then((page) => {
        if (!active) return;
        // `offset === 0` è sempre una lista nuova; e l'accodamento avviene solo
        // se la pagina precedente apparteneva alla STESSA interrogazione.
        setState((prev) => ({
          key,
          total: page.total,
          parziale: page.parziale,
          items: offset === 0 || prev.key !== key ? page.items : [...prev.items, ...page.items],
        }));
      })
      .catch((e) => { if (active) { setError(toUserMessage(e)); setState({ key, items: [], total: 0, parziale: false }); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offset, tick]);

  const items = fresh ? state.items : [];
  const total = fresh ? state.total : 0;
  return {
    items, total, loading: loading || !fresh, error,
    parziale: fresh && state.parziale,
    // Il modo appartenenza consegna l'elenco INTERO (fino al tetto dichiarato):
    // una «pagina due» non esiste, e fingere che esista rifarebbe la stessa
    // lettura per niente.
    hasMore: !filters.ownership && items.length < total,
    loadMore: () => setOffset((n) => n + DOCUMENTS_PAGE_SIZE),
    reload: () => { setOffset(0); setTick((n) => n + 1); },
  };
}

/**
 * I segnali di appartenenza per le righe in elenco — la SECONDA interrogazione.
 *
 * ⚠️ MAI IL VALORE GREZZO, NEMMENO PER UN ISTANTE: finché la risposta non è
 * arrivata la mappa è `null` e la riga non mostra niente. Un livello
 * provvisorio che vive mezzo secondo è peggio di uno sbagliato per sempre —
 * sembra autorevole, l'occhio lo registra, e poi cambia sotto lo sguardo.
 *
 * ⚠️ E NESSUN RIPIEGO RUMOROSO: se la richiesta fallisce, l'elenco funziona e
 * dell'appartenenza semplicemente non si dice nulla. Non è un errore da
 * mostrare: è un'informazione che in quel momento non c'è. (È un'ECCEZIONE
 * dichiarata alla regola «nessun fallback silenzioso»: qui il silenzio non
 * inventa un valore — l'assenza dell'indicatore non è un segno.)
 */
function useTrustSignals(companyId: string, items: DocumentHubItem[]) {
  const { activeCompany } = useCompany();
  const { members } = useMembers();
  const [signals, setSignals] = useState<Map<string, { ownershipToConfirm: boolean; points: number }> | null>(null);
  const legalName = activeCompany?.legalName ?? '';
  const surnames = useMemo(() => cognomiDaRubrica(members.map((m) => m.name)), [members]);
  const ids = useMemo(() => items.filter((i) => i.analysisId).map((i) => i.id), [items]);
  const idsKey = ids.join(',');
  // LA REGOLA con cui un verdetto è stato calcolato, per CONTENUTO: azienda,
  // ragione sociale, cognomi della rubrica. Se cambia, quello che è in mappa
  // vale per qualcun altro. Il carattere nullo separa i pezzi perché nessun
  // nome lo contiene: due campi concatenati senza separatore sono un campo solo.
  const regola = [companyId, legalName, ...surnames].join('\u0000');
  // Che cosa è già stato CHIESTO E OTTENUTO, e sotto quale regola. Sta in un
  // ref e non nello stato: serve a decidere la richiesta, non a disegnare.
  const chiesti = useRef<{ regola: string | null; ids: Set<string> }>({ regola: null, ids: new Set() });

  useEffect(() => {
    let active = true;
    const passo = passoSegnali(chiesti.current.regola, regola, ids, chiesti.current.ids);
    // ⚠️ L'AZZERAMENTO RESTA, ma solo dove serviva davvero: cambiata la regola,
    // un verdetto vecchio è peggio di nessun verdetto. Quando invece l'elenco
    // si è soltanto allungato, le righe già a schermo tengono la loro pastiglia.
    if (passo.azzera) { setSignals(null); chiesti.current = { regola, ids: new Set() }; }
    else chiesti.current = { regola, ids: chiesti.current.ids };

    if (!passo.daInterrogare.length) {
      // Nessun id da chiedere: con la regola nuova la mappa è vuota (e non
      // `null`, che significa «non lo so»); altrimenti non si tocca niente —
      // un `setSignals` inutile è una mappa nuova e un altro giro di render.
      if (passo.azzera) setSignals(new Map());
      return;
    }
    if (!legalName) { setSignals(new Map()); return; }

    documentHubService.trustSignals(companyId, passo.daInterrogare, { legalName, memberSurnames: surnames })
      .then((m) => {
        if (!active) return;
        // Gli id si segnano come chiesti SOLO qui: se la richiesta viene
        // abbandonata a metà, l'esecuzione successiva deve poterli richiedere.
        for (const id of passo.daInterrogare) chiesti.current.ids.add(id);
        setSignals((prec) => (prec ? new Map([...prec, ...m]) : m));
      })
      // Un guasto sull'ALLUNGAMENTO non porta via le righe già giudicate: si
      // resta senza indicatore sulle nuove, che è l'assenza già dichiarata qui
      // sopra, non un segno.
      .catch(() => { if (active && passo.azzera) setSignals(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regola, idsKey]);

  return signals;
}

const SORT_KEY: Record<DocumentSort, TKey> = {
  recent: 'documents.sorts.recent',
  oldest: 'documents.sorts.oldest',
  document_date: 'documents.sorts.document_date',
  title: 'documents.sorts.title',
  deadline: 'documents.sorts.deadline',
};
const STATE_KEY: Record<DocumentState, TKey> = {
  analyzed: 'documents.states.analyzed',
  to_verify: 'documents.states.to_verify',
  failed: 'documents.states.failed',
  processing: 'documents.states.processing',
  none: 'documents.states.none',
};
const SOURCE_KEY: Record<DocumentSourceType, TKey> = {
  upload: 'documents.sources.upload',
  email: 'documents.sources.email',
  pasted_text: 'documents.sources.pasted_text',
};

/** La pastiglia piena di stato: rossa solo per il guasto (vedi `rowMarks`). */
function stateBadgeClass(state: 'failed' | 'processing' | 'none'): string {
  return state === 'failed' ? 'badge badge-alta' : 'badge badge-neutral';
}

export function DocumentsPage() {
  const t = useT();
  const L = useLabels();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;

  // I filtri stanno nell'indirizzo: ricaricare non azzera una ricerca, il tasto
  // indietro funziona e un collegamento a «imposte, da verificare» si può
  // mandare a un collega.
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);

  // Il campo di ricerca è locale e si applica quando si smette di scrivere:
  // scrivere nell'indirizzo a ogni tasto riempirebbe la cronologia del browser.
  const [search, setSearch] = useState(filters.query ?? '');
  useEffect(() => { setSearch(filters.query ?? ''); }, [filters.query]);
  useEffect(() => {
    const current = filters.query ?? '';
    if (search.trim() === current.trim()) return;
    const timer = setTimeout(() => {
      setParams(paramsFromFilters({ ...filters, query: search }), { replace: true });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const list = useDocumentList(companyId, filters);

  // La seconda interrogazione: i segnali di appartenenza per le righe visibili.

  const trustSignals = useTrustSignals(companyId, list.items);
  const [counts, setCounts] = useState<Map<DocumentCategory | 'none', number>>(new Map());
  const [tags, setTags] = useState<DocumentTag[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Cambiando azienda si azzera TUTTO ciò che riguarda quella precedente:
  // conteggi, etichette e selezione non devono sopravvivere allo scambio.
  useEffect(() => {
    setSelected(new Set());
    setCounts(new Map());
    setTags([]);
    let active = true;
    void Promise.all([
      documentHubService.counts(companyId, filters.archived === true),
      documentHubService.listTags(companyId),
    ]).then(([c, tg]) => { if (active) { setCounts(c); setTags(tg); } })
      .catch(() => { /* i conteggi sono un di più: la lista vale comunque */ });
    return () => { active = false; };
  }, [companyId, filters.archived, list.total]);

  function update(change: Partial<DocumentHubFilters>) {
    // ⚠️ Il filtro per appartenenza è un MODO, non un filtro componibile: copre
    // ENTRAMBE le popolazioni (la conferma è lavoro anche per un archiviato),
    // quindi «Attivi/Archiviati» non ha senso dentro di lui, e comporlo con gli
    // altri filtri produrrebbe interrogazioni che nessuna pagina sa spiegare.
    // Toccare qualunque altro filtro ne esce, dichiaratamente.
    const next = 'ownership' in change ? change : { ...change, ownership: false };
    setParams(paramsFromFilters({ ...filters, ...next }));
    setSelected(new Set());
  }

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function runBulk(action: () => Promise<number>) {
    setBusy(true);
    try {
      const n = await action();
      setSelected(new Set());
      list.reload();
      showToast(t('documents.bulkDone', { n }));
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const ids = [...selected];
  const totalActive = [...counts.values()].reduce((a, b) => a + b, 0);
  const filtersActive = hasActiveFilters(filters);

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('documents.title')}</div>
        <div className="page-desc">{t('documents.subtitle')}</div>
      </div>

      <div className="row-wrap">
        {/* Il caricamento riusa la pipeline di Admin AI: una seconda non
            esisterebbe senza rifare estrazione, deduplicazione e analisi. */}
        <Link className="btn btn-primary btn-block-mobile" to="/admin">
          <Icon name="document" className="ic-sm" /> {t('documents.upload')}
        </Link>
        <div className="field doc-search">
          <input
            id="doc-search" type="search" value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('documents.searchLabel')}
            placeholder={t('documents.searchPlaceholder')}
          />
        </div>
      </div>

      <div className="doc-layout mt-16">
        <nav className="doc-side" aria-label={t('documents.allCategories')}>
          <button
            className={`doc-cat${!filters.category && !filters.uncategorized ? ' is-active' : ''}`}
            aria-pressed={!filters.category && !filters.uncategorized}
            onClick={() => update({ category: null, uncategorized: false })}
          >
            <span>{t('documents.allCategories')}</span><span className="doc-cat-n">{totalActive}</span>
          </button>
          {/* ⚠️ Le categorie vuote non si mostrano, MA quella attiva sì anche a
              zero: arrivando da un collegamento con `?categoria=taxes` su una
              categoria che oggi è vuota, il filtro sarebbe attivo e invisibile —
              la lista direbbe «nessun risultato» senza che si veda perché.
              È la stessa regola imparata deduplicando la Home: quando si
              nasconde qualcosa, bisogna verificare che ciò che resta lo
              sostituisca davvero. */}
          {counts.get('none') || filters.uncategorized ? (
            <button
              className={`doc-cat${filters.uncategorized ? ' is-active' : ''}`}
              aria-pressed={filters.uncategorized === true}
              onClick={() => update({ category: null, uncategorized: true })}
            >
              <span>{t('documents.uncategorized')}</span>
              <span className="doc-cat-n">{counts.get('none')}</span>
            </button>
          ) : null}
          {CATEGORIES.filter((c) => counts.get(c) || filters.category === c).map((c) => (
            <button
              key={c}
              className={`doc-cat${filters.category === c ? ' is-active' : ''}`}
              aria-pressed={filters.category === c}
              onClick={() => update({ category: c, uncategorized: false })}
            >
              {/* `?? 0` e non `counts.get(c)`: la categoria attiva compare
                  anche quando è vuota, e senza il numero la riga sembrerebbe
                  un conteggio non caricato invece di uno zero. */}
              <span>{L.category(c)}</span><span className="doc-cat-n">{counts.get(c) ?? 0}</span>
            </button>
          ))}
        </nav>

        <div className="doc-main">
          <div className="card">
            <div className="card-title">
              {/* ⚠️ NON `btn-primary`. «Attivi/Archiviati» in blu d'azione
                  competeva con «Carica documento», che è l'unica azione
                  primaria di questa pagina: due pulsanti blu chiedevano la
                  stessa attenzione per due cose che non si somigliano — uno
                  CARICA, l'altro cambia soltanto quello che si sta guardando.
                  Qui lo stato premuto è una superficie (`btn-toggle`), e i due
                  estremi si toccano perché sono UN interruttore. */}
              <span className="segmented">
                <button className="btn btn-sm btn-toggle"
                  aria-pressed={!filters.archived} onClick={() => update({ archived: false })}>
                  {t('documents.viewActive')}
                </button>
                <button className="btn btn-sm btn-toggle"
                  aria-pressed={filters.archived === true} onClick={() => update({ archived: true })}>
                  {t('documents.viewArchived')}
                </button>
              </span>
              <span className="filter-group">
                <div className="field m-0">
                  <select className="select-inline" value={filters.sort ?? 'recent'}
                    aria-label={t('documents.sortLabel')}
                    onChange={(e) => update({ sort: e.target.value as DocumentSort })}>
                    {SORTS.map((s) => <option key={s} value={s}>{t(SORT_KEY[s])}</option>)}
                  </select>
                </div>
                <button className="btn btn-sm btn-toggle"
                  aria-expanded={showFilters} aria-pressed={showFilters}
                  onClick={() => setShowFilters((v) => !v)}>
                  {showFilters ? t('documents.filtersHide') : t('documents.filtersShow')}
                </button>
              </span>
            </div>

            {/* IL MODO «APPARTENENZA DA CONFERMARE» (`?appartenenza=1`), la
                destinazione del blocco decisioni della Panoramica. Copre
                ENTRAMBE le popolazioni — la conferma è lavoro anche per un
                documento archiviato — e la fascia lo dichiara, insieme al
                numero: lo STESSO che il blocco ha promesso. Se il tetto di
                lettura ha morso, anche quello si dichiara. */}
            {filters.ownership && (
              <div className="info-box mt-10" role="status">
                <Icon name="alert" className="ic-sm" />
                <span>
                  {list.total === 1
                    ? t('documents.ownershipFilterOne')
                    : t('documents.ownershipFilterMany', { n: list.total })}
                  {list.parziale ? ` — ${t('documents.ownershipFilterPartial')}` : ''}
                </span>
                <button className="btn btn-sm" onClick={() => update({ ownership: false })}>
                  {t('documents.ownershipFilterClear')}
                </button>
              </div>
            )}

            {showFilters && (
              <div className="doc-filters">
                <Select id="f-source" label={t('documents.sourceLabel')} value={filters.source ?? ''}
                  onChange={(e) => update({ source: (e.target.value || null) as DocumentSourceType | null })}>
                  <option value="">{t('documents.filterAny')}</option>
                  {SOURCES.map((s) => <option key={s} value={s}>{t(SOURCE_KEY[s])}</option>)}
                </Select>
                <Select id="f-state" label={t('documents.stateLabel')} value={filters.state ?? ''}
                  onChange={(e) => update({ state: (e.target.value || null) as DocumentState | null })}>
                  <option value="">{t('documents.filterAny')}</option>
                  {STATES.map((s) => <option key={s} value={s}>{t(STATE_KEY[s])}</option>)}
                </Select>
                <Select id="f-tag" label={t('documents.tagLabel')} value={(filters.tagIds ?? [])[0] ?? ''}
                  onChange={(e) => update({ tagIds: e.target.value ? [e.target.value] : null })}>
                  <option value="">{t('documents.filterAny')}</option>
                  {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </Select>
                <Input id="f-from" label={t('documents.dateFrom')} type="date" value={filters.dateFrom ?? ''}
                  onChange={(e) => update({ dateFrom: e.target.value || null })} />
                <Input id="f-to" label={t('documents.dateTo')} type="date" value={filters.dateTo ?? ''}
                  onChange={(e) => update({ dateTo: e.target.value || null })} />
                <div className="field doc-filter-wide">
                  <label className="task-check" htmlFor="f-deadline">
                    <input id="f-deadline" type="checkbox" checked={filters.hasDeadline === true}
                      onChange={(e) => update({ hasDeadline: e.target.checked })} />
                    <span>{t('documents.hasDeadline')}</span>
                  </label>
                  <div className="muted-sm">{t('documents.dateHint')}</div>
                </div>
                {filtersActive && (
                  <div className="doc-filter-wide">
                    <button className="btn btn-sm" onClick={() => setParams(new URLSearchParams())}>
                      {t('documents.clearFilters')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {ids.length > 0 && (
              <div className="doc-bulk" role="group" aria-label={t('documents.bulkCategory')}>
                <span className="muted-sm">
                  {ids.length === 1 ? t('documents.selectedOne') : t('documents.selectedMany', { n: ids.length })}
                </span>
                <div className="field m-0">
                  <select className="select-inline" value="" disabled={busy}
                    aria-label={t('documents.bulkCategory')}
                    onChange={(e) => {
                      const value = e.target.value as DocumentCategory;
                      if (value) void runBulk(() => documentHubService.bulkSetCategory(companyId, ids, value));
                    }}>
                    <option value="">{t('documents.bulkCategory')}</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{L.category(c)}</option>)}
                  </select>
                </div>
                {tags.length > 0 && (
                  <div className="field m-0">
                    <select className="select-inline" value="" disabled={busy}
                      aria-label={t('documents.bulkTag')}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value) void runBulk(() => documentHubService.bulkAddTag(companyId, ids, value));
                      }}>
                      <option value="">{t('documents.bulkTag')}</option>
                      {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                    </select>
                  </div>
                )}
                <button className="btn btn-sm" disabled={busy}
                  onClick={() => void runBulk(() => documentHubService.bulkArchive(companyId, ids, !filters.archived))}>
                  {filters.archived ? t('documents.bulkRestore') : t('documents.bulkArchive')}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
                  {t('documents.clearSelection')}
                </button>
              </div>
            )}

            {list.loading && list.items.length === 0 && (
              <><SkeletonLine width="70%" /><SkeletonLine width="85%" /><SkeletonLine width="60%" /></>
            )}
            {list.error && <ErrorState message={list.error} onRetry={list.reload} />}

            {!list.loading && !list.error && list.items.length === 0 && (
              filtersActive ? (
                // «Nessun risultato» non è «nessun documento»: la differenza è
                // fra togliere un filtro e caricare il primo documento.
                <div className="empty">
                  <div>{filters.archived ? t('documents.emptyArchived') : t('documents.noResults')}</div>
                  <div className="muted-sm mt-10">{t('documents.noResultsSub')}</div>
                  <button className="btn btn-sm mt-10" onClick={() => setParams(new URLSearchParams())}>
                    {t('documents.clearFilters')}
                  </button>
                </div>
              ) : (
                <EmptyCta
                  art="document"
                  title={t('documents.empty')}
                  subtitle={t('documents.emptySub')}
                  action={
                    <div className="row-wrap">
                      <button className="btn btn-primary" onClick={() => navigate('/admin')}>
                        <Icon name="document" className="ic-sm" /> {t('documents.upload')}
                      </button>
                      <button className="btn" onClick={() => navigate('/inbox/account')}>
                        <Icon name="mail" className="ic-sm" /> {t('documents.emptyConnect')}
                      </button>
                    </div>
                  }
                />
              )
            )}

            {list.items.map((item) => (
              <DocumentRow
                key={item.id} item={item} t={t} category={L.category(item.category)}
                docType={item.documentType ? L.docType(item.documentType) : null}
                selected={selected.has(item.id)}
                onSelect={() => toggleSelection(item.id)}
                ownershipToConfirm={trustSignals?.get(item.id)?.ownershipToConfirm === true}
              />
            ))}

            {list.items.length > 0 && (
              <div className="row-wrap mt-3" style={{ justifyContent: 'space-between' }}>
                <span className="muted-sm">
                  {t('documents.countShown', { shown: list.items.length, total: list.total })}
                </span>
                {list.hasMore && (
                  <button className="btn btn-sm" onClick={list.loadMore} disabled={list.loading}
                    aria-busy={list.loading || undefined}>
                    {list.loading ? <span className="spinner" aria-hidden="true" /> : null} {t('documents.loadMore')}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="muted-sm mt-10">{t('documents.searchScope')}</div>
          {/* La legenda dei segni: le righe portano il termine e il «da
              verificare», e chi li incontra qui li ritroverà identici nel
              dettaglio, in Attività e negli Incentivi. */}
          <MarkLegend />
          {/* ⚠️ SOTTO LA LISTA E CHIUSA: la pagina risponde a «dove ritrovo
              questo documento», e i conteggi sono una seconda domanda. Segue
              l'interruttore Attivi/Archiviati qui sopra — l'insieme lo sceglie
              chi guarda, ed è la ragione per cui questi grafici non stanno più
              in Panoramica (§37). */}
          <DocumentStatsPanel
            companyId={companyId}
            archived={filters.archived === true}
            reloadKey={list.total}
          />
        </div>
      </div>
    </>
  );
}

/**
 * Una riga dice quello che serve a RICONOSCERE un documento, non tutto quello
 * che se ne sa: controparte, tipo, categoria, provenienza, data. Il nome del
 * file originale sta nel dettaglio — «documento_29387.pdf» non ha mai aiutato
 * nessuno a ritrovare niente.
 *
 * ⚠️ NON È PIÙ UNA CATENA «A · B · C · D · E», e la differenza non è estetica.
 * Cinque valori separati da punti mediani hanno tutti lo stesso peso: per
 * trovare il mittente — che è quasi sempre il modo in cui una persona cerca un
 * documento — bisognava leggere la riga intera, e in una colonna stretta quella
 * riga andava a capo cinque volte. Ora la riga ha una STRUTTURA: il mittente in
 * evidenza, il tipo come marcatura, la data allineata a destra con cifre
 * tabulari (le date si incolonnano solo così: Inter usa cifre proporzionali per
 * default). Restano nella catena i due valori davvero secondari, categoria e
 * provenienza.
 */
function DocumentRow({
  item, t, category, docType, selected, onSelect, ownershipToConfirm,
}: {
  item: DocumentHubItem; t: TFunction; category: string; docType: string | null;
  selected: boolean; onSelect: () => void;
  /** L'unico segnale di attendibilità che l'elenco mostra: quello azionabile.
   *  Il LIVELLO qui non compare per scelta — una colonna di «bassa» lunga
   *  quanto lo schermo smette di essere letta; vive nel dettaglio, col suo
   *  perché. `false` anche quando l'informazione non è ancora arrivata. */
  ownershipToConfirm: boolean;
}) {
  // ⚠️ IL NOME, non `item.title`: quando il titolo non è mostrabile qui
  // comparirebbe «2.5». La decisione l'ha già presa il servizio.
  const docLabel = useDocumentLabel();
  const nome = docLabel(item.label);

  // ⚠️ Categoria e tipo di documento a volte hanno la STESSA etichetta — un
  // documento di tipo «Assicurazioni sociali» nella categoria «Assicurazioni
  // sociali» — e la riga la stampava due volte di fila. Visto leggendo la
  // schermata con documenti veri: nessun test poteva accorgersene, perché
  // entrambi i valori erano quelli giusti.
  const categoryLabel = item.category ? category : null;
  // ⚠️ E DALLO STESSO GIORNO ANCHE IL NOME PUÒ COINCIDERE COL TIPO: quando
  // l'etichetta è composta dal solo tipo di documento, «Altro documento
  // amministrativo» finiva scritto una volta come nome e una come marcatura,
  // uno sotto l'altro. Stessa regola di prima, un caso in più.
  const typeMark = docType && docType !== categoryLabel && docType !== nome ? docType : null;
  const rest = [categoryLabel, t(SOURCE_KEY[item.sourceType])].filter(Boolean);
  // ⚠️ I marcatori si chiedono UNA volta per la riga, non uno per pastiglia:
  // la regola parla della riga (su un guasto la scadenza non si mostra), e due
  // marcatori che scelgono per conto proprio non possono rispettarla.
  const marks = rowMarks(item);

  const snippet = splitSnippet(item.snippet);

  return (
    <div className={`doc-row${selected ? ' is-selected' : ''}`}>
      <label className="doc-check">
        <input type="checkbox" checked={selected} onChange={onSelect}
          aria-label={t('documents.selectAria', { title: nome })} />
      </label>
      <Link className="doc-row-main" to={`/documenti/${item.id}`} aria-label={t('documents.openAria', { title: nome })}>
        <div className="doc-row-title">{nome}</div>
        <div className="doc-row-meta">
          {item.sender && <span className="doc-sender">{item.sender}</span>}
          {typeMark && <span className="doc-type">{typeMark}</span>}
          {rest.length > 0 && <span className="doc-row-sub">{rest.join(' · ')}</span>}
        </div>
        {snippet.length > 0 && (
          // L'estratto arriva dal database come TESTO: i punti trovati
          // diventano elementi, non HTML da interpretare.
          <div className="doc-snippet">
            {snippet.map((p, i) => (p.hit ? <mark className="ev-hl" key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
          </div>
        )}
      </Link>
      {/* ⚠️ LA DATA STA QUI, e non accanto al titolo: dentro il collegamento
          finiva dopo un titolo di lunghezza variabile, e siccome le pastiglie
          di destra sono più larghe in una riga che nell'altra, le date NON si
          incolonnavano — cioè le cifre tabulari non servivano a niente. Visto
          aprendo la schermata con tre righe di larghezze diverse: allineata «a
          destra» dentro un contenitore che si muove non è allineata. Il prezzo
          è che la data non fa parte del bersaglio cliccabile; il bersaglio
          restano il titolo e il mittente, che è quello che si legge. */}
      <div className="doc-row-side">
        <span className="doc-row-date">{formatDate(item.documentDate ?? item.createdAt)}</span>
        <div className="doc-row-badges">
          {marks.deadline && item.deadline && (
            <DeadlineMark
              date={item.deadline}
              display={formatDate(item.deadline)}
              toVerify={item.deadlineRequiresVerification}
            />
          )}
          {/* ⚠️ L'appuntamento compare NELLO STESSO POSTO del termine e con un
              segno DIVERSO: se non comparisse, un documento che fissa un
              sopralluogo sembrerebbe non avere alcuna data (e chi cercava il
              10.09.2026 non lo troverebbe più); se comparisse con il segno del
              termine, saremmo daccapo. */}
          {item.appointmentDate && (
            <AppointmentMark date={item.appointmentDate} display={formatDate(item.appointmentDate)} />
          )}
          {marks.toVerify && <ProvenanceMark kind="toVerify" />}
          {ownershipToConfirm && <Tag tone="attention">{t('documents.ownership.badge')}</Tag>}
          {marks.state && (
            <span className={stateBadgeClass(marks.state)}>{t(STATE_KEY[item.state])}</span>
          )}
          {item.openTaskCount > 0 && (
            <Tag>
              {item.openTaskCount === 1
                ? t('documents.tasksOpenOne')
                : t('documents.tasksOpenMany', { n: item.openTaskCount })}
            </Tag>
          )}
          {item.tags.slice(0, 2).map((tag) => <span className="doc-tag" key={tag.id}>{tag.name}</span>)}
        </div>
      </div>
    </div>
  );
}
