// Dashboard alimentata da Supabase (documenti, scadenze, incentivi, pratiche).
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonKpiGrid, SkeletonCard } from '@/components/ui/states';
import { useOverview, type OverviewData } from './useOverview';
import { collectPriorities, activeCasesCount } from './overview';
import { daysUntil } from '@/lib/format';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';

interface BarRow { cat: string; val: number; cls?: string; dotCls?: string }

/**
 * Barre orizzontali. La lunghezza è la QUOTA SUL TOTALE della serie, non sul
 * valore più alto: normalizzando sul massimo, un solo documento riempiva la
 * barra fino in fondo e sembrava «tanto». Con il totale al denominatore la
 * lunghezza dice qualcosa di vero — quanta parte dell'insieme sta in questa
 * riga — e il numero accanto resta il dato esatto.
 */
function Bars({ rows }: { rows: BarRow[] }) {
  const total = rows.reduce((n, r) => n + r.val, 0);
  return (
    <>
      {rows.map((r) => (
        <div className="bar-row" key={r.cat}>
          <div className="bar-cat">{r.dotCls && <span className={`bar-dot ${r.dotCls}`} />}{r.cat}</div>
          <div className="bar-track">
            {/* A zero non si disegna nulla: una barra minima mostrerebbe una
                quantità che non c'è. */}
            {r.val > 0 && <div className={`bar-fill ${r.cls ?? ''}`} style={{ width: `${Math.round((r.val / total) * 100)}%` }} />}
          </div>
          <div className="bar-val">{r.val}</div>
        </div>
      ))}
    </>
  );
}

function DashboardBody({ data }: { data: OverviewData }) {
  const t = useT();
  const L = useLabels();
  const { tasks, counts, analyses, matches, cases } = data;
  // `tasks` sono le attività aperte più urgenti (le prime della lista ordinata
  // dal database), non tutte: per i CONTEGGI si usa `counts`, che il database
  // calcola prima di paginare. Un numero preso dalla lunghezza di un elenco
  // troncato direbbe «20» qualunque sia la realtà.
  const withDate = tasks.filter((t) => t.dueDate);

  let openActions = 0;
  analyses.forEach((a) => { openActions += a.actions.filter((c) => !c.done).length; });
  const docsWithOpen = analyses.filter((a) => a.actions.some((c) => !c.done)).length;
  const toVerify = analyses.filter((a) => a.confidence !== 'alta' || a.senderUncertain);
  const relevantCount = matches.length;
  // 0011 — «idoneità da verificare» conta solo ciò che si può davvero ottenere:
  // per un programma sospeso non c'è nessuna idoneità da verificare.
  const verifiableCount = matches.filter((m) => m.program.availability !== 'suspended').length;
  const activeCases = activeCasesCount(cases);

  let totChecks = 0, doneChecks = 0;
  analyses.forEach((a) => a.actions.forEach((c) => { totChecks++; if (c.done) doneChecks++; }));
  const compPct = totChecks ? Math.round((doneChecks / totChecks) * 100) : 0;

  const urg = { alta: 0, media: 0, bassa: 0 };
  const langCount: Record<string, number> = {};
  const tipoCount: Record<string, number> = {};
  analyses.forEach((a) => {
    urg[a.urgency]++;
    langCount[a.languageLabel] = (langCount[a.languageLabel] || 0) + 1;
    // L'etichetta del tipo passa dalle etichette tradotte: la mappa di
    // abbreviazioni italiane che stava qui restava italiana in de e fr.
    const k = a.documentType ? L.docType(a.documentType) : a.documentTypeLabel;
    tipoCount[k] = (tipoCount[k] || 0) + 1;
  });
  const tipoRows = Object.entries(tipoCount).sort((a, b) => b[1] - a[1]).map(([cat, val]) => ({ cat, val }));

  // Le fasce restano chiavi tecniche e diventano etichette solo al render:
  // prima erano stringhe italiane usate sia come chiave sia come testo, e in
  // tedesco il grafico mostrava «Entro 30 gg».
  const horizon = { overdue: 0, d30: 0, d90: 0, beyond: 0 };
  withDate.forEach((t) => {
    const d = daysUntil(t.dueDate) ?? 0;
    if (d < 0) horizon.overdue++; else if (d <= 30) horizon.d30++; else if (d <= 90) horizon.d90++; else horizon.beyond++;
  });

  const priorities = collectPriorities(data).slice(0, 8);

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-ico ok"><Icon name="checkCircle" className="ic-sm" /></div>
          <div className="kpi-label">{t('dashboard.kpiOpenActions')}</div>
          <div className="kpi-value">{openActions}</div>
          <div className="kpi-sub">{t(docsWithOpen === 1 ? 'dashboard.kpiOpenActionsDocsOne' : 'dashboard.kpiOpenActionsDocsMany', { n: docsWithOpen })}</div>
        </div>
        <div className="kpi">
          <div className={`kpi-ico ${counts.overdue ? 'warn' : ''}`}><Icon name="clock" className="ic-sm" /></div>
          <div className="kpi-label">{t('dashboard.kpiTasksOpen')}</div>
          <div className={`kpi-value ${counts.overdue ? 'hot' : ''}`}>{counts.open}</div>
          <div className="kpi-sub">
            {counts.overdue
              ? t(counts.overdue === 1 ? 'dashboard.kpiOverdueOne' : 'dashboard.kpiOverdueMany', { n: counts.overdue })
              : t('dashboard.kpiNoneOverdue')}
            {counts.inProgress ? ` · ${t('dashboard.kpiTasksInProgress', { n: counts.inProgress })}` : ''}
          </div>
        </div>
        <div className="kpi">
          <div className={`kpi-ico ${toVerify.length ? 'amb' : ''}`}><Icon name="fileSearch" className="ic-sm" /></div>
          <div className="kpi-label">{t('dashboard.kpiToVerify')}</div>
          <div className="kpi-value">{toVerify.length}</div>
          <div className="kpi-sub">{t('dashboard.kpiToVerifySub')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-ico"><Icon name="star" className="ic-sm" /></div>
          <div className="kpi-label">{t('dashboard.kpiSubsidies')}</div>
          <div className="kpi-value">{relevantCount}</div>
          <div className="kpi-sub">{relevantCount ? t('dashboard.kpiSubsidiesSub') : t('dashboard.kpiSubsidiesNone')}</div>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-title">{t('dashboard.nextActions')}</div>
        <div className="muted-sm" style={{ marginTop: '-6px', marginBottom: '8px' }}>{t('dashboard.sortedByPriority')}</div>
        {priorities.length === 0 ? (
          <div className="priority-empty"><Icon name="checkCircle" /><div>{t('dashboard.allDone')}</div></div>
        ) : priorities.map((it, i) => (
          // La riga intera è il collegamento: il bersaglio non è la freccia di
          // 16 pixel in fondo. La freccia resta come indizio di dove si va.
          <Link className="action-row is-link" to={it.to} key={i} aria-label={`${it.title} — ${it.cta}`}>
            <div className={`action-ico p-${it.priority}`}><Icon name={it.icon} className="ic-sm" /></div>
            <div className="action-main"><div className="action-title">{it.title}</div><div className="action-sub">{it.sub}</div></div>
            <div className="action-meta"><span className={`badge badge-${it.priority}`}>{L.urgency(it.priority)}</span>
              <span className="action-link" aria-hidden="true"><Icon name="arrowRight" className="ic-sm" /></span></div>
          </Link>
        ))}
      </div>

      <div className="grid-2 mt-16">
        <div className="card"><div className="card-title">{t('dashboard.upcomingDeadlines')}</div>
          {withDate.length === 0 ? <div className="chart-empty">{t('dashboard.noDatedDeadlines')}</div> : (
            <Bars rows={[
              { cat: t('dashboard.horizonOverdue'), val: horizon.overdue, cls: horizon.overdue > 0 ? 's-alta' : '' },
              { cat: t('dashboard.horizon30'), val: horizon.d30 },
              { cat: t('dashboard.horizon90'), val: horizon.d90 },
              { cat: t('dashboard.horizonBeyond'), val: horizon.beyond },
            ]} />
          )}
        </div>
        <div className="card"><div className="card-title">{t('dashboard.completion')}</div>
          {totChecks === 0 ? <div className="chart-empty">{t('dashboard.noChecklist')}</div> : (
            <>
              <div className="meter"><div className="meter-num">{compPct}%</div>
                <div className="meter-track"><div className="meter-fill" style={{ width: `${compPct}%` }} /></div></div>
              <div className="kpi-sub mt-10">{t('dashboard.completionSub', { done: doneChecks, total: totChecks })}</div>
            </>
          )}
        </div>
      </div>

      {relevantCount > 0 && (
        <div className="card mt-16"><div className="card-title">{t('dashboard.subsidiesAndCases')}</div>
          <div className="dash-inc-stats">
            <span className="lang-chip">{relevantCount} <b>{t('dashboard.statRelevant')}</b></span>
            <span className="lang-chip">{verifiableCount} <b>{t('dashboard.statEligibility')}</b></span>
            <span className="lang-chip">{activeCases} <b>{t('dashboard.statActiveCases')}</b></span>
          </div>
          {matches.slice(0, 3).map((m) => {
            // 0011 — su un programma sospeso non si mostra né «prima di agire»
            // né «idoneità da verificare»: sarebbero due inviti ad agire su
            // qualcosa che oggi non viene concesso.
            const suspended = m.program.availability === 'suspended';
            return (
              // Due pastiglie al massimo, e un solo colore forte per riga: la
              // rilevanza è un numero informativo, non uno stato, e stava a
              // fianco di due avvisi con lo stesso peso visivo.
              <div className="list-row" key={m.program.id}>
                <div className="list-main">
                  <div className="list-title">{m.program.name}</div>
                  <div className="list-sub">{m.program.authority} · {t('dashboard.relevance', { n: m.relevanceScore })}</div>
                </div>
                {!suspended && m.program.mustApplyBeforeStart && <span className="badge badge-media">{t('dashboard.applyBefore')}</span>}
                {suspended
                  ? <span className="badge badge-alta">{t('subsidy.results.suspended')}</span>
                  : <span className="badge badge-neutral">{t('dashboard.eligibilityToVerify')}</span>}
              </div>
            );
          })}
          <Link className="btn btn-sm mt-10" to="/subsidy">{t('dashboard.allSubsidies')} <Icon name="arrowRight" className="ic-sm" /></Link>
        </div>
      )}

      <div className="section-title mt-28">{t('dashboard.docStats')}</div>
      <div className="grid-2">
        <div className="card"><div className="card-title">{t('dashboard.docsByUrgency')}</div>
          {analyses.length === 0 ? <div className="chart-empty">{t('dashboard.noDocsAnalyzed')}</div> : (
            <Bars rows={[
              { cat: L.urgency('alta'), val: urg.alta, cls: 's-alta', dotCls: 'dot-alta' },
              { cat: L.urgency('media'), val: urg.media, cls: 's-media', dotCls: 'dot-media' },
              { cat: L.urgency('bassa'), val: urg.bassa, cls: 's-bassa', dotCls: 'dot-bassa' },
            ]} />
          )}
        </div>
        <div className="card"><div className="card-title">{t('dashboard.docsByType')}</div>
          {tipoRows.length === 0 ? <div className="chart-empty">{t('dashboard.noDocsAnalyzed')}</div> : <Bars rows={tipoRows} />}
        </div>
      </div>
      {analyses.length > 0 && (
        <div className="card mt-16 lang-card"><span className="lang-title">{t('dashboard.docLanguages')}</span>
          {Object.entries(langCount).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
            <span className="lang-chip" key={cat}>{cat} <b>{val}</b></span>
          ))}
        </div>
      )}
    </>
  );
}

export function DashboardPage() {
  const t = useT();
  const { loading, error, data, reload } = useOverview();
  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('nav.dashboard')}</div>
        <div className="page-desc">{t('dashboard.subtitle')}</div>
      </div>
      {loading && <><SkeletonKpiGrid /><div className="mt-16"><SkeletonCard /></div></>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && data && <DashboardBody data={data} />}
    </>
  );
}
