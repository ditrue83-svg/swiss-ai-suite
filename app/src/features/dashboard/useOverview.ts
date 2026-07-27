import { useCompany } from '@/contexts/CompanyContext';
import { useI18n } from '@/i18n';
import { useAsync } from '@/hooks/useAsync';
import { taskService } from '@/services/taskService';
import { documentService } from '@/services/documentService';
import { analysisService } from '@/services/analysisService';
import { subsidyService } from '@/services/subsidyService';
import { programService } from '@/services/programService';
import { matchPrograms, type MatchResult } from '@/features/subsidy-ai/engine';
import { buildMatchProfile } from './overview';
import type { DocumentAnalysis, DocumentRecord, SubsidyCase, TaskWithPeople } from '@/types/models';

/** Quante attività servono davvero alla Home: le prime, già ordinate dal database. */
const HOME_TASKS = 20;

export interface OverviewData {
  tasks: TaskWithPeople[];
  /**
   * Conteggi ESATTI, non la lunghezza di un elenco troncato: vengono dal
   * `total` della funzione `list_tasks`, che conta prima di paginare. Un KPI
   * che dice «20» perché ne ha caricate 20 è un KPI che mente.
   */
  counts: { open: number; overdue: number; inProgress: number; completed: number };
  documents: DocumentRecord[];
  analyses: DocumentAnalysis[];
  cases: SubsidyCase[];
  matches: MatchResult[];
}

export function useOverview() {
  const { activeCompanyId, activeCompany, companyProfile } = useCompany();
  const companyId = activeCompanyId as string;
  const { locale } = useI18n();

  return useAsync<OverviewData>(async () => {
    const [todo, overdue, inProgress, completed, documents, analyses, cases, programs] = await Promise.all([
      taskService.list(companyId, { view: 'todo', limit: HOME_TASKS }),
      // `limit: 1` perché di queste interessa solo quante sono: chiedere venti
      // righe per contarle sarebbe traffico speso per niente.
      taskService.list(companyId, { view: 'overdue', limit: 1 }),
      taskService.list(companyId, { view: 'all', status: 'in_progress', limit: 1 }),
      taskService.list(companyId, { view: 'completed', limit: 1 }),
      documentService.list(companyId),
      analysisService.listForCompany(companyId),
      subsidyService.listCases(companyId),
      programService.listActive(locale),
    ]);
    const matches = matchPrograms(buildMatchProfile(activeCompany, companyProfile), programs);
    return {
      tasks: todo.items,
      counts: {
        open: todo.total,
        overdue: overdue.total,
        inProgress: inProgress.total,
        completed: completed.total,
      },
      documents, analyses, cases, matches,
    };
  }, [companyId, activeCompany?.id, companyProfile, locale]);
}
