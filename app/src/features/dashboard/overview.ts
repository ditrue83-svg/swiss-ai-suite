// Logica condivisa Panoramica/Dashboard: profilo di matching + "Priorità di oggi".
import type { Company, CompanyProfile, DocumentAnalysis, DocumentRecord, SubsidyCase, Task } from '@/types/models';
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
        sub: (t.authority ?? tr('home.prioActivity')) + ' · ' + (dd < 0 ? tr('home.prioOverdue', { n: Math.abs(dd) }) : dd === 0 ? tr('home.prioToday') : tr('home.prioInDays', { n: dd })),
        to: '/scadenziario', cta: tr('home.ctaTasks'),
      });
    }
  });

  // 2) documenti con urgenza alta
  analyses.filter((a) => a.urgency === 'alta').forEach((a) => {
    const undone = a.actions.filter((c) => !c.done).length;
    items.push({
      priority: 'alta', icon: 'document', order: -100,
      title: a.documentTypeLabel,
      sub: (a.sender ?? tr('home.prioDocument')) + ' · ' + tr('home.prioHighUrgency') + ' · ' + (undone ? tr('home.prioActionsLeft', { n: undone }) : tr('home.prioActionsDone')),
      to: '/archivio', cta: tr('home.ctaArchive'),
    });
  });

  // 3) azioni incomplete su documenti non urgenti
  analyses.filter((a) => a.urgency !== 'alta' && a.actions.some((c) => !c.done)).slice(0, 3).forEach((a) => {
    const undone = a.actions.filter((c) => !c.done).length;
    items.push({
      priority: 'media', icon: 'checkCircle', order: 20,
      title: a.documentTypeLabel,
      sub: `${tr('home.prioActionsLeft', { n: undone })} · ${a.sender ?? tr('home.prioDocument')}`,
      to: '/archivio', cta: tr('home.ctaArchive'),
    });
  });

  // 4) incentivi con domanda da presentare prima di iniziare
  matches.filter((m) => m.program.mustApplyBeforeStart).slice(0, 3).forEach((m) => {
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
