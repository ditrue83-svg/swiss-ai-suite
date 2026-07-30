import { useCompany } from '@/contexts/CompanyContext';
import { useI18n } from '@/i18n';
import { useAsync } from '@/hooks/useAsync';
import { taskService } from '@/services/taskService';
import { documentHubService } from '@/services/documentHubService';
import { analysisService } from '@/services/analysisService';
import { incentivesService } from '@/services/incentivesService';
import { todayISO } from '@/features/incentives/incentivesModel';
import type {
  DocumentAnalysis, DocumentHubItem, IncentiveCase, IncentiveOpportunity,
  IncentiveSummary, TaskWithPeople,
} from '@/types/models';

/** Quante attività servono davvero alla Home: le prime, già ordinate dal database. */
const HOME_TASKS = 20;

/**
 * La finestra dei numeri degli incentivi in Panoramica, in giorni.
 * ⚠️ Dichiarata qui e usata sia dalla funzione SQL sia dall'etichetta del KPI:
 * un riquadro che dice «entro 30 giorni» mentre il database ne conta 60 è la
 * classe di bugia che questo progetto insegue da mesi.
 */
export const INCENTIVE_DAYS = 30;

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
  /**
   * ⚠️ I NUMERI DEGLI INCENTIVI VENGONO DAL DATABASE (`subsidy_home_summary`),
   * non da un conteggio fatto qui su un elenco troncato. È la stessa disciplina
   * di `counts`: un KPI che dice «3» perché ne ha caricate 3 mente.
   *
   * ⚠️ `null` quando la funzione non risponde con un oggetto, e chi legge deve
   * trattarlo come «non lo sappiamo» — non come sette zeri. Mostrare zeri a chi
   * non ha accesso sarebbe un guasto travestito da stato legittimo.
   */
  incentives: IncentiveSummary | null;
  opportunities: IncentiveOpportunity[];
  cases: IncentiveCase[];
  /** Letto una volta sola al caricamento: le funzioni pure lo ricevono. */
  today: string;
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
}

/** Tutto ciò che la Panoramica mostra: attività, documenti, incentivi, statistiche. */
export function useOverview() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;

  return useAsync<OverviewData>(async () => {
    const [todo, overdue, inProgress, completed, attention, documentCount, analyses,
      incentives, opportunities, cases] =
      await Promise.all([
        taskService.list(companyId, { view: 'todo', limit: HOME_TASKS }),
        taskService.list(companyId, { view: 'overdue', limit: 1 }),
        taskService.list(companyId, { view: 'all', status: 'in_progress', limit: 1 }),
        taskService.list(companyId, { view: 'completed', limit: 1 }),
        documentHubService.attention(companyId, 6),
        documentHubService.activeCount(companyId),
        analysisService.listForCompany(companyId),
        incentivesService.summary(companyId, INCENTIVE_DAYS),
        // Già ordinate dal database per rilevanza, e senza quelle messe da
        // parte: la vista predefinita le esclude.
        incentivesService.opportunities(companyId, { view: 'all' }),
        incentivesService.cases(companyId),
      ]);
    return {
      tasks: todo.items,
      counts: {
        open: todo.total, overdue: overdue.total,
        inProgress: inProgress.total, completed: completed.total,
      },
      attention, documentCount, analyses,
      incentives, opportunities: opportunities.items, cases,
      today: todayISO(),
    };
  }, [companyId]);
}
