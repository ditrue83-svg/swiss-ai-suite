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
import { PriorityMark } from '@/components/ui/PriorityMark';
import { Tag } from '@/components/ui/Tag';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonCard, SkeletonKpiGrid } from '@/components/ui/states';
import { useOverview, type OverviewData } from './useOverview';
import { collectPriorities, type PriorityItem } from './overview';
import { RELEVANCE_KEY } from '@/features/incentives/incentivesModel';
import { EligibilityMark } from '@/components/ui/EligibilityMark';
import { daysUntil } from '@/lib/format';
// ⚠️ I giorni di CALENDARIO, non i millisecondi: alle 23:30 una scadenza di
// domani non deve contare come «oggi». È la stessa funzione usata da Attività e
// dal Calendario — tre definizioni di «oggi» sarebbero tre schermate che prima
// o poi si contraddicono.
import { calendarDaysUntil } from '@/features/tasks/taskFormat';
import { useAuth } from '@/contexts/AuthContext';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';

/**
 * Il saluto, con il nome quando lo sappiamo.
 *
 * ⚠️ DUE CHIAVI PER FASCIA E NON UNA CON IL SEGNAPOSTO VUOTO: «Buongiorno, »
 * con la virgola e il vuoto dopo è la forma che si ottiene interpolando un nome
 * che non c'è, e in tedesco e francese la punteggiatura non cade nello stesso
 * posto. Il profilo può mancare — arriva da `profiles`, che è leggibile solo
 * dal proprietario e in una frazione di secondo dopo il login non c'è ancora —
 * e in quel caso si saluta senza nome, che è una frase intera lo stesso.
 */
const GREETING: Record<'morning' | 'afternoon' | 'evening', { plain: TKey; named: TKey }> = {
  morning: { plain: 'home.greetingMorning', named: 'home.greetingMorningNamed' },
  afternoon: { plain: 'home.greetingAfternoon', named: 'home.greetingAfternoonNamed' },
  evening: { plain: 'home.greetingEvening', named: 'home.greetingEveningNamed' },
};

function greetingSlot(): keyof typeof GREETING {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
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

/**
 * La freccia in fondo a una scheda numerica.
 *
 * ⚠️ È un INDIZIO, non un bersaglio: il collegamento è la scheda intera, come
 * nelle righe delle priorità qui sotto. Sta in `aria-hidden` perché il
 * collegamento si annuncia già da sé — etichetta, numero e didascalia sono il
 * suo nome accessibile — e una freccia letta ad alta voce non aggiunge niente.
 */
function KpiGo() {
  return <span className="kpi-go" aria-hidden="true"><Icon name="arrowRight" className="ic-sm" /></span>;
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
        {/* Stessa famiglia della riga di un'attività: la priorità è una
            direzione. Tre pastiglie di tre colori dicevano la stessa cosa a
            colpo d'occhio solo a chi distingue i colori. */}
        <PriorityMark level={it.priority} />
        <span className="action-link" aria-hidden="true"><Icon name="arrowRight" className="ic-sm" /></span>
      </div>
    </Link>
  );
}

function OverviewBody({ data }: { data: OverviewData }) {
  const t = useT();
  const L = useLabels();
  const { tasks, counts, analyses, incentives, documentsToVerify, documentCount } = data;
  // `tasks` sono le attività aperte più urgenti (le prime della lista ordinata
  // dal database), non tutte: per i CONTEGGI si usa `counts`, che il database
  // calcola prima di paginare. Un numero preso dalla lunghezza di un elenco
  // troncato direbbe «20» qualunque sia la realtà.
  const withDate = tasks.filter((task) => task.dueDate);
  // ⚠️ I NUMERI DEGLI INCENTIVI VENGONO DAL MOTORE 2.0 (`subsidy_home_summary`),
  // non più dal matcher 1.0 che girava nel browser. Fino al 2026-07-30 questa
  // schermata diceva «6 incentivi rilevanti» mentre `/incentivi` diceva
  // «nessun progetto, 0 opportunità»: la stessa domanda, due risposte.
  //
  // ⚠️ `incentives` è `null` quando la funzione non risponde, e `null` NON è
  // zero: si mostra «—», perché «non lo sappiamo» e «non ce ne sono» portano a
  // due gesti diversi.
  const highRelevance = incentives?.highRelevance ?? null;
  const newOpportunities = incentives?.newOpportunities ?? null;
  const activeCases = incentives?.openCases ?? null;
  const activeProjects = incentives?.activeProjects ?? null;

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
      {/* ---- I numeri, con una gerarchia DICHIARATA -----------------------
           Cinque schede uguali su una griglia da quattro colonne facevano un
           3+2 con un buco in fondo: una forma che nessuno ha scelto, e cinque
           numeri della stessa misura che non dicono quale guardare per primo.
           Ora ce n'è UNO grande — le attività aperte, che è il conto su cui
           questo prodotto lavora — e tre piccoli accanto.
           ⚠️ Nessun settimo gradino tipografico: la differenza fra --fs-h1 e
           --fs-h2 (30 e 22px) basta a dichiarare la gerarchia, e la scala resta
           di sei gradini come dice docs/design-system.md.

           ⚠️⚠️ OGNI SCHEDA È UN COLLEGAMENTO, e la regola che ne deriva è più
           importante della riga di CSS: un numero senza un elenco che lo spieghi
           NON È UN KPI. Per questo «Azioni da completare» non c'è più — contava
           le voci di checklist dentro le analisi, e nessuna pagina di questo
           prodotto le elenca: sarebbe stata l'unica scheda che non porta da
           nessuna parte. Le voci che contano diventano attività (regola di non
           duplicazione, `overview.ts`), e le attività hanno il loro elenco.

           ⚠️ E la destinazione deve rendere LO STESSO NUMERO, non un elenco
           vagamente imparentato:
             attività aperte      → /attivita             vista «da fare», che è
                                                          la stessa di `counts.open`
             in scadenza oggi     → /calendario           le stesse attività, per data
             documenti da verif.  → ?stato=to_verify      lo stesso filtro che ha
                                                          prodotto il conteggio
             incentivi rilevanti  → ?vista=high           `p_view='high'` è la
                                                          stessa condizione di
                                                          `highRelevance` in SQL
           ---------------------------------------------------------------- */}
      <div className="kpi-lead">
        <Link className="kpi kpi-hero kpi-link" to="/attivita">
          <div className={`kpi-ico ${counts.overdue ? 'warn' : ''}`}><Icon name="clock" className="ic-sm" /></div>
          <div className="kpi-label">{t('dashboard.kpiTasksOpen')}</div>
          <div className={`kpi-value ${counts.overdue ? 'hot' : ''}`}>{counts.open}</div>
          {/* Lo ZERO PROPONE: senza attività aperte le due frasi di sotto
              direbbero «nessuna scaduta», che è vero e non serve a niente —
              descrive l'assenza di un problema dentro un insieme vuoto. */}
          <div className="kpi-sub">
            {counts.open === 0
              ? t('dashboard.kpiTasksNone')
              : (
                <>
                  {counts.overdue
                    ? t(counts.overdue === 1 ? 'dashboard.kpiOverdueOne' : 'dashboard.kpiOverdueMany', { n: counts.overdue })
                    : t('dashboard.kpiNoneOverdue')}
                  {counts.inProgress ? ` · ${t('dashboard.kpiTasksInProgress', { n: counts.inProgress })}` : ''}
                </>
              )}
          </div>
          <KpiGo />
        </Link>
        <div className="kpi-lead-rest">
          {/* §92 — UNA scheda, non una dashboard nuova. «Scadute» c'era già nella
              scheda accanto: qui si aggiunge ciò che mancava, cioè oggi e la
              settimana. I due numeri escono dalle STESSE attività, contate con
              `calendarDaysUntil` — la stessa funzione che usano Attività e il
              Calendario — perché tre definizioni di «oggi» sono tre schermate che
              prima o poi si contraddicono. */}
          <Link className="kpi kpi-sm kpi-link" to="/calendario">
            <div className={`kpi-ico ${dueToday ? 'warn' : ''}`}><Icon name="calendar" className="ic-sm" /></div>
            <div className="kpi-label">{t('dashboard.kpiDueToday')}</div>
            <div className={`kpi-value ${dueToday ? 'hot' : ''}`}>{dueToday}</div>
            {/* A zero non si ripete «Nei prossimi 7 giorni: 0»: si allarga la
                finestra e si dice la cosa quieta che quel numero significa. */}
            <div className="kpi-sub">
              {dueToday === 0 && dueWeek === 0
                ? t('dashboard.kpiDueNone')
                : t('dashboard.kpiDueWeek', { n: dueWeek })}
            </div>
            <KpiGo />
          </Link>
          <Link className="kpi kpi-sm kpi-link" to="/documenti?stato=to_verify">
            <div className={`kpi-ico ${documentsToVerify ? 'amb' : ''}`}><Icon name="fileSearch" className="ic-sm" /></div>
            <div className="kpi-label">{t('dashboard.kpiToVerify')}</div>
            <div className="kpi-value">{documentsToVerify}</div>
            {/* Due zeri diversi: non c'è ancora nessun documento (e allora il
                gesto è portarne uno) oppure ci sono e nessuno chiede una
                verifica. La stessa distinzione già fatta per gli incentivi. */}
            <div className="kpi-sub">
              {documentsToVerify > 0
                ? t('dashboard.kpiToVerifySub')
                : documentCount === 0
                  ? t('dashboard.kpiToVerifyNoDocs')
                  : t('dashboard.kpiToVerifyNone')}
            </div>
            <KpiGo />
          </Link>
          {/* ⚠️ La destinazione SEGUE la frase: quando la frase dice «crea un
              progetto», il collegamento porta ai progetti — non a un elenco di
              opportunità che non esistono ancora. */}
          <Link
            className="kpi kpi-sm kpi-link"
            to={highRelevance === null ? '/incentivi'
              : activeProjects === 0 ? '/incentivi?scheda=progetti'
              : '/incentivi?vista=high'}
          >
            <div className="kpi-ico"><Icon name="star" className="ic-sm" /></div>
            <div className="kpi-label">{t('dashboard.kpiSubsidies')}</div>
            <div className="kpi-value">{highRelevance ?? '—'}</div>
            {/* ⚠️ QUATTRO frasi e non due, perché le situazioni sono quattro e
                portano a gesti diversi: non lo sappiamo · non c'è ancora un
                progetto (e senza progetto il motore non ha una domanda a cui
                rispondere) · c'è un progetto ma nessuna opportunità molto
                rilevante · ci sono opportunità. Un «completa il profilo»
                indistinto le confondeva tutte. */}
            <div className="kpi-sub">
              {highRelevance === null
                ? t('dashboard.kpiSubsidiesUnknown')
                : activeProjects === 0
                  ? t('dashboard.kpiSubsidiesNoProject')
                  : highRelevance === 0
                    ? t('dashboard.kpiSubsidiesNone')
                    : t('dashboard.kpiSubsidiesSub')}
            </div>
            <KpiGo />
          </Link>
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

      {incentives !== null && (highRelevance ?? 0) + (activeCases ?? 0) > 0 && (
        <div className="card mt-16"><div className="card-title">{t('dashboard.subsidiesAndCases')}</div>
          <div className="dash-inc-stats">
            <span className="lang-chip">{highRelevance} <b>{t('dashboard.statRelevant')}</b></span>
            <span className="lang-chip">{newOpportunities} <b>{t('dashboard.statNew')}</b></span>
            <span className="lang-chip">{activeCases} <b>{t('dashboard.statActiveCases')}</b></span>
          </div>
          {data.opportunities.slice(0, 3).map((o) => (
            // ⚠️ NIENTE PUNTEGGIO: la rilevanza è una FASCIA. «82/100» letto da
            // un imprenditore diventa «82% di possibilità di ottenerlo», che è
            // una cosa che questo prodotto non sa — ed è esattamente ciò che
            // questa riga mostrava fino al 2026-07-30.
            // Un solo colore forte per riga: lo prende l'idoneità.
            <div className="list-row" key={o.id}>
              <div className="list-main">
                <div className="list-title">{o.programName}</div>
                <div className="list-sub">
                  {o.authority} · {t(RELEVANCE_KEY[o.relevanceLevel])}
                </div>
              </div>
              {o.programAvailability === 'suspended'
                ? <Tag tone="attention">{t('incentives.catalog.suspended')}</Tag>
                : <EligibilityMark status={o.eligibilityStatus} />}
            </div>
          ))}
          <Link className="btn btn-sm mt-10" to="/incentivi">{t('dashboard.allSubsidies')} <Icon name="arrowRight" className="ic-sm" /></Link>
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
  const { profile } = useAuth();
  const { loading, error, data, reload } = useOverview();

  const slot = GREETING[greetingSlot()];
  const name = profile?.firstName?.trim();

  return (
    <div id="home-body">
      <div className="page-head">
        <div className="greeting">{name ? t(slot.named, { name }) : t(slot.plain)}</div>
        <div className="greeting-sub">{t('home.subtitle')}</div>
      </div>

      {/* ⚠️ DUE SCORCIATOIE, NON CINQUE. «Attività», «Documenti» e «Finanze»
          erano tre pulsanti che portavano dove porta la barra laterale, sempre
          visibile a due centimetri di distanza: una striscia che ripete la
          navigazione insegna che le scorciatoie non servono a niente, e le due
          che invece INIZIANO qualcosa — analizzare un documento, cercare
          incentivi — sparivano in mezzo. */}
      <div className="row-wrap">
        <Link className="btn btn-primary btn-block-mobile" to="/admin"><Icon name="document" className="ic-sm" /> {t('home.analyzeDoc')}</Link>
        <Link className="btn" to="/incentivi"><Icon name="banknote" className="ic-sm" /> {t('home.findSubsidies')}</Link>
      </div>

      <div className="mt-16">
        {loading && <><SkeletonKpiGrid lead /><div className="mt-16"><SkeletonCard /></div></>}
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
