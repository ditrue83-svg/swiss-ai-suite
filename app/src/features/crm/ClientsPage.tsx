// ============================================================================
// Clienti — con chi stiamo lavorando.
//
// ⚠️⚠️ IN QUESTA SCHERMATA NON ESISTE, E NON DEVE ESISTERE, un pulsante «Invia
// campagna», «Avvia sequenza», «Chiama», «Genera vendita con AI» o un punteggio
// accanto a un nome (§57, §151, §152). Il CRM organizza la relazione: non
// contatta le persone e non le giudica.
//
// La domanda a cui la pagina risponde non è «quanti clienti abbiamo» ma «dove
// serve un gesto»: per questo i quattro numeri in alto sono opportunità aperte,
// trattative senza prossimo passo, follow-up scaduti e relazioni senza contatto
// recente — e per questo la vista predefinita è l'elenco, non la pipeline.
//
// ⚠️ §55 — LA PIPELINE NON È LA VISTA PRINCIPALE. Un cliente attivo senza
// trattative aperte è la maggioranza dei clienti di una PMI, e in una board a
// colonne non comparirebbe da nessuna parte.
//
// Tutto il lavoro sta nel database (`list_crm_organizations`,
// `crm_home_summary`, `crm_pipeline_summary`): filtri, ricerca, ordinamento,
// conteggi e totale. Qui si scelgono i filtri e si mostra il risultato —
// venticinque righe alla volta, anche con mille clienti.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { EmptyCta, ErrorState, SkeletonKpiGrid, SkeletonLine } from '@/components/ui/states';
import { crmService } from '@/services/crmService';
import { memberService } from '@/services/memberService';
import { formatDate } from '@/lib/format';
import { useT, type TFunction, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import type {
  AssignableMember, CrmHomeSummary, CrmOpportunity, CrmOrganization, CrmPipelineCell,
} from '@/types/models';
import type {
  CrmOpportunityStage, CrmOrganizationRole, CrmRelationshipStatus,
} from '@/types/database';
import {
  CRM_PAGE_SIZE, CRM_SORTS, CRM_VIEWS, DEFAULT_STALE_DAYS, MAX_QUERY_LENGTH,
  PIPELINE_STAGES, countByStage, daysSince, filtersFromParams, hasActiveFilters,
  organizationState, organizationStateKey, opportunityState, opportunityStateKey,
  paramsFromFilters, pipelineByCurrency, secondaryName,
  type CrmFilters, type CrmOrganizationState, type CrmSort, type CrmView,
} from './crmModel';

/**
 * Gli elenchi chiusi come `Record` COMPLETI e non funzioni con ripiego: se
 * domani la migrazione aggiungesse un valore all'enum, il compilatore
 * fallirebbe QUI invece di mostrare una pastiglia vuota in pagina.
 */
const VIEW_KEY: Record<CrmView, TKey> = {
  customers: 'crm.views.customers',
  prospects: 'crm.views.prospects',
  pipeline: 'crm.views.pipeline',
  all: 'crm.views.all',
};
const SORT_KEY: Record<CrmSort, TKey> = {
  updated: 'crm.sorts.updated',
  name: 'crm.sorts.name',
  last_contact: 'crm.sorts.last_contact',
  created: 'crm.sorts.created',
};
const STATE_KEY: Record<CrmOrganizationState, TKey> = {
  archived: 'crm.states.archived',
  merged: 'crm.states.merged',
  overdue_tasks: 'crm.states.overdueTasks',
  never_contacted: 'crm.states.neverContacted',
  stale: 'crm.states.stale',
  active_deal: 'crm.states.activeDeal',
  inactive: 'crm.states.inactive',
  ok: 'crm.states.ok',
};
/** Il colore accompagna: il testo dice già tutto (regola del sistema di design). */
const STATE_TONE: Record<CrmOrganizationState, string> = {
  archived: 'badge-neutral', merged: 'badge-neutral',
  overdue_tasks: 'badge-alta', never_contacted: 'badge-media',
  stale: 'badge-media', active_deal: 'badge-blue',
  inactive: 'badge-neutral', ok: 'badge-neutral',
};

const ROLES: CrmOrganizationRole[] = [
  'lead', 'prospect', 'customer', 'former_customer',
  'supplier', 'partner', 'authority', 'other',
];
const STATUSES: CrmRelationshipStatus[] = ['active', 'inactive'];
const STAGES: CrmOpportunityStage[] = [
  'lead', 'contacted', 'proposal', 'negotiation', 'won', 'lost',
];
/** §69 — soglie proposte, non verità. La predefinita è dichiarata nel modello. */
const STALE_OPTIONS = [30, 60, 90, 180];
/** §54 — quante caselle si caricano per la board, e il numero è dichiarato. */
const BOARD_LIMIT = 100;

export function ClientsPage() {
  const { activeCompany: company } = useCompany();
  const t = useT();
  const L = useLabels();
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [items, setItems] = useState<CrmOrganization[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<CrmHomeSummary | null>(null);
  const [pipeline, setPipeline] = useState<CrmPipelineCell[]>([]);
  const [deals, setDeals] = useState<CrmOpportunity[]>([]);
  const [dealTotal, setDealTotal] = useState(0);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [loading, setLoading] = useState(true);
  // ⚠️ UN errore e non tre: l'elenco, i numeri e la pipeline sono tre
  // interrogazioni, e a migrazione mancante fallirebbero tutte con lo stesso
  // messaggio. Tre riquadri rossi identici sono il difetto già trovato in
  // Finanze e nel Calendario.
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [draftQuery, setDraftQuery] = useState(filters.query ?? '');
  // ⚠️ La chiave dell'azienda viaggia NELLO STATO. Senza, cambiando azienda si
  // vedono per un istante i clienti di quella precedente sotto il nome della
  // nuova: non esiste alcuna invalidazione globale di cache in questo prodotto,
  // e ogni schermata deve portarsi la propria chiave (come `useDocumentList`).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const isPipeline = filters.view === 'pipeline';
  const staleDays = filters.staleDays ?? DEFAULT_STALE_DAYS;

  useEffect(() => { setDraftQuery(filters.query ?? ''); }, [filters.query]);

  useEffect(() => {
    if (!company) return;
    const key = company.id;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [page, sum, cells, dir, board] = await Promise.all([
          crmService.list(key, filters),
          crmService.homeSummary(key, staleDays),
          crmService.pipeline(key),
          memberService.listAssignable(key).catch(() => [] as AssignableMember[]),
          isPipeline
            ? crmService.opportunities(key, { limit: BOARD_LIMIT, sort: 'updated' })
            : Promise.resolve({ items: [] as CrmOpportunity[], total: 0 }),
        ]);
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setSummary(sum);
        setPipeline(cells);
        setMembers(dir);
        setDeals(board.items);
        setDealTotal(board.total);
        setLoadedFor(key);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [company, filters, staleDays, isPipeline]);

  function update(patch: Partial<CrmFilters>) {
    // Cambiando un filtro si torna alla prima pagina: restare a pagina tre di
    // un elenco che ora ne ha una sola mostrerebbe il vuoto.
    setParams(paramsFromFilters({ ...filters, ...patch, offset: 0 }));
  }

  function nameOf(userId: string | null): string | null {
    if (!userId) return null;
    // ⚠️ Il nome può essere vuoto se la persona non ha completato il profilo:
    // NON si inventa, si torna null e la riga dice «nessun responsabile» — che
    // è comunque un'informazione vera sul dato che manca.
    return members.find((m) => m.userId === userId)?.name || null;
  }

  const fresh = loadedFor === company?.id;
  const page = Math.floor(filters.offset / CRM_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / CRM_PAGE_SIZE));
  const perCurrency = useMemo(() => pipelineByCurrency(pipeline), [pipeline]);
  const stageCounts = useMemo(() => countByStage(pipeline), [pipeline]);

  if (!company) return null;

  return (
    <>
      <div className="page-head ct-head">
        <div>
          <div className="page-title">{t('crm.title')}</div>
          <div className="page-desc">{t('crm.subtitle')}</div>
        </div>
        <Link className="btn btn-primary" to="/clienti/nuovo">
          <Icon name="plus" className="ic-sm" /> {t('crm.add')}
        </Link>
      </div>

      {error && <ErrorState message={t(error as TKey) || error} />}

      {/* I numeri. Ognuno è un filtro: guardare e agire sono lo stesso gesto.
          ⚠️ `summary === null` NON significa «tutto a zero»: la funzione SQL
          filtra su `is_company_member`, quindi zero righe vuol dire «non sei
          membro». Mostrare quattro zeri sarebbe un guasto travestito da stato
          legittimo. */}
      {loading && !summary ? <SkeletonKpiGrid /> : summary ? (
        <div className="kpi-grid">
          <KpiCard
            label={t('crm.kpi.openOpportunities')} value={summary.openOpportunities}
            active={isPipeline} onClick={() => update({ view: 'pipeline' })}
          />
          <KpiCard
            label={t('crm.kpi.withoutNextStep')} value={summary.withoutNextStep}
            active={false} onClick={() => update({ view: 'pipeline', noOpenOpportunity: false })}
          />
          <KpiCard
            label={t('crm.kpi.overdueFollowUps')} value={summary.overdueFollowUps}
            active={false} onClick={() => update({ view: 'pipeline' })}
          />
          <KpiCard
            label={t('crm.kpi.stale')} value={summary.staleRelationships}
            note={t('crm.kpi.staleNote', { n: staleDays })}
            active={filters.staleDays !== null}
            onClick={() => update({
              view: 'all',
              staleDays: filters.staleDays === null ? DEFAULT_STALE_DAYS : null,
            })}
          />
        </div>
      ) : !loading && !error ? (
        <ErrorState message={t('crm.noAccess')} />
      ) : null}

      <nav className="tabs" aria-label={t('crm.title')}>
        {CRM_VIEWS.map((v) => (
          <button
            key={v} type="button"
            /* ⚠️ `active` e NON `is-active`: `.tab.is-active` non esiste nel CSS.
               I Contratti hanno quel difetto e la scheda attiva non si evidenzia. */
            className={`tab ${filters.view === v ? 'active' : ''}`}
            aria-current={filters.view === v ? 'page' : undefined}
            onClick={() => update({ view: v })}
          >
            {t(VIEW_KEY[v])}
          </button>
        ))}
      </nav>

      <div className="row-wrap ct-toolbar">
        <form
          className="field crm-search"
          onSubmit={(e) => { e.preventDefault(); update({ query: draftQuery.trim() || null }); }}
        >
          <label className="sr-only" htmlFor="crm-q">{t('crm.searchPlaceholder')}</label>
          <input
            id="crm-q" type="search" value={draftQuery} maxLength={MAX_QUERY_LENGTH}
            placeholder={t('crm.searchPlaceholder')}
            onChange={(e) => setDraftQuery(e.target.value)}
          />
          <button className="btn" type="submit">{t('common.search')}</button>
        </form>

        <button
          type="button" className="btn btn-ghost" aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
        >
          <Icon name="settings" className="ic-sm" /> {t('crm.filters.title')}
        </button>

        {!isPipeline && (
          <div className="field ct-inline">
            <label htmlFor="crm-sort">{t('crm.sort')}</label>
            <select
              id="crm-sort" value={filters.sort}
              onChange={(e) => update({ sort: e.target.value as CrmSort })}
            >
              {CRM_SORTS.map((s) => <option key={s} value={s}>{t(SORT_KEY[s])}</option>)}
            </select>
          </div>
        )}
      </div>
      <p className="muted-sm">{t('crm.searchHint')}</p>

      {showFilters && (
        <div className="doc-filters">
          <div className="field">
            <label htmlFor="f-role">{t('crm.filters.role')}</label>
            <select
              id="f-role" value={filters.role ?? ''}
              onChange={(e) => update({ role: (e.target.value || null) as CrmOrganizationRole | null })}
            >
              <option value="">{t('crm.filters.any')}</option>
              {ROLES.map((r) => <option key={r} value={r}>{L.crmRole(r)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-owner">{t('crm.filters.owner')}</label>
            <select
              id="f-owner" value={filters.owner ?? ''}
              onChange={(e) => update({ owner: e.target.value || null })}
            >
              <option value="">{t('crm.filters.any')}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || m.userId.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-status">{t('crm.filters.status')}</label>
            <select
              id="f-status" value={filters.status ?? ''}
              onChange={(e) => update({ status: (e.target.value || null) as CrmRelationshipStatus | null })}
            >
              <option value="">{t('crm.filters.any')}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{L.crmStatus(s)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-stage">{t('crm.filters.stage')}</label>
            <select
              id="f-stage" value={filters.stage ?? ''}
              onChange={(e) => update({ stage: (e.target.value || null) as CrmOpportunityStage | null })}
            >
              <option value="">{t('crm.filters.any')}</option>
              {STAGES.map((s) => <option key={s} value={s}>{L.crmStage(s)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-stale">{t('crm.filters.stale')}</label>
            <select
              id="f-stale" value={filters.staleDays ?? ''}
              onChange={(e) => update({
                staleDays: e.target.value ? Number(e.target.value) : null,
              })}
            >
              <option value="">{t('crm.filters.any')}</option>
              {STALE_OPTIONS.map((d) => (
                <option key={d} value={d}>{t('tasks.dueInDays', { n: d })}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="task-check" htmlFor="f-overdue">
              <input
                id="f-overdue" type="checkbox" checked={filters.onlyOverdueTasks}
                onChange={(e) => update({ onlyOverdueTasks: e.target.checked })}
              />
              {t('crm.filters.overdueTasks')}
            </label>
            <label className="task-check" htmlFor="f-noopp">
              <input
                id="f-noopp" type="checkbox" checked={filters.noOpenOpportunity}
                onChange={(e) => update({ noOpenOpportunity: e.target.checked })}
              />
              {t('crm.filters.noOpportunity')}
            </label>
            <label className="task-check" htmlFor="f-arch">
              <input
                id="f-arch" type="checkbox" checked={filters.archived}
                onChange={(e) => update({ archived: e.target.checked })}
              />
              {t('crm.filters.archived')}
            </label>
          </div>
          {hasActiveFilters(filters) && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setParams(new URLSearchParams())}>
              {t('crm.clearFilters')}
            </button>
          )}
        </div>
      )}

      {isPipeline ? (
        <PipelineBoard
          deals={deals} loading={loading && !fresh} stageCounts={stageCounts}
          perCurrency={perCurrency} loadedCount={deals.length} total={dealTotal}
          t={t} L={L}
        />
      ) : loading && !fresh ? (
        <ul className="crm-list">
          {Array.from({ length: 4 }, (_, i) => <li key={i}><SkeletonLine /></li>)}
        </ul>
      ) : items.length === 0 ? (
        hasActiveFilters(filters) || filters.view !== 'all' ? (
          <EmptyCta title={t('crm.emptyFiltered')} />
        ) : (
          <EmptyCta
            icon="user"
            title={t('crm.empty')}
            subtitle={t('crm.emptyHint')}
            action={(
              <div className="row-wrap">
                <Link className="btn btn-primary" to="/clienti/nuovo">{t('crm.add')}</Link>
                <Link className="btn" to="/inbox">{t('crm.emptySecondary')}</Link>
              </div>
            )}
          />
        )
      ) : (
        <>
          <ul className="crm-list">
            {items.map((o) => (
              <OrganizationRow
                key={o.id} org={o} ownerName={nameOf(o.accountOwnerUserId)}
                staleDays={staleDays} t={t} L={L}
              />
            ))}
          </ul>

          {pages > 1 && (
            <div className="fin-pager">
              <span className="muted-sm">{items.length} / {total}</span>
              <div className="row-wrap">
                <button
                  type="button" className="btn btn-sm" disabled={page <= 1}
                  onClick={() => setParams(paramsFromFilters({
                    ...filters, offset: Math.max(0, filters.offset - CRM_PAGE_SIZE),
                  }))}
                >
                  <Icon name="arrowLeft" className="ic-sm" /> {t('common.back')}
                </button>
                <span className="muted-sm fin-page-n">{page} / {pages}</span>
                <button
                  type="button" className="btn btn-sm" disabled={page >= pages}
                  onClick={() => setParams(paramsFromFilters({
                    ...filters, offset: filters.offset + CRM_PAGE_SIZE,
                  }))}
                >
                  {t('common.next')} <Icon name="arrowRight" className="ic-sm" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* §77 — discreto, e in un posto solo: il valore di pipeline non è un
          ricavo, e questa è l'unica riga che lo dice. */}
      <p className="muted-sm mt-8">{t('crm.disclaimer')}</p>
    </>
  );
}

function KpiCard(props: {
  label: string; value: number; note?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      /* ⚠️ `ct-kpi` porta con sé `background` e `color` ESPLICITI: un `button`
         senza sfondo dichiarato prende `buttonface` dal browser — bianco — e in
         tema scuro il numero diventa illeggibile. */
      className={`kpi ct-kpi ${props.active ? 'is-active' : ''}`}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      <span className="kpi-label">{props.label}</span>
      <span className="kpi-value">{props.value}</span>
      {props.note && <span className="kpi-sub">{props.note}</span>}
    </button>
  );
}

/**
 * Una riga dell'elenco.
 *
 * ⚠️ UNA SOLA PASTIGLIA DI STATO, la più importante: una riga con quattro
 * pastiglie non si legge. L'ordine delle priorità sta in `organizationState`,
 * dove si può provare offline.
 *
 * ⚠️ La ragione sociale si mostra SOLO se diversa dal nome d'uso: «Rossi SA ·
 * Rossi SA» è il difetto che il Document Hub ha già pagato con «Assicurazioni
 * sociali · Assicurazioni sociali», visto soltanto aprendo la schermata.
 */
function OrganizationRow(props: {
  org: CrmOrganization; ownerName: string | null; staleDays: number;
  t: TFunction; L: ReturnType<typeof useLabels>;
}) {
  const { org: o, t, L } = props;
  const state = organizationState(o, props.staleDays);
  const legal = secondaryName(o);
  const days = o.lastContactAt ? daysSince(o.lastContactAt) : null;

  return (
    <li className="list-row">
      <Link to={`/clienti/${o.id}`} className="crm-row-link">
        <div className="list-main">
          <span className="list-title">{o.displayName}</span>
          <span className={`badge ${STATE_TONE[state]}`}>{t(STATE_KEY[state])}</span>
        </div>

        {legal && <div className="list-sub">{legal}</div>}

        <div className="crm-roles">
          {o.roles.length === 0
            ? <em className="muted-sm">{t('crm.row.noRoles')}</em>
            : o.roles.map((r) => (
              <span key={r} className="badge badge-neutral">{L.crmRole(r)}</span>
            ))}
        </div>

        <div className="list-sub">
          {o.city && <span>{o.city}{o.canton ? ` (${o.canton})` : ''}</span>}
          <span>
            {/* Il responsabile: se il profilo è incompleto il nome è vuoto, e la
                riga lo dichiara invece di mostrare una cella bianca. */}
            {props.ownerName ?? <em>{t('crm.row.noOwner')}</em>}
          </span>
          {o.contactCount > 0
            ? <span>{o.contactCount} · {t('crm.detail.people')}</span>
            : <em>{t('crm.row.noContact')}</em>}
        </div>

        <div className="list-sub">
          <span>
            {days === null
              ? <em>{t('crm.row.neverContacted')}</em>
              : <>{t('crm.detail.lastContact')}: {formatDate(o.lastContactAt)}</>}
          </span>
          {o.openOpportunityCount > 0 && (
            <span>{o.openOpportunityCount} · {t('crm.detail.opportunities')}</span>
          )}
          {o.overdueTaskCount > 0 && (
            <span><strong>{o.overdueTaskCount}</strong> · {t('crm.filters.overdueTasks')}</span>
          )}
          {o.contractCount > 0 && <span>{o.contractCount} · {t('crm.detail.contracts')}</span>}
        </div>
      </Link>
    </li>
  );
}

/**
 * La vista a colonne.
 *
 * ⚠️ §54 — NESSUN TRASCINAMENTO. Il cambio di fase avviene dalla scheda
 * dell'opportunità con una tendina: è accessibile da tastiera senza lavoro in
 * più, e non richiede alcuna libreria.
 *
 * ⚠️ I CONTEGGI DELLE COLONNE VENGONO DAL DATABASE (`crm_pipeline_summary`), non
 * dalle caselle caricate: si caricano al massimo cento opportunità, e se ce ne
 * sono di più la schermata lo DICE invece di mostrare un numero più piccolo del
 * vero.
 */
function PipelineBoard(props: {
  deals: CrmOpportunity[]; loading: boolean;
  stageCounts: Record<CrmOpportunityStage, number>;
  perCurrency: Array<{ currency: string | null; opportunityCount: number; totalAmount: number | null }>;
  loadedCount: number; total: number;
  t: TFunction; L: ReturnType<typeof useLabels>;
}) {
  const { t, L } = props;
  if (props.loading) {
    return (
      <div className="crm-board">
        {PIPELINE_STAGES.map((s) => (
          <div className="crm-col" key={s}><SkeletonLine /><SkeletonLine /></div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* §45 — il valore per VALUTA, e nessun totale unico. */}
      <div className="crm-ask">
        <div className="crm-sec-head">
          <strong>{t('crm.opp.pipelineValue')}</strong>
          <span className="muted-sm">{t('crm.opp.pipelineByCurrency')}</span>
        </div>
        {props.perCurrency.length === 0 ? (
          <span className="muted-sm">{t('crm.detail.emptyOpportunities')}</span>
        ) : (
          <div className="row-wrap">
            {props.perCurrency.map((c) => (
              <span key={c.currency ?? 'none'} className="badge badge-neutral">
                {c.totalAmount === null
                  ? <>{c.opportunityCount} · {t('crm.opp.noValue')}</>
                  : <>
                      {c.currency ?? t('crm.opp.unknownCurrency')}{' '}
                      {c.totalAmount.toLocaleString('de-CH')}
                      {' · '}{c.opportunityCount}
                    </>}
              </span>
            ))}
          </div>
        )}
      </div>

      {props.total > props.loadedCount && (
        <p className="muted-sm mt-8">{props.loadedCount} / {props.total}</p>
      )}

      <div className="crm-board mt-8">
        {PIPELINE_STAGES.map((stage) => {
          const cards = props.deals.filter((d) => d.stage === stage);
          return (
            <div className="crm-col" key={stage}>
              <div className="crm-col-head">
                <span className="crm-col-title">{L.crmStage(stage)}</span>
                <span className="crm-col-n">{props.stageCounts[stage]}</span>
              </div>
              {cards.length === 0 ? (
                <div className="crm-col-empty">—</div>
              ) : cards.map((d) => {
                const st = opportunityState(d);
                return (
                  <Link
                    key={d.id} className="crm-card"
                    to={`/clienti/${d.organizationId}/opportunita/${d.id}`}
                  >
                    <span className="crm-card-title">{d.title}</span>
                    <span className="crm-card-sub">{d.organizationName}</span>
                    <span className="crm-card-sub">
                      {d.valueAmount === null || !d.valueCurrency
                        ? <em>{t('crm.opp.noValue')}</em>
                        : `${d.valueCurrency} ${d.valueAmount.toLocaleString('de-CH')}`}
                    </span>
                    {(st === 'overdue_step' || st === 'no_step') && (
                      <span className="badge badge-media">{t(opportunityStateKey(st))}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
