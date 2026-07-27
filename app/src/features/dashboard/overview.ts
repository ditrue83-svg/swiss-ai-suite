// Logica condivisa Panoramica/Dashboard: profilo di matching + "Priorità di oggi".
import type { Company, CompanyProfile, DocumentAnalysis, DocumentRecord, SubsidyCase, TaskWithPeople } from '@/types/models';
import type { MatchProfile, MatchResult } from '@/features/subsidy-ai/engine';
import type { IconName } from '@/components/ui/Icon';
import { daysUntil } from '@/lib/format';
import { translate as tr } from '@/i18n';

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
  documents: DocumentRecord[];
  analyses: DocumentAnalysis[];
  matches: MatchResult[];
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
export function collectPriorities({ tasks, analyses, matches }: OverviewInput): PriorityItem[] {
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

  // 2) documenti con urgenza alta — solo quelli che NON hanno già un'attività
  analyses.filter((a) => a.urgency === 'alta' && !documentsWithOpenTask.has(a.documentId)).forEach((a) => {
    const undone = a.actions.filter((c) => !c.done).length;
    items.push({
      priority: 'alta', icon: 'document', order: -100,
      title: a.documentTypeLabel,
      sub: (a.sender ?? tr('home.prioDocument')) + ' · ' + tr('home.prioHighUrgency') + ' · ' + (undone ? tr('home.prioActionsLeft', { n: undone }) : tr('home.prioActionsDone')),
      to: '/archivio', cta: tr('home.ctaArchive'),
    });
  });

  // 3) azioni incomplete su documenti non urgenti
  analyses.filter((a) => a.urgency !== 'alta' && !documentsWithOpenTask.has(a.documentId) && a.actions.some((c) => !c.done)).slice(0, 3).forEach((a) => {
    const undone = a.actions.filter((c) => !c.done).length;
    items.push({
      priority: 'media', icon: 'checkCircle', order: 20,
      title: a.documentTypeLabel,
      sub: `${tr('home.prioActionsLeft', { n: undone })} · ${a.sender ?? tr('home.prioDocument')}`,
      to: '/archivio', cta: tr('home.ctaArchive'),
    });
  });

  // 4) incentivi con domanda da presentare prima di iniziare
  // 0011 — esclusi i sospesi: «Priorità di oggi» invita ad agire subito, e un
  // programma che oggi non viene concesso non è un'azione da fare. Resta
  // visibile in Subsidy AI, dove il motivo della sospensione è dichiarato.
  matches.filter((m) => m.program.mustApplyBeforeStart && m.program.availability !== 'suspended').slice(0, 3).forEach((m) => {
    items.push({
      priority: 'media', icon: 'banknote', order: 40,
      title: m.program.name,
      sub: tr('home.prioApplyBefore') + ' · ' + m.program.authority,
      to: '/subsidy', cta: tr('home.ctaSubsidies'),
    });
  });

  return items.sort((a, b) => (rank[a.priority] - rank[b.priority]) || (a.order - b.order));
}

export function activeCasesCount(cases: SubsidyCase[]): number {
  return cases.filter((c) => c.status !== 'closed').length;
}
