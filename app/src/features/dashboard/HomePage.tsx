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
import {
  chiaviTaskSplit, decidiBlocchi, fraseCatalogo, rigaNature, statoValutazione, termini,
} from './overviewBlocks';
import { formatDate, formatDateTime } from '@/lib/format';
import { documentLabelText } from '@/i18n/documentLabel';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useT, useTn, type PluralBase, type TKey } from '@/i18n';
import type { DataDocumentoRiga } from '@/services/documentHubService';
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
 * STESSO numero.
 *
 * ⚠️ LA FORMA SINGOLARE/PLURALE LA SCEGLIE LA LINGUA, non un `=== 1` scritto
 * qui: in francese lo ZERO vuole il singolare, in italiano e in tedesco il
 * plurale. `tn` passa da `Intl.PluralRules` e mette dentro `{n}` da sé.
 */
function RigaConteggio({ count, base, dove, to }: {
  count: number; base: PluralBase; dove: TKey; to: string;
}) {
  const t = useT();
  const tn = useTn();
  return (
    <div className="ov-line">
      <Link to={to}>{tn(base, count, { dove: t(dove) })}</Link>
    </div>
  );
}

/**
 * ⚠️⚠️ IL BLOCCO RESTA A SCHERMO ANCHE QUANDO NON HA POTUTO LEGGERE I SUOI
 * DATI, e lo dice. Prima l'appartenenza non leggibile faceva sparire questo
 * blocco mentre il catalogo non leggibile ne accendeva un altro che lo
 * dichiarava: due risposte opposte allo stesso guasto sulla stessa pagina. Un
 * blocco che sparisce quando è rotto è indistinguibile da un blocco vuoto
 * perché non c'è niente da fare — che è la stessa confusione fra «non ho
 * guardato» e «non c'è niente» che questa pagina combatte dappertutto.
 *
 * Il conteggio, però, resta NON INVENTATO: nel ramo del guasto non c'è nessun
 * numero, c'è la frase che dice che il controllo non è stato eseguito.
 */
function BloccoDecisioni({ data }: { data: OverviewData }) {
  const t = useT();
  const tn = useTn();
  const ownership = data.ownership;
  return (
    <section className="card mt-16 ov-block" aria-labelledby="ov-decisioni">
      <h2 className="card-title" id="ov-decisioni">{t('home.blockDecisions')}</h2>
      {ownership === null ? (
        <div className="muted-sm">{t('home.ownershipUnknown')}</div>
      ) : (
        <>
          <div className="ov-line">{tn('home.ownership', ownership.count)}</div>
          {/* Il tetto di lettura si dichiara COL NUMERO, come già si fa per le
              attività e come fa la pagina d'arrivo: un conteggio finestrato
              presentato come un fatto è la bugia che questa pagina combatte. */}
          {ownership.parziale && <div className="muted-sm">{t('home.ownershipPartial')}</div>}
          <Esempio item={ownership.latest} />
          {/* Il perché queste vengono PRIME: il gate delle attività dipende da loro. */}
          <div className="muted-sm">{tn('home.ownershipGate', ownership.count)}</div>
          <Link className="btn btn-sm mt-10" to="/documenti?appartenenza=1">
            {t('home.openList')} <Icon name="arrowRight" className="ic-sm" />
          </Link>
        </>
      )}
    </section>
  );
}

/**
 * UN TERMINE È UNA VOCE: giorno, che cosa riguarda, e come arrivarci.
 *
 * ⚠️⚠️ PERCHÉ NON UN CONTEGGIO. «3 date nei documenti: 1 termini, 1 che non
 * obbligano l'azienda, 1 di natura non registrata» era il censimento delle
 * nature di un archivio. Chi ha un termine vero non vuole sapere quante
 * nature esistono: vuole vedere QUELLA data, che cosa riguarda, e arrivarci.
 * Il collegamento porta al DOCUMENTO — non a un elenco filtrato — perciò non
 * c'è nessun numero da far coincidere con una destinazione.
 *
 * ⚠️ IL NOME PASSA DALLA REGOLA DEL TITOLO (`label`), come ovunque: la prima
 * riga di questa pagina è già stata «2.5» una volta.
 *
 * ⚠️ E L'ELENCO NON SI DICHIARA COMPLETO SE NON LO È: con la lettura al tetto
 * un termine può stare fra le date non guardate, e la riga sotto lo dice — la
 * stessa affermazione-che-poteva-essere-falsa già corretta per la negazione.
 */
function VociTermini({ conto, titolo }: {
  conto: ReturnType<typeof termini<DataDocumentoRiga>>; titolo: boolean;
}) {
  const t = useT();
  const tn = useTn();
  const { voci, altri, parziale, lette, totaleDate } = conto;
  if (voci.length === 0) return null;
  return (
    <>
      {titolo && <div className="muted-sm ov-terms-head">{t('home.termsFromDocs')}</div>}
      {voci.map((v) => (
        <div className="ov-line ov-term" key={v.id}>
          <Link to={`/documenti/${v.id}`}>
            {t('home.termItem', {
              date: v.deadline ? formatDate(v.deadline) : t('home.termNoDate'),
              title: documentLabelText(v.label),
            })}
          </Link>
        </div>
      ))}
      {altri > 0 && <div className="muted-sm">{tn('home.termsMore', altri)}</div>}
      {parziale && (
        <div className="muted-sm">{t('home.termsPartial', { n: lette, tot: totaleDate })}</div>
      )}
      <Link className="btn btn-sm mt-10" to="/documenti?scadenza=1&ordine=deadline">
        {t('home.ctaDates')} <Icon name="arrowRight" className="ic-sm" />
      </Link>
    </>
  );
}

function BloccoDaFare({ data }: { data: OverviewData }) {
  const t = useT();
  const tn = useTn();
  const s = data.tasks;
  const conto = termini(data.date.attivi, data.date.archiviati);
  // ⚠️⚠️ DUE PARTI, DUE FONTI, E DUE INTESTAZIONI QUANDO CI SONO ENTRAMBE. La
  // riga delle attività dichiara «nessun termine» — dei TASK — e sotto può
  // esserci un termine dei DOCUMENTI: due frasi vere sullo stesso schermo che
  // si leggono come una contraddizione se nessuno dice di che cosa parlano.
  // Con una parte sola l'intestazione non separa niente e non compare.
  const dueParti = s.aperte > 0 && conto.voci.length > 0;
  // ⚠️ LE COPPIE DI CHIAVI LE DECIDE `chiaviTaskSplit`, che è pura e provata:
  // scegliere qui quale chiave va con quale numero significava poter rendere
  // gli appuntamenti con la parola dei termini — una data presentata come un
  // obbligo quando non lo è — e nessun controllo lo avrebbe visto.
  const parti = chiaviTaskSplit(s).map((parte) => (
    parte.base === null ? t(parte.chiave) : tn(parte.base, parte.n)
  ));

  const primoData = s.primo ? (s.primo.dueDate ?? s.primo.appointmentDate) : null;
  return (
    <section className="card mt-16 ov-block" aria-labelledby="ov-dafare">
      <h2 className="card-title" id="ov-dafare">{t('home.blockToDo')}</h2>
      {/* I TERMINI PER PRIMI: un obbligo con un giorno — magari già passato —
          vale più di un riepilogo di conteggi. */}
      <VociTermini conto={conto} titolo={dueParti} />
      {dueParti && <div className="muted-sm ov-terms-head mt-10">{t('home.tasksHeading')}</div>}
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
      {s.aperte > 0 && (
        <Link className="btn btn-sm mt-10" to="/attivita">
          {t('home.ctaTasks')} <Icon name="arrowRight" className="ic-sm" />
        </Link>
      )}
    </section>
  );
}

/**
 * LE DATE DI NATURA NON REGISTRATA — un limite, non un lavoro.
 *
 * ⚠️ PERCHÉ QUI E NON IN «DA FARE». Una data di cui l'analisi non ha
 * dichiarato la natura non chiede niente a nessuno: dice che il sistema non ha
 * potuto concludere che cosa fosse. Un titolo «Da fare» sopra una riga che non
 * chiede niente insegna a saltare quel titolo.
 *
 * ⚠️ E IL NUMERO DELLA RIGA NON È SEMPRE QUELLO DELLA DESTINAZIONE: il filtro
 * `?scadenza=1` non sa distinguere le nature (la RPC non le filtra), quindi la
 * pagina d'arrivo mostra TUTTE le date della popolazione. Quando i due numeri
 * divergono la riga lo dichiara, invece di lasciar credere che coincidano.
 */
function RigaDateIgnote({ conto, dove, to }: {
  conto: OverviewData['date']['attivi']; dove: TKey; to: string;
}) {
  const t = useT();
  const tn = useTn();
  const r = rigaNature(conto);
  if (r === null) return null;
  return (
    <>
      <div className="ov-line">
        <Link to={to}>{tn('home.datesUnrecorded', r.n, { dove: t(dove) })}</Link>
      </div>
      {r.destinazionePiuAmpia && (
        <div className="muted-sm">
          {t('home.datesScope', { tot: r.totale, dove: t(dove) })}
        </div>
      )}
      {r.parziale && (
        <div className="muted-sm">{t('home.datesSplitPartial', { n: r.lette, tot: r.totale })}</div>
      )}
    </>
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
        <RigaConteggio count={fallite.attivi} base="home.sysFailed"
          dove="home.popActive" to="/documenti?stato=failed" />
      )}
      {fallite.archiviati > 0 && (
        <RigaConteggio count={fallite.archiviati} base="home.sysFailed"
          dove="home.popArchived" to="/documenti?stato=failed&archiviati=1" />
      )}
      {daVerificare.attivi > 0 && (
        <RigaConteggio count={daVerificare.attivi} base="home.sysToVerify"
          dove="home.popActive" to="/documenti?stato=to_verify" />
      )}
      {daVerificare.archiviati > 0 && (
        <RigaConteggio count={daVerificare.archiviati} base="home.sysToVerify"
          dove="home.popArchived" to="/documenti?stato=to_verify&archiviati=1" />
      )}
      {maiAnalizzati.attivi > 0 && (
        <RigaConteggio count={maiAnalizzati.attivi} base="home.sysNever"
          dove="home.popActive" to="/documenti?stato=none" />
      )}
      {maiAnalizzati.archiviati > 0 && (
        <RigaConteggio count={maiAnalizzati.archiviati} base="home.sysNever"
          dove="home.popArchived" to="/documenti?stato=none&archiviati=1" />
      )}
      {/* Le date che il sistema non ha saputo qualificare: una riga per
          popolazione, ciascuna col suo numero e la sua destinazione. */}
      <RigaDateIgnote conto={data.date.attivi} dove="home.popActive"
        to="/documenti?scadenza=1" />
      <RigaDateIgnote conto={data.date.archiviati} dove="home.popArchived"
        to="/documenti?scadenza=1&archiviati=1" />
      <Esempio item={esempio} />
    </section>
  );
}

function BloccoOpportunita({ data, companyName }: { data: OverviewData; companyName: string }) {
  const t = useT();
  const tn = useTn();
  const { catalogo, assessments, summary } = data.incentivi;
  const stato = statoValutazione(assessments);
  // ⚠️ Il caso VUOTO prima dell'uguaglianza: `verified === programs` è vero
  // anche con entrambi a zero, e il blocco si accende pure a catalogo vuoto.
  // La scelta sta in `fraseCatalogo`, che è puro e provato.
  const frase = fraseCatalogo(catalogo);
  return (
    <section className="card mt-16 ov-block" aria-labelledby="ov-opportunita">
      <h2 className="card-title" id="ov-opportunita">{t('home.blockOpportunities')}</h2>
      <div className="ov-line">
        {frase === 'nonLeggibile' && t('home.catalogUnreadable')}
        {frase === 'vuoto' && t('home.catalogEmpty')}
        {frase === 'tuttiVerificati' && catalogo
          && tn('home.catalogAllVerified', catalogo.programs)}
        {frase === 'inParte' && catalogo
          && t('home.catalogSomeVerified', { n: catalogo.programs, v: catalogo.verified })}
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
  const tn = useTn();
  const conteggioTermini = termini(data.date.attivi, data.date.archiviati);
  // ⚠️⚠️ LE DATE CHE NON OBBLIGANO NON SPARISCONO DALLA PAGINA, e la ragione
  // non è il valore di quelle date: è L'ASIMMETRIA DELL'ERRORE DI
  // CLASSIFICAZIONE. Un evento scambiato per termine mostra un obbligo falso —
  // fastidioso, ma visibile e autocorreggente: si apre il documento e si vede.
  // Un TERMINE scambiato per evento sparisce dalla Home in silenzio, e si
  // scopre quando è tardi. Il secondo errore costa molto più del primo, quindi
  // la direzione che lo nasconde non può restare cieca.
  // Un conteggio solo, verificabile, nel piede: non una voce, non un blocco,
  // niente che chieda un gesto.
  const nonObbliganti = data.date.attivi.nonObbliganti + data.date.archiviati.nonObbliganti;
  const blocchi = decidiBlocchi({
    ownership: data.ownership?.count ?? null,
    aperte: data.tasks.aperte,
    // I TERMINI sono lavoro e accendono «Da fare»; le date di natura non
    // registrata sono un limite e accendono il blocco dei limiti. Prima
    // bastavano «le date rilevate» — quali che fossero — e un titolo «Da fare»
    // stava sopra una riga che non chiedeva niente.
    terminiNeiDocumenti: conteggioTermini.trovati,
    dateNonRegistrate: data.date.attivi.nonRegistrate + data.date.archiviati.nonRegistrate,
    daVerificare: data.daVerificare.attivi + data.daVerificare.archiviati,
    fallite: data.fallite.attivi + data.fallite.archiviati,
    maiAnalizzati: data.maiAnalizzati.attivi + data.maiAnalizzati.archiviati,
    // `null` = lettura fallita, e NON si collassa sullo zero: il blocco deve
    // comparire per dire «non leggibile», non sparire come se non esistesse.
    programmiInCatalogo: data.incentivi.catalogo === null ? null : data.incentivi.catalogo.programs,
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
        {t('home.footPopulation')}
        {nonObbliganti > 0 && (
          <>
            {' · '}
            <Link to="/documenti?scadenza=1&ordine=deadline">
              {tn('home.footNonBinding', nonObbliganti)}
            </Link>
            {/* ⚠️ MAI IL SILENZIO SU UNA POPOLAZIONE: il conteggio copre le due,
                la destinazione ne mostra una. Quando la parte archiviata esiste,
                la si nomina invece di lasciarla scoprire all'arrivo. */}
            {data.date.archiviati.nonObbliganti > 0 && (
              <> {t('home.footNonBindingArchived', { n: data.date.archiviati.nonObbliganti })}</>
            )}
          </>
        )}
        {' · '}
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
