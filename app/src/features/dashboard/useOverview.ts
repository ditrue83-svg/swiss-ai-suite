import { useCompany } from '@/contexts/CompanyContext';
import { useAsync } from '@/hooks/useAsync';
import { taskService } from '@/services/taskService';
import { documentService } from '@/services/documentService';
import { analysisService } from '@/services/analysisService';
import { subsidyService } from '@/services/subsidyService';
import { programService } from '@/services/programService';
import { matchPrograms, type MatchResult } from '@/features/subsidy-ai/engine';
import { buildMatchProfile } from './overview';
import type { DocumentAnalysis, DocumentRecord, SubsidyCase, Task } from '@/types/models';

export interface OverviewData {
  tasks: Task[];
  documents: DocumentRecord[];
  analyses: DocumentAnalysis[];
  cases: SubsidyCase[];
  matches: MatchResult[];
}

export function useOverview() {
  const { activeCompanyId, activeCompany, companyProfile } = useCompany();
  const companyId = activeCompanyId as string;

  return useAsync<OverviewData>(async () => {
    const [tasks, documents, analyses, cases, programs] = await Promise.all([
      taskService.list(companyId),
      documentService.list(companyId),
      analysisService.listForCompany(companyId),
      subsidyService.listCases(companyId),
      programService.listActive(),
    ]);
    const matches = matchPrograms(buildMatchProfile(activeCompany, companyProfile), programs);
    return { tasks, documents, analyses, cases, matches };
  }, [companyId, activeCompany?.id, companyProfile]);
}
