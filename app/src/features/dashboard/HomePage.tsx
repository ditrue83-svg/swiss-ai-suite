// ============================================================================
// HomePage — la Panoramica, disegnata DAI NUMERI (censimento 2026-08-19).
//
// Non è il cruscotto di un'azienda operativa: è la schermata di un'azienda i
// cui 19 documenti sono tutti archiviati, con 16 analisi non conclusive, zero
// termini dichiarati e una valutazione incentivi mai eseguita. Il compito non
// è «mostrarti il tuo lavoro»: è dire cosa il sistema sa, cosa non ha potuto
// concludere e cosa non ha mai provato a fare.
//
// LA FORMA: quattro blocchi in quest'ordine — decisioni, lavoro, limiti del
// sistema, opportunità. Le decisioni per prime perché SBLOCCANO il resto:
// il gate delle attività (`canCreateTask`) dipende letteralmente da loro.
// I blocchi compaiono solo con contenuto: è un elenco di cose da fare, non
// una griglia fissa da riempire. La visibilità la decide `overviewBlocks`,
// che è puro e provato.
//
// COSA NON C'È, DI PROPOSITO:
//   · nessun grafico — non esiste una serie storica, e un grafico su quattro
//     numeri è decorazione;
//   · nessuna percentuale di completamento su zero elementi;
//   · nessun blocco scadenze — zero `term` in produzione: le date di natura
//     non registrata sono una riga che le chiama col loro nome;
//   · nessun elenco piatto per data — 6 delle prime 10 voci erano la stessa
//     email di Stripe: ogni blocco mostra conteggio, esempio più recente e
//     collegamento all'elenco già filtrato;
//   · nessun punteggio composito — con la gravità satura su 16 documenti su
//     19, qualunque punteggio sarebbe inventato e vestito da intelligenza;
//   · nessun pulsante «Avvia la verifica» — `subsidy-worker` è invocabile solo
//     dallo scheduler col suo segreto e il matching parte dai progetti:
//     l'azione vera è descrivere un progetto, e il blocco porta lì.
//
// UN SOLO INSIEME: ogni conteggio copre TUTTI i documenti, archiviati
// compresi, e il piè di pagina lo dichiara una volta per tutta la pagina.
// I collegamenti portano a `list_documents`, che mostra una popolazione alla
// volta: perciò i blocchi elencano una riga PER POPOLAZIONE, ognuna col suo
// numero e la sua destinazione — il numero del blocco e quello della pagina
// d'arrivo non possono divergere.
// ============================================================================
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { useOverview, type OverviewData } from './useOverview';
import { decidiBlocchi, statoValutazione } from './overviewBlocks';
import { formatDate, formatDateTime } from '@/lib/format';
import { documentLabelText } from '@/i18n/documentLabel';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useT, type TKey } from '@/i18n';
import type { DocumentHubItem } from '@/types/models';

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

/** L'esempio di un blocco: la voce più recente, col nome deciso dalla regola
 *  del titolo (`label`) — la prima riga di questa pagina è già stata «2.5». */
function Esempio({ item }: { item: DocumentHubItem | null }) {
  const t = useT();
  if (!item) return null;
  return (
    <div className="muted-sm ov-example">
      {t('home.latestExample', { title: documentLabelText(item.label) })}
    </div>
  );
}

/**
 * Una riga di conteggio che è anche il collegamento alla pagina che rende LO
 * STESSO numero. `count` è già stato verificato > 0 da chi chiama.
 */
function RigaConteggio({ count, one, many, dove, to }: {
  count: number; one: TKey; many: TKey; dove: TKey; to: string;
}) {
  const t = useT();
  return (
    <div className="ov-line">
      <Link to={to}>{t(count === 1 ? one : many, { n: count, dove: t(dove) })}</Link>
    </div>
  );
}

function BloccoDecisioni({ data }: { data: OverviewData }) {
  const t = useT();
  const ownership = data.ownership as { count: number; latest: DocumentHubItem | null };
  return (
    <section className="card mt-16 ov-block" aria-labelledby="ov-decisioni">
      <h2 className="card-title" id="ov-decisioni">{t('home.blockDecisions')}</h2>
      <div className="ov-line">
        {ownership.count === 1
          ? t('home.ownershipOne')
          : t('home.ownershipMany', { n: ownership.count })}
      </div>
      <Esempio item={ownership.latest} />
      {/* Il perché queste vengono PRIME: il gate delle attività dipende da loro. */}
      <div className="muted-sm">
        {t(ownership.count === 1 ? 'home.ownershipGateOne' : 'home.ownershipGateMany')}
      </div>
      <Link className="btn btn-sm mt-10" to="/documenti?appartenenza=1">
        {t('home.openList')} <Icon name="arrowRight" className="ic-sm" />
      </Link>
    </section>
  );
}

function BloccoDaFare({ data }: { data: OverviewData }) {
  const t = useT();
  const s = data.tasks;
  // Le parti della riga, nell'ordine della bozza: ciò che esiste prima, poi le
  // due dichiarazioni che pesano anche da zero — «nessun termine» e «nessuno
  // scaduto» sono affermazioni, non assenze (regola 2 del brief).
  const parti: string[] = [];
  if (s.appuntamenti > 0) {
    parti.push(t(s.appuntamenti === 1 ? 'home.tasksApptsOne' : 'home.tasksApptsMany', { n: s.appuntamenti }));
  }
  parti.push(
    s.termini === 0 ? t('home.tasksTermsNone')
      : t(s.termini === 1 ? 'home.tasksTermsOne' : 'home.tasksTermsMany', { n: s.termini }),
  );
  if (s.senzaData > 0) {
    parti.push(t(s.senzaData === 1 ? 'home.tasksNoDateOne' : 'home.tasksNoDateMany', { n: s.senzaData }));
  }
  parti.push(
    s.scadute === 0 ? t('home.tasksOverdueNone')
      : t(s.scadute === 1 ? 'home.tasksOverdueOne' : 'home.tasksOverdueMany', { n: s.scadute }),
  );

  const primoData = s.primo ? (s.primo.dueDate ?? s.primo.appointmentDate) : null;
  return (
    <section className="card mt-16 ov-block" aria-labelledby="ov-dafare">
      <h2 className="card-title" id="ov-dafare">{t('home.blockToDo')}</h2>
      {s.aperte > 0 && <div className="ov-line">{parti.join(' · ')}</div>}
      {/* Il diviso può essere parziale (tetto dichiarato): la frase lo dice,
          con i due numeri — quante lette e quante sono. */}
      {s.parziale && <div className="muted-sm">{t('home.tasksSplitPartial', { n: s.lette, tot: s.aperte })}</div>}
      {s.primo && (
        <div className="muted-sm ov-example">
          {primoData
            ? t('home.firstItem', { title: s.primo.title, date: formatDate(primoData) })
            : t('home.firstItemNoDate', { title: s.primo.title })}
        </div>
      )}
      {/* Le date dei documenti, chiamate col loro nome: finché non esiste un
          `term`, un blocco scadenze sarebbe due date incerte vestite da
          termini. Zero term in tutta la produzione, misurato il 2026-08-19. */}
      {data.nature.totale > 0 && (
        <div className="ov-line">
          {data.nature.termini === 0
            ? t(data.nature.totale === 1 ? 'home.datesNoTermOne' : 'home.datesNoTermMany', { n: data.nature.totale })
            : t('home.datesMixed', {
              n: data.nature.totale, t: data.nature.termini,
              e: data.nature.nonObbliganti, r: data.nature.nonRegistrate,
            })}
        </div>
      )}
      {s.aperte > 0 && (
        <Link className="btn btn-sm mt-10" to="/attivita">
          {t('home.ctaTasks')} <Icon name="arrowRight" className="ic-sm" />
        </Link>
      )}
    </section>
  );
}

function BloccoSistema({ data }: { data: OverviewData }) {
  const t = useT();
  const { daVerificare, fallite, maiAnalizzati } = data;
  // L'esempio del blocco è la voce più recente fra le categorie presenti.
  const esempio = [daVerificare.esempio, fallite.esempio, maiAnalizzati.esempio]
    .filter((x): x is DocumentHubItem => x !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  return (
    <section className="card mt-16 ov-block" aria-labelledby="ov-sistema">
      <h2 className="card-title" id="ov-sistema">{t('home.blockSystem')}</h2>
      {fallite.attivi > 0 && (
        <RigaConteggio count={fallite.attivi} one="home.sysFailedOne" many="home.sysFailedMany"
          dove="home.popActive" to="/documenti?stato=failed" />
      )}
      {fallite.archiviati > 0 && (
        <RigaConteggio count={fallite.archiviati} one="home.sysFailedOne" many="home.sysFailedMany"
          dove="home.popArchived" to="/documenti?stato=failed&archiviati=1" />
      )}
      {daVerificare.attivi > 0 && (
        <RigaConteggio count={daVerificare.attivi} one="home.sysToVerifyOne" many="home.sysToVerifyMany"
          dove="home.popActive" to="/documenti?stato=to_verify" />
      )}
      {daVerificare.archiviati > 0 && (
        <RigaConteggio count={daVerificare.archiviati} one="home.sysToVerifyOne" many="home.sysToVerifyMany"
          dove="home.popArchived" to="/documenti?stato=to_verify&archiviati=1" />
      )}
      {maiAnalizzati.attivi > 0 && (
        <RigaConteggio count={maiAnalizzati.attivi} one="home.sysNeverOne" many="home.sysNeverMany"
          dove="home.popActive" to="/documenti?stato=none" />
      )}
      {maiAnalizzati.archiviati > 0 && (
        <RigaConteggio count={maiAnalizzati.archiviati} one="home.sysNeverOne" many="home.sysNeverMany"
          dove="home.popArchived" to="/documenti?stato=none&archiviati=1" />
      )}
      <Esempio item={esempio} />
    </section>
  );
}

function BloccoOpportunita({ data, companyName }: { data: OverviewData; companyName: string }) {
  const t = useT();
  const { catalogo, assessments, summary } = data.incentivi;
  const stato = statoValutazione(assessments);
  return (
    <section className="card mt-16 ov-block" aria-labelledby="ov-opportunita">
      <h2 className="card-title" id="ov-opportunita">{t('home.blockOpportunities')}</h2>
      <div className="ov-line">
        {catalogo === null
          ? t('home.catalogUnreadable')
          : catalogo.verified === catalogo.programs
            ? t(catalogo.programs === 1 ? 'home.catalogAllVerifiedOne' : 'home.catalogAllVerifiedMany', { n: catalogo.programs })
            : t('home.catalogSomeVerified', { n: catalogo.programs, v: catalogo.verified })}
      </div>
      {stato === 'mai-eseguita' && (
        <>
          <div className="ov-line">{t('home.assessNever', { company: companyName })}</div>
          <Link className="btn btn-sm mt-10" to="/incentivi?scheda=progetti">
            {t('home.describeProject')} <Icon name="arrowRight" className="ic-sm" />
          </Link>
        </>
      )}
      {stato === 'non-misurabile' && (
        <div className="muted-sm">{t('home.assessUnknown')}</div>
      )}
      {stato === 'eseguita' && (
        <>
          {summary === null
            ? <div className="muted-sm">{t('home.summaryUnknown')}</div>
            : (
              <div className="ov-line">
                {t('home.assessStats', {
                  relevant: summary.highRelevance, fresh: summary.newOpportunities,
                  cases: summary.openCases, projects: summary.activeProjects,
                })}
              </div>
            )}
          <Link className="btn btn-sm mt-10" to="/incentivi">
            {t('home.ctaSubsidies')} <Icon name="arrowRight" className="ic-sm" />
          </Link>
        </>
      )}
    </section>
  );
}

function OverviewBody({ data, companyName }: { data: OverviewData; companyName: string }) {
  const t = useT();
  const blocchi = decidiBlocchi({
    ownership: data.ownership?.count ?? null,
    aperte: data.tasks.aperte,
    dateRilevate: data.nature.totale,
    daVerificare: data.daVerificare.attivi + data.daVerificare.archiviati,
    fallite: data.fallite.attivi + data.fallite.archiviati,
    maiAnalizzati: data.maiAnalizzati.attivi + data.maiAnalizzati.archiviati,
    programmiInCatalogo: data.incentivi.catalogo?.programs ?? 0,
    openCases: data.incentivi.summary?.openCases ?? 0,
    activeProjects: data.incentivi.summary?.activeProjects ?? 0,
  });

  return (
    <>
      {blocchi.decisioni && <BloccoDecisioni data={data} />}
      {blocchi.daFare && <BloccoDaFare data={data} />}
      {blocchi.sistema && <BloccoSistema data={data} />}

      {/* LO STATO DAVVERO VUOTO non dice «tutto a posto»: dice cosa è stato
          controllato. Uno zero senza il suo insieme è indistinguibile da «non
          ho guardato» — è la domanda 1 del censimento, risolta dichiarando. */}
      {blocchi.vuotoOperativo && (
        <section className="card mt-16 ov-block" aria-labelledby="ov-vuoto">
          <h2 className="card-title" id="ov-vuoto">{t('home.emptyTitle')}</h2>
          <div className="ov-line">
            {t('home.emptyChecked', {
              docs: data.documenti.attivi + data.documenti.archiviati,
              tasks: data.tasks.aperte,
            })}
          </div>
        </section>
      )}

      {blocchi.opportunita && <BloccoOpportunita data={data} companyName={companyName} />}

      {/* UNA VOLTA, PER TUTTA LA PAGINA: l'insieme e il quando. Ogni numero qui
          sopra conta anche gli archiviati — è la dichiarazione che mancava
          quando «da verificare: 0» e «appartenenza: 7» convivevano contando
          due universi diversi. */}
      <div className="footnote" role="contentinfo">
        {t('home.footPopulation')}{' '}
        {t('home.footUpdated', { time: formatDateTime(data.loadedAt) })}
      </div>
    </>
  );
}

export function HomePage() {
  const t = useT();
  const { profile } = useAuth();
  const { activeCompany } = useCompany();
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
        {/* Lo scheletro somiglia a ciò che arriva: blocchi, non una griglia
            di KPI che questa pagina non ha più. */}
        {loading && <><SkeletonCard /><div className="mt-16"><SkeletonCard /></div></>}
        {/* Il guasto viene PRIMA di qualunque interpretazione: senza questo ramo
            una panoramica che non ha potuto leggere niente sembrerebbe una
            panoramica senza niente da fare. */}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && data && (
          <OverviewBody data={data} companyName={activeCompany?.legalName ?? ''} />
        )}
      </div>

      <div className="footnote">{t('legal.disclaimer')}</div>
    </div>
  );
}
