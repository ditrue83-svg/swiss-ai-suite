import { useCompany } from '@/contexts/CompanyContext';
import { useAsync } from '@/hooks/useAsync';
import { taskService } from '@/services/taskService';
import { documentHubService } from '@/services/documentHubService';
import { memberService } from '@/services/memberService';
import { cognomiDaRubrica } from '@/features/documents/analysisTrust';
import { incentivesService } from '@/services/incentivesService';
import { todayISO } from '@/features/incentives/incentivesModel';
import {
  contaNature, splitOpenTasks, type ContoDocumenti, type ContoNature, type TaskSplit,
} from './overviewBlocks';
import type { DocumentHubItem, IncentiveSummary } from '@/types/models';

/**
 * Quante attività si LEGGONO per dividerle in termini e appuntamenti. Non è la
 * pagina della Home: è il tetto oltre il quale il diviso si dichiara parziale
 * (`TaskSplit.parziale`) invece di sembrare intero. I totali restano esatti:
 * vengono dalla funzione finestra di `list_tasks`, non dalla lunghezza.
 *
 * ⚠️ IL NUMERO NON LO SCEGLIE QUESTO FILE: lo impone `list_tasks`, che chiude
 * il proprio argomento con `least(coalesce(p_limit, 25), 100)` (0041), e
 * `taskService.list` glielo passa grezzo. Chiedendone 200 se ne ottenevano
 * 100: con 150 attività aperte la Home scriveva «calcolata sulle prime 100 di
 * 150» mentre chi aveva scritto 200 credeva di coprirle tutte. È la stessa
 * nota dei tetti di `list_documents` in `documentHubService.ts` — un numero
 * più alto qui sarebbe una promessa che la RPC non mantiene.
 */
const TASKS_SPLIT_MAX = 100;

/**
 * La finestra dei numeri degli incentivi, in giorni. Dichiarata qui e usata
 * sia dalla funzione SQL sia dall'etichetta: un riquadro che dice «entro 30
 * giorni» mentre il database ne conta 60 è la classe di bugia che questo
 * progetto insegue da mesi.
 */
export const INCENTIVE_DAYS = 30;

export interface OverviewData {
  /** Le attività aperte, divise: termini ≠ appuntamenti (0041). */
  tasks: TaskSplit;
  /**
   * OGNI CONTEGGIO DEI DOCUMENTI COPRE LE DUE POPOLAZIONI, e il piè di pagina
   * lo dichiara. Il censimento del 2026-08-19: 19 documenti su 19 archiviati —
   * una Home «solo attivi» era una pagina bianca sopra 16 analisi non
   * conclusive. Le due parti restano separate perché i collegamenti portano a
   * `list_documents`, che mostra una popolazione alla volta: il blocco elenca
   * una riga per popolazione, ciascuna col suo numero e la sua destinazione.
   */
  daVerificare: ContoDocumenti & { esempio: DocumentHubItem | null };
  fallite: ContoDocumenti & { esempio: DocumentHubItem | null };
  maiAnalizzati: ContoDocumenti & { esempio: DocumentHubItem | null };
  /** Tutti i documenti dell'azienda, per popolazione (stessa fonte della
   *  barra laterale di /documenti: `document_category_counts`). */
  documenti: ContoDocumenti;
  /** Le date rilevate nei documenti, contate per natura dichiarata. */
  nature: ContoNature & { parziale: boolean };
  /**
   * Appartenenza da confermare, archiviati COMPRESI, con l'esempio più
   * recente già passato dalla regola del titolo. `null` = il numero non è
   * disponibile: non si mostra niente, mai uno zero finto. (Eccezione
   * DICHIARATA alla regola sul fallback silenzioso: il silenzio qui non
   * inventa nulla.)
   *
   * `parziale` viaggia COL NUMERO perché la lettura ha un tetto: cento
   * documenti per popolazione, il massimo che `list_documents` concede. È lo
   * stesso conteggio e lo stesso tetto della pagina d'arrivo — che lo dichiara
   * già — e la Home non può presentare come un fatto ciò che là è dichiarato
   * incompleto.
   */
  ownership: { count: number; latest: DocumentHubItem | null; parziale: boolean } | null;
  /**
   * Il blocco Opportunità: catalogo condiviso + lo stato della valutazione.
   * `assessments` distingue «valutato: niente per te» da «mai valutato» —
   * `subsidy_home_summary` da sola restituisce gli stessi zeri in entrambi i
   * casi. `null` = lettura fallita, e il blocco lo dice invece di scegliere.
   */
  incentivi: {
    catalogo: { programs: number; verified: number } | null;
    assessments: number | null;
    summary: IncentiveSummary | null;
  };
  /** Oggi in `YYYY-MM-DD`, ora locale: le funzioni pure lo ricevono. */
  today: string;
  /** L'istante della lettura, per il piè di pagina: una pagina di conteggi
   *  senza il suo «quando» invecchia in silenzio. */
  loadedAt: string;
}

/** Tutto ciò che la Panoramica mostra: blocchi decisi dai numeri. */
export function useOverview() {
  const { activeCompanyId, activeCompany } = useCompany();
  const companyId = activeCompanyId as string;
  const legalName = activeCompany?.legalName ?? '';

  return useAsync<OverviewData>(async () => {
    const today = todayISO();
    const [
      aperte, contiAttivi, contiArchiviati, daVerificare, fallite, maiAnalizzati,
      kinds, ownership, catalogo, assessments, summary,
    ] = await Promise.all([
      taskService.list(companyId, { view: 'todo', limit: TASKS_SPLIT_MAX }),
      documentHubService.counts(companyId, false),
      documentHubService.counts(companyId, true),
      documentHubService.stateTotals(companyId, 'to_verify'),
      documentHubService.stateTotals(companyId, 'failed'),
      documentHubService.stateTotals(companyId, 'none'),
      documentHubService.deadlineKinds(companyId),
      // ⚠️ `null` E NON UN LANCIO: questo numero è informazione in più, non la
      // Panoramica. I cognomi arrivano dalla rubrica; se anche quella fallisce
      // si va avanti senza — un cognome non confrontabile non fa scattare
      // nessun avviso, per regola.
      (async () => {
        const members = await memberService.listAssignable(companyId).catch(() => []);
        return documentHubService.ownershipOverview(companyId, {
          legalName, memberSurnames: cognomiDaRubrica(members.map((m) => m.name)),
        });
      })().catch(() => null),
      incentivesService.catalogState(),
      incentivesService.assessmentCount(companyId),
      incentivesService.summary(companyId, INCENTIVE_DAYS),
    ]);

    return {
      tasks: splitOpenTasks(
        aperte.items.map((t) => ({
          title: t.title, dueDate: t.dueDate, appointmentDate: t.appointmentDate,
        })),
        aperte.total,
        today,
      ),
      daVerificare,
      fallite,
      maiAnalizzati,
      documenti: {
        attivi: [...contiAttivi.values()].reduce((a, b) => a + b, 0),
        archiviati: [...contiArchiviati.values()].reduce((a, b) => a + b, 0),
      },
      // Il TOTALE è quello esatto della funzione finestra; le nature sono
      // contate sulle righe lette, e `parziale` dichiara quando le due cose
      // non coprono lo stesso insieme.
      nature: { ...contaNature(kinds.kinds), totale: kinds.totale, parziale: kinds.parziale },
      ownership,
      incentivi: { catalogo, assessments, summary },
      today,
      loadedAt: new Date().toISOString(),
    };
  }, [companyId, legalName]);
}
