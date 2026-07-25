// Logica condivisa Panoramica/Dashboard: profilo di matching + "Priorità di oggi".
import type { Company, CompanyProfile, DocumentAnalysis, DocumentRecord, SubsidyCase, Task } from '@/types/models';
import type { MatchProfile, MatchResult } from '@/features/subsidy-ai/engine';
import type { IconName } from '@/components/ui/Icon';
import { daysUntil } from '@/lib/format';

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
  tasks: Task[];
  documents: DocumentRecord[];
  analyses: DocumentAnalysis[];
  matches: MatchResult[];
}

const rank: Record<PriorityItem['priority'], number> = { alta: 0, media: 1, bassa: 2 };

/** Priorità operative da scadenze, documenti e incentivi (porting fedele). */
export function collectPriorities({ tasks, analyses, matches }: OverviewInput): PriorityItem[] {
  const items: PriorityItem[] = [];

  // 1) scadenze aperte entro 10 giorni o scadute
  tasks.filter((t) => t.status !== 'completed' && t.dueDate).forEach((t) => {
    const dd = daysUntil(t.dueDate);
    if (dd != null && dd <= 10) {
      items.push({
        priority: dd <= 3 ? 'alta' : 'media', icon: 'calendar', order: dd,
        title: t.title,
        sub: (t.authority ?? 'Attività') + (dd < 0 ? ` · scaduta da ${Math.abs(dd)} gg` : dd === 0 ? ' · scade oggi' : ` · tra ${dd} gg`),
        to: '/scadenziario', cta: 'Vai allo scadenziario',
      });
    }
  });

  // 2) documenti con urgenza alta
  analyses.filter((a) => a.urgency === 'alta').forEach((a) => {
    const undone = a.actions.filter((c) => !c.done).length;
    items.push({
      priority: 'alta', icon: 'document', order: -100,
      title: a.summary ? (a.documentTypeLabel) : a.documentTypeLabel,
      sub: (a.sender ?? 'Documento') + ' · urgenza alta' + (undone ? ` · ${undone} azioni da completare` : ' · azioni completate'),
      to: '/archivio', cta: 'Apri archivio',
    });
  });

  // 3) azioni incomplete su documenti non urgenti
  analyses.filter((a) => a.urgency !== 'alta' && a.actions.some((c) => !c.done)).slice(0, 3).forEach((a) => {
    const undone = a.actions.filter((c) => !c.done).length;
    items.push({
      priority: 'media', icon: 'checkCircle', order: 20,
      title: a.documentTypeLabel,
      sub: `${undone} azioni da completare · ${a.sender ?? 'Documento'}`,
      to: '/archivio', cta: 'Apri archivio',
    });
  });

  // 4) incentivi con domanda da presentare prima di iniziare
  matches.filter((m) => m.program.mustApplyBeforeStart).slice(0, 3).forEach((m) => {
    items.push({
      priority: 'media', icon: 'banknote', order: 40,
      title: m.program.name,
      sub: 'Domanda da presentare PRIMA di avviare il progetto · ' + m.program.authority,
      to: '/subsidy', cta: 'Vai agli incentivi',
    });
  });

  return items.sort((a, b) => (rank[a.priority] - rank[b.priority]) || (a.order - b.order));
}

export function activeCasesCount(cases: SubsidyCase[]): number {
  return cases.filter((c) => c.status !== 'closed').length;
}
