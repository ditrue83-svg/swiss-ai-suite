// Logica condivisa Panoramica/Dashboard: profilo di matching + "Priorità di oggi".
//
// ⚠️ GLI INCENTIVI DELLA HOME LEGGONO IL MOTORE 2.0 (0032), non più il matcher
//    1.0 che girava nel browser. Fino al 2026-07-30 la Panoramica diceva
//    «6 incentivi rilevanti» mentre la schermata Incentivi diceva «nessun
//    progetto, 0 opportunità»: due motori, due risposte, sullo stesso
//    argomento. Per chi legge erano due verità — precisamente ciò che questo
//    prodotto evita ovunque. La Home ora legge le stesse righe della schermata.
import type { Company, CompanyProfile, DocumentAnalysis, DocumentHubItem, TaskWithPeople } from '@/types/models';
import type { IncentiveCase, IncentiveOpportunity } from '@/types/models';
import type { MatchProfile } from '@/features/subsidy-ai/engine';
import type { IconName } from '@/components/ui/Icon';
import { daysUntil } from '@/lib/format';
import { translate as tr } from '@/i18n';
// ⚠️ Il NOME del documento, non il suo titolo grezzo. Il 2026-08-15 la prima
// riga di questa schermata era «2.5» — un titolo estratto male, mostrato sotto
// «Ecco cosa richiede attenzione nella tua azienda». La decisione è già stata
// presa dal servizio (`d.label`); qui si traduce soltanto.
import { documentLabelText } from '@/i18n/documentLabel';
import {
  caseDeadline, nextStep, NEXT_STEP_KEY, type NextStep,
} from '@/features/incentives/incentivesModel';

export function buildMatchProfile(company: Company | null, profile: CompanyProfile | null): MatchProfile {
  return {
    canton: company?.canton ?? null,
    sector: profile?.sector ?? null,
    employeeCount: profile?.employeeCount ?? null,
    projects: profile?.currentProjects ?? [],
  };
}

export interface PriorityItem {
  priority: 'alta' | 'media' | 'bassa';
  icon: IconName;
  order: number;
  title: string;
  sub: string;
  to: string;
  cta: string;
}

export interface OverviewInput {
  tasks: TaskWithPeople[];
  /**
   * ⚠️ NON tutti i documenti: solo quelli che richiedono attenzione.
   *
   * Prima qui arrivavano TUTTE le analisi dell'azienda, e la Panoramica ne
   * ricavava anche le «azioni incomplete su documenti non urgenti» — cioè un
   * elenco di documenti travestito da priorità. Con duemila documenti quella
   * schermata avrebbe scaricato duemila analisi per mostrarne tre.
   * Una fattura archiviata correttamente non è una priorità: la Panoramica
   * risponde a «cosa richiede attenzione», e la risposta non è «tutto».
   */
  attention: DocumentHubItem[];
  /**
   * Le opportunità del motore 2.0, già ordinate dal database per rilevanza.
   * ⚠️ Quelle MESSE DA PARTE non arrivano qui: `list_subsidy_opportunities` le
   *    esclude dalla vista predefinita, e riproporle in Home sarebbe ignorare
   *    una decisione che qualcuno ha già preso.
   */
  opportunities: IncentiveOpportunity[];
  /** Le pratiche non archiviate. */
  cases: IncentiveCase[];
  /** Oggi in `YYYY-MM-DD`: parametro e non `new Date()`, così è provabile. */
  today: string;
}

const rank: Record<PriorityItem['priority'], number> = { alta: 0, media: 1, bassa: 2 };

/**
 * Priorità operative da attività, documenti e incentivi.
 *
 * ⚠️ REGOLA DI NON DUPLICAZIONE (Work Hub, 0016). Quando da un documento è già
 * nata un'attività, in Home compare l'ATTIVITÀ e non il documento: sono la
 * stessa cosa vista da due lati, e mostrarle come due problemi indipendenti
 * raddoppia il lavoro apparente e fa perdere fiducia nell'elenco. L'attività
 * vince perché dice cosa fare, chi lo fa ed entro quando; il documento è la
 * fonte, e si raggiunge dall'attività.
 */
export function collectPriorities({ tasks, attention, opportunities, cases, today }: OverviewInput): PriorityItem[] {
  const items: PriorityItem[] = [];

  // Documenti che hanno già un'attività aperta: non si ripetono più sotto.
  const documentsWithOpenTask = new Set(
    tasks.filter((t) => t.status !== 'completed' && t.documentId).map((t) => t.documentId as string),
  );

  // 1) attività che richiedono attenzione: quelle in scadenza entro 10 giorni
  //    e TUTTE quelle a priorità alta.
  //
  //    ⚠️ La seconda condizione non è un di più. Con la sola soglia dei 10
  //    giorni, creare un'attività da un documento urgente lo faceva SPARIRE
  //    dalla Home: il documento veniva deduplicato (giustamente, il lavoro ora
  //    è l'attività) ma l'attività non lo sostituiva, perché scadeva fra dodici
  //    giorni. Risultato visto sul campo: «sei in pari con scadenze e
  //    documenti» con un sollecito IVA da pagare. Una priorità alta significa
  //    che richiede attenzione — che è esattamente la domanda a cui questa
  //    schermata risponde — e non si misura in giorni.
  tasks.filter((t) => t.status !== 'completed').forEach((t) => {
    const dd = daysUntil(t.dueDate);
    const nearDeadline = dd != null && dd <= 10;
    const highPriority = t.priority === 'high';
    if (!nearDeadline && !highPriority) return;

    const when = dd == null
      ? tr('home.prioNoDeadline')
      : dd < 0 ? tr('home.prioOverdue', { n: Math.abs(dd) })
      : dd === 0 ? tr('home.prioToday')
      : tr('home.prioInDays', { n: dd });

    items.push({
      priority: dd != null && dd <= 3 ? 'alta' : highPriority ? 'alta' : 'media',
      icon: 'calendar',
      // Le scadenze vicine restano davanti; le alte priorità senza urgenza
      // immediata seguono, invece di scavalcare ciò che scade domani.
      order: dd ?? 30,
      title: t.title,
      sub: (t.assigneeName ?? t.authority ?? tr('home.prioActivity')) + ' · ' + when,
      to: `/attivita/${t.id}`, cta: tr('home.ctaTasks'),
    });
  });

  // 2) documenti che richiedono attenzione — e SOLO quelli.
  //
  //    Due casi, entrambi verificabili: l'analisi non è riuscita (il documento
  //    è lì e non lo ha letto nessuno) oppure l'analisi stessa dichiara che va
  //    verificata. Non compaiono i documenti «con azioni aperte»: quelle,
  //    quando contano, diventano un'attività, e l'attività è già sopra.
  //    Resta la regola di non duplicazione: se da un documento è già nata
  //    un'attività aperta, in Panoramica compare l'attività.
  attention
    .filter((d) => !documentsWithOpenTask.has(d.id))
    .forEach((d) => {
      const failed = d.state === 'failed';
      items.push({
        priority: failed ? 'alta' : 'media',
        icon: failed ? 'alert' : 'fileSearch',
        order: failed ? -100 : 10,
        title: documentLabelText(d.label),
        sub: [d.sender, failed ? tr('home.prioDocFailed') : tr('home.prioDocToVerify')]
          .filter(Boolean).join(' · '),
        to: `/documenti/${d.id}`, cta: tr('home.ctaDocument'),
      });
    });

  // 3) LE PRATICHE con una scadenza che si avvicina o già passata.
  //
  //    ⚠️ VENGONO PRIMA DELLE OPPORTUNITÀ, e non è un dettaglio d'ordine: una
  //    pratica è lavoro già cominciato con una scadenza vera, un'opportunità è
  //    una possibilità. §118 — si dichiara SEMPRE quale delle due scadenze è,
  //    perché «fra 5 giorni» senza dire «interna» farebbe credere che
  //    l'autorità chiuda fra cinque giorni.
  const casesByOpportunity = new Set(
    cases.filter((k) => k.opportunityId).map((k) => k.opportunityId as string),
  );

  cases.forEach((k) => {
    if (k.status === 'closed' || k.status === 'submitted') return;
    const due = caseDeadline(k, today);
    if (!due) return;
    if (!due.expired && due.daysLeft > INCENTIVE_DEADLINE_DAYS) return;
    items.push({
      priority: due.expired || due.daysLeft <= 7 ? 'alta' : 'media',
      icon: 'banknote',
      order: due.daysLeft,
      title: k.programName ?? k.programId,
      sub: (due.kind === 'official' ? tr('home.prioCaseOfficial') : tr('home.prioCaseInternal'))
        + ' · ' + (due.expired
          ? tr('home.prioOverdue', { n: Math.abs(due.daysLeft) })
          : due.daysLeft === 0 ? tr('home.prioToday') : tr('home.prioInDays', { n: due.daysLeft })),
      to: '/incentivi?scheda=pratiche', cta: tr('home.ctaSubsidies'),
    });
  });

  // 4) LE OPPORTUNITÀ su cui c'è un gesto da fare.
  //
  //    ⚠️ REGOLA DI NON DUPLICAZIONE, la stessa dei documenti (0016) e §133:
  //    un'opportunità da cui è già nata una pratica NON compare — comparirebbe
  //    la stessa cosa due volte, una come possibilità e una come lavoro. Vince
  //    la pratica, che è il punto 3.
  //
  //    ⚠️ E LA REGOLA CHE NE DERIVA, pagata sul campo con lo scadenziario: chi
  //    deduplica deve verificare che il SOSTITUTO compaia davvero. Qui la
  //    pratica compare solo se ha una scadenza vicina, quindi una pratica
  //    tranquilla toglie di mezzo la sua opportunità senza rimpiazzarla — ed è
  //    corretto: il lavoro è cominciato, non richiede attenzione oggi.
  //
  //    ⚠️ 0011 — i programmi sospesi e i ritirati non compaiono, e le pratiche
  //    già aperte nemmeno: MA NON SI FILTRANO QUI. Lo decide `nextStep()`, che
  //    li risolve in `suspended`, `retired` e `inCase` — nessuno dei tre è un
  //    gesto da fare. Un secondo filtro con la stessa regola l'ha avuta scritta
  //    per un'ora, e la controprova ha mostrato che era decorativo: toglierlo
  //    non faceva fallire nulla, perché `nextStep` aveva già escluso tutto.
  //    Due copie della stessa decisione divergono, e quella morta sembra la
  //    garanzia senza esserlo. La regola sta in un posto solo, ed è provata.
  //
  //    ⚠️ `casesByOpportunity` invece NON è ridondante e un test lo dimostra:
  //    `nextStep` guarda `o.caseId`, che arriva dall'elenco delle opportunità;
  //    questo insieme arriva dall'elenco delle pratiche. Sono due letture
  //    diverse, e quando divergono vince «esiste una pratica».
  opportunities
    .filter((o) => !casesByOpportunity.has(o.id))
    .filter((o) => ACTIONABLE_STEPS.has(nextStep(o, today)))
    .slice(0, 3)
    .forEach((o) => {
      items.push({
        priority: 'media', icon: 'banknote', order: 40,
        title: o.programName,
        // La frase è quella della schermata Incentivi: la Home non inventa un
        // secondo modo di dire la stessa cosa.
        sub: tr(NEXT_STEP_KEY[nextStep(o, today)]) + ' · ' + o.authority,
        to: '/incentivi', cta: tr('home.ctaSubsidies'),
      });
    });

  return items.sort((a, b) => (rank[a.priority] - rank[b.priority]) || (a.order - b.order));
}

/**
 * Entro quanti giorni la scadenza di una pratica diventa una priorità della
 * Home. ⚠️ Più stretta della finestra del modulo (60 giorni): la Panoramica
 * risponde a «cosa richiede attenzione ADESSO», e a sessanta giorni la risposta
 * è no.
 */
export const INCENTIVE_DEADLINE_DAYS = 30;

/**
 * I passi successivi che meritano un posto in Panoramica.
 *
 * ⚠️ NON CI SONO `watch`, `closed`, `ineligible`, `suspended`, `retired` né
 *    `inCase`: sono stati in cui non c'è niente da fare, e riempire la
 *    «Priorità di oggi» con righe su cui non si agisce è il modo di far
 *    smettere di leggerla. `verifySource` c'è perché controllare la pagina
 *    ufficiale È un gesto.
 */
const ACTIONABLE_STEPS: ReadonlySet<NextStep> = new Set<NextStep>([
  'answer', 'complete', 'verifySource', 'openCase', 'stale',
]);
