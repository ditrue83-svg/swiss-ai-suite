import { useCompany } from '@/contexts/CompanyContext';
import { useI18n } from '@/i18n';
import { useAsync } from '@/hooks/useAsync';
import { taskService } from '@/services/taskService';
import { documentHubService } from '@/services/documentHubService';
import { analysisService } from '@/services/analysisService';
import { subsidyService } from '@/services/subsidyService';
import { programService } from '@/services/programService';
import { matchPrograms, type MatchResult } from '@/features/subsidy-ai/engine';
import { buildMatchProfile } from './overview';
import type { DocumentAnalysis, DocumentHubItem, SubsidyCase, TaskWithPeople } from '@/types/models';

/** Quante attività servono davvero alla Home: le prime, già ordinate dal database. */
const HOME_TASKS = 20;

interface BaseData {
  tasks: TaskWithPeople[];
  /**
   * Conteggi ESATTI, non la lunghezza di un elenco troncato: vengono dal
   * `total` della funzione `list_tasks`, che conta prima di paginare. Un KPI
   * che dice «20» perché ne ha caricate 20 è un KPI che mente.
   */
  counts: { open: number; overdue: number; inProgress: number; completed: number };
  /** I documenti che richiedono attenzione, non tutti i documenti (§61). */
  attention: DocumentHubItem[];
  documentCount: number;
  matches: MatchResult[];
}

export interface OverviewData extends BaseData {
  /**
   * TUTTE le analisi dell'azienda. Servono ai grafici, che dicono «quanti
   * documenti per tipo, lingua, urgenza» e per dirlo davvero devono contarli
   * tutti. Troncare la lista renderebbe i numeri sbagliati invece che lenti — e
   * un numero sbagliato è peggio di un caricamento lungo.
   * ⚠️ Fino al 2026-07-28 esisteva anche `useHome`, una versione ridotta per la
   * Panoramica: due caricatori quasi uguali per due pagine quasi uguali. Fuse
   * le pagine, è rimasto un caricatore solo.
   */
  analyses: DocumentAnalysis[];
  cases: SubsidyCase[];
}

/** Tutto ciò che la Panoramica mostra: attività, documenti, incentivi, statistiche. */
export function useOverview() {
  const { activeCompanyId, activeCompany, companyProfile } = useCompany();
  const companyId = activeCompanyId as string;
  const { locale } = useI18n();

  return useAsync<OverviewData>(async () => {
    const [todo, overdue, inProgress, completed, attention, documentCount, analyses, cases, programs] =
      await Promise.all([
        taskService.list(companyId, { view: 'todo', limit: HOME_TASKS }),
        taskService.list(companyId, { view: 'overdue', limit: 1 }),
        taskService.list(companyId, { view: 'all', status: 'in_progress', limit: 1 }),
        taskService.list(companyId, { view: 'completed', limit: 1 }),
        documentHubService.attention(companyId, 6),
        documentHubService.activeCount(companyId),
        analysisService.listForCompany(companyId),
        subsidyService.listCases(companyId),
        programService.listActive(locale),
      ]);
    const matches = matchPrograms(buildMatchProfile(activeCompany, companyProfile), programs);
    return {
      tasks: todo.items,
      counts: {
        open: todo.total, overdue: overdue.total,
        inProgress: inProgress.total, completed: completed.total,
      },
      attention, documentCount, analyses, cases, matches,
    };
  }, [companyId, activeCompany?.id, companyProfile, locale]);
}
