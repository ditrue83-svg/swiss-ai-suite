// ============================================================================
// Scheda 1 — OPPORTUNITÀ. «Che cosa c'è per me, adesso».
//
// Un'opportunità è l'incontro fra UN PROGETTO e UNA VERSIONE di programma,
// eventualmente dentro UNA CALL. Non è «un programma che potrebbe
// interessarti»: il modulo 1.0 aveva `unique (company_id, program_id)` e
// bastava avere due progetti perché la seconda valutazione cancellasse la prima.
//
// ⚠️ LE SEI MISURE SI MOSTRANO SEPARATE, e la riga porta UN SOLO colore forte
//    (regola 8 del sistema di design). Il colore lo prende l'idoneità, che è la
//    misura che cambia quello che fai; la scadenza può prenderne un secondo, ma
//    solo quando `computeDeadline` la dichiara urgente — cioè quasi mai.
//
// ⚠️ IL PUNTEGGIO NON COMPARE. `relevanceScore` esiste, arriva dal database e
//    serve a ordinare: si mostra la FASCIA. «82/100» letto da un imprenditore
//    diventa «82% di possibilità di ottenerlo», che è una cosa che questo
//    prodotto non sa.
// ============================================================================
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Button, EmptyCta, ErrorState, SkeletonCard } from '@/components/ui/states';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { formatDate } from '@/lib/format';
import { incentivesService } from '@/services/incentivesService';
import type { SubsidyDismissalReason } from '@/types/database';
import type { IncentiveOpportunity, IncentiveProject } from '@/types/models';
import {
  COMPLETENESS_KEY, DISMISSAL_KEY, DISMISSAL_REASONS,
  NEXT_STEP_KEY, OPPORTUNITY_PAGE_SIZE, OPPORTUNITY_VIEWS, READINESS_KEY,
  RELEVANCE_KEY, TIMING_KEY, VIEW_KEY, deadlineNotice, nextStep, plural, subsidyErrorKey, todayISO,
  type IncentiveFilters, type OpportunityView,
} from './incentivesModel';
import { EligibilityMark } from '@/components/ui/EligibilityMark';
import { SourceStamp } from '@/components/ui/SourceStamp';
import { OpportunityDetail } from './OpportunityDetail';

interface Props {
  companyId: string;
  filters: IncentiveFilters;
  projects: IncentiveProject[];
  ready: boolean;
  onFilters: (patch: Partial<IncentiveFilters>) => void;
  onChanged: () => void;
  onGoProjects: () => void;
}

export function OpportunitiesTab({
  companyId, filters, projects, ready, onFilters, onChanged, onGoProjects,
}: Props) {
  const t = useT();
  const L = useLabels();
  const [items, setItems] = useState<IncentiveOpportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** L'opportunità su cui è aperta la domanda «perché la metti da parte». */
  const [dismissing, setDismissing] = useState<IncentiveOpportunity | null>(null);
  const [reload, setReload] = useState(0);

  const today = todayISO();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const page = await incentivesService.opportunities(companyId, {
          view: filters.view,
          projectId: filters.projectId,
          offset: filters.offset,
        });
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, filters.view, filters.projectId, filters.offset, reload]);

  const refresh = () => { setReload((n) => n + 1); onChanged(); };

  async function toggleSaved(o: IncentiveOpportunity) {
    try {
      await incentivesService.setSaved(o.id, o.savedAt === null);
      refresh();
    } catch (e) { setError(messageOf(e)); }
  }

  async function reopen(o: IncentiveOpportunity) {
    try {
      await incentivesService.reopen(o.id);
      refresh();
    } catch (e) { setError(messageOf(e)); }
  }

  function messageOf(e: unknown): string {
    const key = subsidyErrorKey(e);
    return key ? t(key) : (e instanceof Error ? e.message : String(e));
  }

  const page = Math.floor(filters.offset / OPPORTUNITY_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / OPPORTUNITY_PAGE_SIZE));
  const opened = openId ? items.find((o) => o.id === openId) ?? null : null;

  if (opened) {
    return (
      <OpportunityDetail
        companyId={companyId}
        opportunity={opened}
        onBack={() => setOpenId(null)}
        onChanged={refresh}
      />
    );
  }

  return (
    <>
      {/* Le viste. Sono SETTE e sono esattamente quelle che la funzione SQL
          accetta: un'ottava etichetta mostrerebbe l'elenco intero sotto la
          promessa di un filtro. */}
      <div className="row-wrap mb-8" role="group" aria-label={t('incentives.views.aria')}>
        {OPPORTUNITY_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={filters.view === v}
            className={`check-pill${filters.view === v ? ' on' : ''}`}
            onClick={() => onFilters({ view: v as OpportunityView })}
          >
            {t(VIEW_KEY[v])}
          </button>
        ))}
      </div>

      {/* §61 — i risultati non si mescolano fra progetti. Il filtro c'è solo se
          esiste più di un progetto: con uno solo sarebbe una scelta finta. */}
      {projects.length > 1 && (
        <div className="field mb-8">
          <label htmlFor="inc-project">{t('incentives.filterProject')}</label>
          <select
            id="inc-project"
            value={filters.projectId ?? ''}
            onChange={(e) => onFilters({ projectId: e.target.value || null })}
          >
            <option value="">{t('incentives.allProjects')}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={refresh} />}

      {loading && items.length === 0 ? (
        <><SkeletonCard /><SkeletonCard /></>
      ) : items.length === 0 ? (
        <EmptyState
          view={filters.view}
          hasProjects={projects.length > 0}
          ready={ready}
          onGoProjects={onGoProjects}
        />
      ) : (
        <div className="card">
          {items.map((o) => (
            <OpportunityRow
              key={o.id}
              o={o}
              today={today}
              supportLabel={L.supportType(o.supportType)}
              onOpen={() => setOpenId(o.id)}
              onToggleSaved={() => void toggleSaved(o)}
              onDismiss={() => setDismissing(o)}
              onReopen={() => void reopen(o)}
            />
          ))}
        </div>
      )}

      {/* Il paginatore è quello del CRM e delle Finanze: stesse etichette,
          stessa forma. Un modulo che impagina a modo suo costringe a
          reimparare il gesto più banale. */}
      {pages > 1 && (
        <div className="fin-pager">
          <span className="muted-sm">{items.length} / {total}</span>
          <div className="row-wrap">
            <button
              type="button" className="btn btn-sm" disabled={page <= 1}
              onClick={() => onFilters({ offset: Math.max(0, filters.offset - OPPORTUNITY_PAGE_SIZE) })}
            >
              <Icon name="arrowLeft" className="ic-sm" /> {t('common.back')}
            </button>
            <span className="muted-sm fin-page-n">{page} / {pages}</span>
            <button
              type="button" className="btn btn-sm" disabled={page >= pages}
              onClick={() => onFilters({ offset: filters.offset + OPPORTUNITY_PAGE_SIZE })}
            >
              {t('common.next')} <Icon name="arrowRight" className="ic-sm" />
            </button>
          </div>
        </div>
      )}

      {dismissing && (
        <DismissDialog
          opportunity={dismissing}
          onClose={() => setDismissing(null)}
          onDone={() => { setDismissing(null); refresh(); }}
          onError={(e) => setError(messageOf(e))}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// La riga
// ---------------------------------------------------------------------------
function OpportunityRow({
  o, today, supportLabel, onOpen, onToggleSaved, onDismiss, onReopen,
}: {
  o: IncentiveOpportunity; today: string; supportLabel: string;
  onOpen: () => void; onToggleSaved: () => void; onDismiss: () => void; onReopen: () => void;
}) {
  const t = useT();
  const notice = deadlineNotice(o, today);
  const step = nextStep(o, today);

  return (
    <div className="list-row inc-row">
      <div className="list-main">
        <div className="list-title">
          <button type="button" className="inc-open" onClick={onOpen}>{o.programName}</button>
        </div>
        <div className="list-sub">
          {o.authority}
          {supportLabel !== '—' && <> · {supportLabel}</>}
          {/* §62 — un'opportunità legata al solo profilo aziendale è una cosa
              diversa da una legata a un progetto, e va detto. */}
          {o.kind === 'general'
            ? <> · {t('incentives.generalOpportunity')}</>
            : o.projectTitle && <> · {o.projectTitle}</>}
        </div>

        {/* LE SEI MISURE. Etichetta e valore, una accanto all'altra: sono sei
            domande diverse e nessuna è una probabilità. */}
        <dl className="inc-measures">
          <Measure label={t('incentives.measures.relevance')} value={t(RELEVANCE_KEY[o.relevanceLevel])} />
          {/* Idoneità e freschezza portano il SEGNO della loro famiglia
              (giudizio, timbro): le altre quattro misure restano testo — non
              appartengono a nessuna famiglia di marcature, e un segno inventato
              per simmetria direbbe meno di una parola. */}
          <Measure label={t('incentives.measures.eligibility')} value={<EligibilityMark status={o.eligibilityStatus} />} />
          <Measure label={t('incentives.measures.completeness')} value={t(COMPLETENESS_KEY[o.completeness])} />
          <Measure label={t('incentives.measures.timing')} value={t(TIMING_KEY[o.timing])} />
          <Measure label={t('incentives.measures.freshness')} value={<SourceStamp state={o.sourceFreshness} />} />
          <Measure label={t('incentives.measures.readiness')} value={t(READINESS_KEY[o.readiness])} />
        </dl>

        {/* Che cosa fare adesso. È la domanda a cui il 1.0 non rispondeva. */}
        <div className="inc-next">
          <Icon name="arrowRight" className="ic-sm" /> {t(NEXT_STEP_KEY[step])}
        </div>

        {/* ⚠️ La scadenza si scrive SOLO se esiste una data strutturata, e il
            conto alla rovescia solo se il motore dichiara l'urgenza. Con una
            fonte vecchia si dice di verificare sulla pagina ufficiale: un
            promemoria su una data che non controlliamo da mesi è peggio di
            nessun promemoria. */}
        {notice.daysLeft !== null && (
          <div className={`inc-deadline${notice.urgent ? ' is-urgent' : ''}`}>
            <Icon name="clock" className="ic-sm" />
            {notice.expired
              ? t('incentives.deadlineExpired', { date: formatDate(o.callDeadlineOn) })
              : notice.verifyOnSource
                ? t('incentives.deadlineVerify', { date: formatDate(o.callDeadlineOn) })
                : t(plural(notice.daysLeft, 'incentives.deadlineInOne', 'incentives.deadlineIn'),
                  { days: notice.daysLeft, date: formatDate(o.callDeadlineOn) })}
            {/* §7 — l'ora esatta si dice solo se la fonte la dichiara. */}
            {notice.hasExactTime && <> · {t('incentives.deadlineExactTime')}</>}
          </div>
        )}

        {o.assessmentStale && (
          <div className="inc-flag">{t('incentives.staleAssessment')}</div>
        )}
        {o.reopenSuggestedAt && o.dismissedAt && (
          <div className="inc-flag">{t('incentives.reopenSuggested')}</div>
        )}
      </div>

      <div className="inc-row-side">
        {o.dismissedAt ? (
          <>
            <span className="badge badge-neutral">
              {o.dismissedReason ? t(DISMISSAL_KEY[o.dismissedReason]) : t('incentives.dismissed')}
            </span>
            <button type="button" className="mini-btn" onClick={onReopen}>
              {t('incentives.reopen')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="mini-btn" onClick={onToggleSaved}>
              <Icon name="star" className="ic-sm" />
              {o.savedAt ? t('incentives.unsave') : t('incentives.save')}
            </button>
            <button type="button" className="mini-btn" onClick={onDismiss}>
              {t('incentives.dismiss.action')}
            </button>
          </>
        )}
        <button type="button" className="mini-btn" onClick={onOpen}>
          {t('incentives.openDetail')}
        </button>
      </div>
    </div>
  );
}

function Measure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="inc-measure">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// «Perché la metti da parte»
//
// ⚠️ IL MOTIVO È OBBLIGATORIO, e non è burocrazia: il record non si cancella,
//    e se domani la call cambia si può proporre di riguardarla. Senza il motivo
//    non si saprebbe se abbia senso farlo.
// ---------------------------------------------------------------------------
function DismissDialog({
  opportunity, onClose, onDone, onError,
}: {
  opportunity: IncentiveOpportunity;
  onClose: () => void; onDone: () => void; onError: (e: unknown) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState<SubsidyDismissalReason>('not_relevant');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await incentivesService.dismiss(opportunity.id, reason, note.trim() || null);
      onDone();
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  }

  return (
    <div className="card mt-12">
      <div className="card-title">{t('incentives.dismiss.title', { program: opportunity.programName })}</div>
      <p className="muted-sm">{t('incentives.dismiss.hint')}</p>
      <div className="field mt-8">
        <label htmlFor="inc-dismiss-reason">{t('incentives.dismiss.reason')}</label>
        <select
          id="inc-dismiss-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as SubsidyDismissalReason)}
        >
          {DISMISSAL_REASONS.map((r) => (
            <option key={r} value={r}>{t(DISMISSAL_KEY[r])}</option>
          ))}
        </select>
      </div>
      <div className="field mt-8">
        <label htmlFor="inc-dismiss-note">{t('incentives.dismiss.note')}</label>
        <textarea
          id="inc-dismiss-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="row-wrap mt-12">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
          {t('incentives.dismiss.confirm')}
        </Button>
        <Button size="sm" onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Il vuoto
//
// ⚠️ UN VUOTO NON È UGUALE A UN ALTRO, e questa è la parte in cui il modulo 1.0
//    sbagliava di più: «nessun programma rilevante» diceva la stessa cosa a chi
//    non aveva progetti, a chi aveva filtrato per «salvate» e a chi non aveva
//    davvero nulla. Le tre situazioni portano a tre gesti diversi.
// ---------------------------------------------------------------------------
function EmptyState({
  view, hasProjects, ready, onGoProjects,
}: { view: OpportunityView; hasProjects: boolean; ready: boolean; onGoProjects: () => void }) {
  const t = useT();

  // ⚠️ Finché i progetti non sono stati letti NON si dice «non hai progetti»:
  // sarebbe una diagnosi basata su un dato che non abbiamo ancora.
  if (!ready) return <SkeletonCard />;

  if (!hasProjects) {
    return (
      <EmptyCta
        icon="banknote"
        title={t('incentives.empty.noProjectTitle')}
        subtitle={t('incentives.empty.noProjectSub')}
        action={
          <button className="btn btn-primary btn-sm" onClick={onGoProjects}>
            <Icon name="plus" className="ic-sm" /> {t('incentives.empty.createProject')}
          </button>
        }
      />
    );
  }

  const KEY: Record<OpportunityView, TKey> = {
    all: 'incentives.empty.all',
    new: 'incentives.empty.new',
    high: 'incentives.empty.high',
    to_verify: 'incentives.empty.toVerify',
    deadline: 'incentives.empty.deadline',
    saved: 'incentives.empty.saved',
    dismissed: 'incentives.empty.dismissed',
  };
  return <EmptyCta icon="banknote" title={t(KEY[view])} subtitle={t('incentives.empty.engineSub')} />;
}
