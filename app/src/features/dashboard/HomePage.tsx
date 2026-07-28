// ============================================================================
// PANORAMICA — l'unica schermata d'insieme del prodotto.
//
// ⚠️ FINO AL 2026-07-28 ERANO DUE: «Panoramica» su `/` e «Dashboard» su
// `/dashboard`. Rispondevano alla stessa domanda — che cosa richiede attenzione
// adesso — e calcolavano l'elenco delle priorità con la STESSA funzione
// (`collectPriorities`). La differenza era solo che una mostrava anche i numeri
// e i grafici. Due voci nella barra laterale per due viste dello stesso dato
// costringono chi lavora a chiedersi ogni volta quale delle due aprire, e la
// risposta giusta era «tutte e due».
//
// Ora è una sola: il saluto e le scorciatoie di prima, più i numeri, i grafici
// e le pratiche che stavano nell'altra. `/dashboard` reindirizza qui, perché
// quel collegamento sta negli appunti e nei segnalibri delle persone.
//
// ⚠️ SONO SPARITE ANCHE LE DUE SCHEDE «MODULO 1 / MODULO 2» che comparivano a
// azienda vuota. Presentavano Admin AI e Subsidy AI come se il prodotto ne
// avesse due: i moduli sono sette, e una schermata che ne annuncia due descrive
// un prodotto che non esiste più. Le scorciatoie in cima portano già dove
// portavano quelle schede.
// ============================================================================
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonCard, SkeletonKpiGrid } from '@/components/ui/states';
import { useOverview, type OverviewData } from './useOverview';
import { activeCasesCount, collectPriorities, type PriorityItem } from './overview';
import { daysUntil } from '@/lib/format';
// ⚠️ I giorni di CALENDARIO, non i millisecondi: alle 23:30 una scadenza di
// domani non deve contare come «oggi». È la stessa funzione usata da Attività e
// dal Calendario — tre definizioni di «oggi» sarebbero tre schermate che prima
// o poi si contraddicono.
import { calendarDaysUntil } from '@/features/tasks/taskFormat';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';

function greetingKey(): 'home.greetingMorning' | 'home.greetingAfternoon' | 'home.greetingEvening' {
  const h = new Date().getHours();
  if (h < 12) return 'home.greetingMorning';
  if (h < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

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

function PriorityRow({ it }: { it: PriorityItem }) {
  const L = useLabels();
  // Il collegamento è la riga, non la freccia: su un portatile con trackpad
  // centrare un bersaglio di 16 pixel è una prova di mira. La freccia resta
  // come indizio di dove si va.
  return (
    <Link className="action-row is-link" to={it.to} aria-label={`${it.title} — ${it.cta}`}>
      <div className={`action-ico p-${it.priority}`}><Icon name={it.icon} className="ic-sm" /></div>
      <div className="action-main">
        <div className="action-title">{it.title}</div>
        <div className="action-sub">{it.sub}</div>
      </div>
      <div className="action-meta">
        <span className={`badge badge-${it.priority}`}>{L.urgency(it.priority)}</span>
        <span className="action-link" aria-hidden="true"><Icon name="arrowRight" className="ic-sm" /></span>
      </div>
    </Link>
  );
}

function OverviewBody({ data }: { data: OverviewData }) {
  const t = useT();
  const L = useLabels();
  const { tasks, counts, analyses, matches, cases } = data;
  // `tasks` sono le attività aperte più urgenti (le prime della lista ordinata
  // dal database), non tutte: per i CONTEGGI si usa `counts`, che il database
  // calcola prima di paginare. Un numero preso dalla lunghezza di un elenco
  // troncato direbbe «20» qualunque sia la realtà.
  const withDate = tasks.filter((task) => task.dueDate);

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
  withDate.forEach((task) => {
    const d = daysUntil(task.dueDate) ?? 0;
    if (d < 0) horizon.overdue++; else if (d <= 30) horizon.d30++; else if (d <= 90) horizon.d90++; else horizon.beyond++;
  });

  // Oggi e i prossimi sette giorni, contati sulle attività già caricate. Nessuna
  // interrogazione in più: `data.tasks` sono le attività da fare, ordinate dal
  // database, ed è esattamente l'insieme su cui la domanda ha senso.
  const dueToday = tasks.filter((task) => calendarDaysUntil(task.dueDate) === 0).length;
  const dueWeek = tasks.filter((task) => {
    const d = calendarDaysUntil(task.dueDate);
    return d != null && d >= 0 && d <= 7;
  }).length;

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
        {/* §92 — UNA scheda, non una dashboard nuova. «Scadute» c'era già nella
            scheda accanto: qui si aggiunge ciò che mancava, cioè oggi e la
            settimana. I due numeri escono dalle STESSE attività, contate con
            `calendarDaysUntil` — la stessa funzione che usano Attività e il
            Calendario — perché tre definizioni di «oggi» sono tre schermate che
            prima o poi si contraddicono. */}
        <Link className="kpi kpi-link" to="/calendario">
          <div className={`kpi-ico ${dueToday ? 'warn' : ''}`}><Icon name="calendar" className="ic-sm" /></div>
          <div className="kpi-label">{t('dashboard.kpiDueToday')}</div>
          <div className={`kpi-value ${dueToday ? 'hot' : ''}`}>{dueToday}</div>
          <div className="kpi-sub">{t('dashboard.kpiDueWeek', { n: dueWeek })}</div>
        </Link>
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
        <div className="muted-sm dash-sorted">{t('dashboard.sortedByPriority')}</div>
        {priorities.length === 0 ? (
          <div className="priority-empty"><Icon name="checkCircle" /><div>{t('dashboard.allDone')}</div></div>
        ) : priorities.map((it, i) => <PriorityRow key={i} it={it} />)}
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

export function HomePage() {
  const t = useT();
  const { loading, error, data, reload } = useOverview();

  return (
    <div id="home-body">
      <div className="page-head">
        <div className="greeting">{t(greetingKey())}</div>
        <div className="greeting-sub">{t('home.subtitle')}</div>
      </div>

      <div className="row-wrap">
        <Link className="btn btn-primary btn-block-mobile" to="/admin"><Icon name="document" className="ic-sm" /> {t('home.analyzeDoc')}</Link>
        <Link className="btn" to="/subsidy"><Icon name="banknote" className="ic-sm" /> {t('home.findSubsidies')}</Link>
        <Link className="btn btn-ghost" to="/attivita"><Icon name="calendar" className="ic-sm" /> {t('nav.tasks')}</Link>
        <Link className="btn btn-ghost" to="/documenti"><Icon name="archive" className="ic-sm" /> {t('nav.documents')}</Link>
        <Link className="btn btn-ghost" to="/finanze"><Icon name="receipt" className="ic-sm" /> {t('nav.finance')}</Link>
      </div>

      <div className="mt-16">
        {loading && <><SkeletonKpiGrid /><div className="mt-16"><SkeletonCard /></div></>}
        {/* Il guasto viene PRIMA di qualunque interpretazione: senza questo ramo
            una panoramica che non ha potuto leggere niente sembrerebbe una
            panoramica senza niente da fare. */}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && data && <OverviewBody data={data} />}
      </div>

      <div className="footnote">{t('legal.disclaimer')}</div>
    </div>
  );
}
