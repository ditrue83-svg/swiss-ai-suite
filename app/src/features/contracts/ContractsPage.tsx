// ============================================================================
// Contratti — con chi siamo legati, fino a quando, a quali condizioni.
//
// ⚠️⚠️ IL MODULO RIPORTA CIÒ CHE IL CONTRATTO DICE, NON CIÒ CHE IL DIRITTO
// IMPONE. In questa schermata non esiste — e non deve esistere — un pulsante
// «Disdici», «Rinnova», «Invia disdetta» o «Firma». Una data si mostra accanto
// al suo stato, e una decisione la prende l'azienda.
//
// La domanda a cui la pagina risponde non è «quanti contratti abbiamo» ma «che
// cosa richiede una decisione»: per questo i quattro numeri in alto sono da
// verificare, rinnovi prossimi, preavvisi prossimi e senza responsabile, e per
// questo l'ordinamento predefinito mette davanti i preavvisi che si avvicinano.
//
// ⚠️ OGNI DATA MOSTRATA PORTA IL PROPRIO STATO. «Rinnovo: 15 dicembre 2026 · da
// verificare» e «Rinnovo: 15 dicembre 2026» sono due affermazioni diverse, e
// mostrarle uguali toglierebbe a chi legge l'unica cosa che deve sapere.
//
// Tutto il lavoro sta nel database (`list_contracts`): filtri, ricerca,
// ordinamento, prossime date, conteggi e totale. Qui si scelgono i filtri e si
// mostra il risultato — venticinque righe alla volta, anche con duemila
// contratti.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { ErrorState, EmptyCta, SkeletonLine, SkeletonKpiGrid } from '@/components/ui/states';
import { contractService } from '@/services/contractService';
import { memberService } from '@/services/memberService';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { useT, type TFunction, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import {
  CONTRACT_PAGE_SIZE, DEFAULT_WINDOW_DAYS, MAX_QUERY_LENGTH, SORTS, VIEWS,
  contractState, filtersFromParams, hasActiveFilters, paramsFromFilters,
  type ContractState,
} from './contractModel';
import { cx } from '@/lib/cx';
import styles from './contracts.module.css';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import { ProvenanceMark } from '@/components/ui/ProvenanceMark';
import type {
  AssignableMember, ContractAutoRenewal, ContractFilters, ContractLifecycleStatus,
  ContractListItem, ContractReviewStatus, ContractSort, ContractSummary, ContractType,
  ContractView,
} from '@/types/models';

// ---------------------------------------------------------------------------
// Gli elenchi chiusi come `Record` completi e non funzioni con ripiego: se
// domani la 0024 aggiungesse un valore all'enum, il compilatore fallirebbe QUI
// invece di mostrare una casella vuota nei filtri.
// ---------------------------------------------------------------------------
const VIEW_KEY: Record<ContractView, TKey> = {
  all: 'contracts.views.all',
  needs_review: 'contracts.views.needs_review',
  active: 'contracts.views.active',
  renewals: 'contracts.views.renewals',
  notices: 'contracts.views.notices',
  archived: 'contracts.views.archived',
};
const SORT_KEY: Record<ContractSort, TKey> = {
  default: 'contracts.sorts.default',
  renewal: 'contracts.sorts.renewal',
  notice: 'contracts.sorts.notice',
  name: 'contracts.sorts.name',
  recent: 'contracts.sorts.recent',
};
const STATE_KEY: Record<ContractState, TKey> = {
  archived: 'contracts.states.archived',
  failed: 'contracts.states.failed',
  processing: 'contracts.states.processing',
  notice_soon: 'contracts.states.notice_soon',
  renewal_soon: 'contracts.states.renewal_soon',
  amendment: 'contracts.states.amendment',
  to_verify: 'contracts.states.to_verify',
  verified: 'contracts.states.verified',
};
/** Il colore della pastiglia. Il testo dice già tutto: il colore accompagna.
 *  ⚠️ `notice_soon` era ROSSO: un preavviso vicino è urgente, non guasto — il
 *  rosso resta a `failed` (lettura non riuscita) e allo scaduto delle cifre.
 *  `to_verify` non è più qui: è il segno epistemico di famiglia (filetto
 *  puntinato), reso a parte nella riga. */
const STATE_TONE: Record<ContractState, TagTone> = {
  archived: 'neutral', failed: 'alert', processing: 'neutral',
  notice_soon: 'attention', renewal_soon: 'attention', amendment: 'attention',
  to_verify: 'attention', verified: 'info',
};

const CONTRACT_TYPES: ContractType[] = [
  'insurance', 'leasing', 'rent', 'telecom', 'software_subscription',
  'supplier', 'maintenance', 'service', 'licensing', 'nda', 'other',
];
const LIFECYCLES: ContractLifecycleStatus[] =
  ['unknown', 'upcoming', 'active', 'ended', 'terminated'];
const REVIEWS: ContractReviewStatus[] = ['needs_review', 'verified', 'review_required_again'];
const RENEWALS: ContractAutoRenewal[] = ['yes', 'no', 'unclear'];

export function ContractsPage() {
  const { activeCompany: company } = useCompany();
  const t = useT();
  const L = useLabels();
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [items, setItems] = useState<ContractListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ContractSummary | null>(null);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [loading, setLoading] = useState(true);
  // ⚠️ DUE errori distinti e non uno solo: l'elenco e i numeri sono due
  // interrogazioni, e a migrazione mancante fallirebbero entrambe con lo stesso
  // messaggio. Mostrarlo due volte in due riquadri rossi è il difetto già
  // trovato in Finanze e nel Calendario — qui il guasto si dichiara UNA volta.
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [draftQuery, setDraftQuery] = useState(filters.query ?? '');

  useEffect(() => { setDraftQuery(filters.query ?? ''); }, [filters.query]);

  useEffect(() => {
    if (!company) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [page, sum, dir] = await Promise.all([
          contractService.list(company.id, { ...filters, limit: CONTRACT_PAGE_SIZE }),
          contractService.summary(company.id, DEFAULT_WINDOW_DAYS),
          memberService.listAssignable(company.id).catch(() => [] as AssignableMember[]),
        ]);
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setSummary(sum);
        setMembers(dir);
      } catch (e) {
        if (!cancelled) setError(toUserMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [company, filters]);

  function update(patch: Partial<ContractFilters>) {
    // Cambiando un filtro si torna alla prima pagina: restare a pagina tre di
    // un elenco che ora ne ha una sola mostrerebbe il vuoto.
    setParams(paramsFromFilters({ ...filters, ...patch, offset: 0 }));
  }

  function nameOf(userId: string | null): string | null {
    if (!userId) return null;
    // ⚠️ Il nome può essere vuoto se la persona non ha completato il profilo:
    // in quel caso NON si inventa, si torna null e la riga dice «nessun
    // responsabile» — che è comunque un'informazione vera sul dato che manca.
    return members.find((m) => m.userId === userId)?.name || null;
  }

  const page = Math.floor((filters.offset ?? 0) / CONTRACT_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / CONTRACT_PAGE_SIZE));

  return (
    <>
      <div className="page-head ct-head">
        <div>
          <div className="page-title">{t('contracts.title')}</div>
          <div className="page-desc">{t('contracts.subtitle')}</div>
        </div>
        <Link className="btn btn-primary" to="/contratti/nuovo">
          <Icon name="plus" className="ic-sm" /> {t('contracts.add')}
        </Link>
      </div>

      {/* I numeri. Ognuno è un filtro: guardare e agire sono lo stesso gesto. */}
      {loading && !summary ? <SkeletonKpiGrid /> : summary && (
        <div className="kpi-grid">
          <KpiCard
            label={t('contracts.kpi.needsReview')} value={summary.needsReview}
            active={filters.view === 'needs_review'}
            onClick={() => update({ view: 'needs_review' })} t={t}
          />
          <KpiCard
            label={t('contracts.kpi.renewalsSoon')} value={summary.renewalsSoon}
            note={t('contracts.kpi.windowNote', { days: String(DEFAULT_WINDOW_DAYS) })}
            active={filters.view === 'renewals'}
            onClick={() => update({ view: 'renewals' })} t={t}
          />
          <KpiCard
            label={t('contracts.kpi.noticesSoon')} value={summary.noticesSoon}
            note={t('contracts.kpi.windowNote', { days: String(DEFAULT_WINDOW_DAYS) })}
            active={filters.view === 'notices'}
            onClick={() => update({ view: 'notices' })} t={t}
          />
          <KpiCard
            label={t('contracts.kpi.withoutOwner')} value={summary.withoutOwner}
            active={filters.withoutOwner === true}
            onClick={() => update({ withoutOwner: !filters.withoutOwner })} t={t}
          />
        </div>
      )}

      <nav className="tabs" aria-label={t('contracts.views.all')}>
        {VIEWS.map((v) => (
          <button
            key={v} type="button"
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
          className={cx('field', styles.ctSearch)}
          onSubmit={(e) => { e.preventDefault(); update({ query: draftQuery }); }}
        >
          <label className={styles.ctSr} htmlFor="contract-q">{t('contracts.searchPlaceholder')}</label>
          <input
            id="contract-q" type="search" value={draftQuery}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t('contracts.searchPlaceholder')}
            onChange={(e) => setDraftQuery(e.target.value)}
          />
          <button className="btn" type="submit">{t('common.search')}</button>
        </form>

        <button
          type="button" className="btn btn-ghost"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
        >
          <Icon name="settings" /> {t('contracts.filters')}
        </button>

        <div className="field ct-inline">
          <label htmlFor="contract-sort">{t('contracts.sort')}</label>
          <select
            id="contract-sort" value={filters.sort ?? 'default'}
            onChange={(e) => update({ sort: e.target.value as ContractSort })}
          >
            {SORTS.map((s) => <option key={s} value={s}>{t(SORT_KEY[s])}</option>)}
          </select>
        </div>
      </div>
      <p className="muted-sm">{t('contracts.searchHint')}</p>

      {showFilters && (
        <div className="doc-filters">
          <div className="field">
            <label htmlFor="f-type">{t('contracts.detail.fields.type')}</label>
            <select
              id="f-type" value={filters.type ?? ''}
              onChange={(e) => update({ type: (e.target.value || null) as ContractType | null })}
            >
              <option value="">{t('common.all')}</option>
              {CONTRACT_TYPES.map((v) => (
                <option key={v} value={v}>{L.contractType(v)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-life">{t('contracts.detail.fields.lifecycle')}</label>
            <select
              id="f-life" value={filters.lifecycle ?? ''}
              onChange={(e) => update({
                lifecycle: (e.target.value || null) as ContractLifecycleStatus | null,
              })}
            >
              <option value="">{t('common.all')}</option>
              {LIFECYCLES.map((v) => (
                <option key={v} value={v}>{L.contractLifecycle(v)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-review">{t('contracts.views.needs_review')}</label>
            <select
              id="f-review" value={filters.review ?? ''}
              onChange={(e) => update({
                review: (e.target.value || null) as ContractReviewStatus | null,
              })}
            >
              <option value="">{t('common.all')}</option>
              {REVIEWS.map((v) => (
                <option key={v} value={v}>{L.contractReview(v)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-renewal">{t('contracts.detail.fields.autoRenewal')}</label>
            <select
              id="f-renewal" value={filters.autoRenewal ?? ''}
              onChange={(e) => update({
                autoRenewal: (e.target.value || null) as ContractAutoRenewal | null,
              })}
            >
              <option value="">{t('common.all')}</option>
              {RENEWALS.map((v) => (
                <option key={v} value={v}>{L.contractRenewal(v)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-owner">{t('contracts.detail.fields.owner')}</label>
            <select
              id="f-owner" value={filters.owner ?? ''}
              onChange={(e) => update({ owner: e.target.value || null })}
            >
              <option value="">{t('common.all')}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name || m.userId.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          {hasActiveFilters(filters) && (
            <button type="button" className="btn btn-ghost" onClick={() => update({
              query: null, type: null, lifecycle: null, review: null,
              owner: null, autoRenewal: null, withoutOwner: false,
            })}>
              {t('contracts.clearFilters')}
            </button>
          )}
        </div>
      )}

      {/* ⚠️ IL GUASTO VIENE PRIMA DI QUALUNQUE INTERPRETAZIONE. Senza questo
          ramo, una migrazione mancante mostrerebbe «nessun contratto» — un
          guasto travestito da stato legittimo, la trappola già pagata con
          l'Inbox e la 0013. */}
      {error ? (
        <ErrorState message={error} />
      ) : loading ? (
        <div className="list">
          {Array.from({ length: 4 }, (_, i) => <SkeletonLine key={i} />)}
        </div>
      ) : items.length === 0 ? (
        hasActiveFilters(filters) || filters.view !== 'all' ? (
          <EmptyCta title={t('contracts.emptyFiltered')} />
        ) : (
          <EmptyCta
            icon="document"
            title={t('contracts.empty')}
            subtitle={t('contracts.emptyHint')}
            action={(
              <div className="row-wrap">
                <Link className="btn btn-primary" to="/contratti/nuovo">
                  {t('contracts.add')}
                </Link>
                <Link className="btn" to="/documenti">{t('contracts.openDocuments')}</Link>
              </div>
            )}
          />
        )
      ) : (
        <>
          <ul className="list">
            {items.map((c) => (
              <ContractRow key={c.id} contract={c} ownerName={nameOf(c.ownerUserId)} t={t} L={L} />
            ))}
          </ul>

          {pages > 1 && (
            <div className="fin-pager">
              <span className="muted-sm">{items.length} / {total}</span>
              <div className="row-wrap">
                <button
                  type="button" className="btn btn-sm" disabled={page <= 1}
                  onClick={() => setParams(paramsFromFilters({
                    ...filters, offset: Math.max(0, (filters.offset ?? 0) - CONTRACT_PAGE_SIZE),
                  }))}
                >
                  <Icon name="arrowLeft" className="ic-sm" /> {t('common.back')}
                </button>
                <span className="muted-sm fin-page-n">{page} / {pages}</span>
                <button
                  type="button" className="btn btn-sm" disabled={page >= pages}
                  onClick={() => setParams(paramsFromFilters({
                    ...filters, offset: (filters.offset ?? 0) + CONTRACT_PAGE_SIZE,
                  }))}
                >
                  {t('common.next')} <Icon name="arrowRight" className="ic-sm" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* §20 — discreto, e in un posto solo. */}
      <p className="legal-note">{t('contracts.disclaimer')}</p>
    </>
  );
}

function KpiCard(props: {
  label: string; value: number; note?: string;
  active: boolean; onClick: () => void; t: TFunction;
}) {
  return (
    <button
      type="button"
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
 * Una riga.
 *
 * ⚠️ OGNI DATA PORTA IL PROPRIO STATO. Una data `candidate` è una proposta del
 * sistema: scriverla senza «da verificare» accanto la farebbe leggere come una
 * scadenza accertata, ed è la differenza su cui è costruito tutto il modulo.
 */
function ContractRow(props: {
  contract: ContractListItem; ownerName: string | null;
  t: TFunction; L: ReturnType<typeof useLabels>;
}) {
  const { contract: c, t, L } = props;
  const state = contractState(c);

  return (
    <li className="list-row">
      <Link to={`/contratti/${c.id}`} className={styles.ctRowLink}>
        <div className="list-main">
          <span className="list-title">{c.displayName}</span>
          {state === 'to_verify'
            ? <ProvenanceMark kind="toVerify" />
            : <Tag tone={STATE_TONE[state]}>{t(STATE_KEY[state])}</Tag>}
        </div>

        <div className="list-sub">
          <span>{L.contractType(c.contractType)}</span>
          {c.counterpartyName && <span>{c.counterpartyName}</span>}
          {c.documentCount > 0 && (
            <span>{c.documentCount} {t('contracts.row.documents')}</span>
          )}
        </div>

        <div className="list-sub">
          {/* ⚠️ IL DIFETTO CHIUSO QUI: i giorni si contavano anche su date
              «candidate», cioè mai verificate da una persona (nessun cancello
              su nextNoticeStatus/nextRenewalStatus). La marcatura del termine
              lo decide da sé: data verificata → cifre e distanza (ambra entro
              i 30 giorni del preavviso), data candidate → «Data da
              verificare», e NESSUN conteggio su una data non verificata. */}
          {c.nextRenewalDate && (
            <span>
              <strong>{t('contracts.row.renewal')}:</strong>{' '}
              <DeadlineMark date={c.nextRenewalDate} display={formatDate(c.nextRenewalDate)}
                toVerify={c.nextRenewalStatus === 'candidate'} />
            </span>
          )}
          {c.noticePeriodValue && c.noticePeriodUnit && (
            <span>
              <strong>{t('contracts.row.notice')}:</strong>{' '}
              {c.noticePeriodValue} {L.contractUnit(c.noticePeriodUnit)}
              {/* ⚠️ Il preavviso c'è ma la data no: si dice, invece di lasciare
                  un posto vuoto che verrebbe letto come «nessuna scadenza». */}
              {!c.nextNoticeDate ? (
                <em className={styles.ctUnverified}> · {t('contracts.row.noDate')}</em>
              ) : (
                <>
                  {' '}
                  <DeadlineMark date={c.nextNoticeDate} display={formatDate(c.nextNoticeDate)}
                    toVerify={c.nextNoticeStatus === 'candidate'} soonDays={30} />
                </>
              )}
            </span>
          )}
          <span>
            <strong>{t('contracts.row.owner')}:</strong>{' '}
            {props.ownerName ?? <em>{t('contracts.row.noOwner')}</em>}
          </span>
        </div>
      </Link>
    </li>
  );
}
