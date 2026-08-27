import { useCompany } from '@/contexts/CompanyContext';
import { useAsync } from '@/hooks/useAsync';
import { taskService } from '@/services/taskService';
import { documentHubService } from '@/services/documentHubService';
import { memberService } from '@/services/memberService';
import { cognomiDaRubrica } from '@/features/documents/analysisTrust';
import { incentivesService } from '@/services/incentivesService';
import { todayISO } from '@/features/incentives/incentivesModel';
import {
  contoDate, splitOpenTasks, type ContoDate, type ContoDocumenti, type TaskSplit,
} from './overviewBlocks';
import {
  importiInScadenza, serieSettimanale, trendPercentuale, type ImportiInScadenza,
} from './overviewKpi';
import { analysisService } from '@/services/analysisService';
import type { DataDocumentoRiga } from '@/services/documentHubService';
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
  /**
   * Le date rilevate nei documenti — UNA POPOLAZIONE ALLA VOLTA, e con le
   * righe dei termini per intero.
   *
   * Le due popolazioni restano separate per la stessa ragione di
   * `daVerificare`: la riga di conteggio è un collegamento, e la pagina
   * d'arrivo ne mostra una sola. I TERMINI si uniscono a schermo, perché il
   * loro collegamento porta al documento e non a un elenco.
   */
  date: { attivi: ContoDate<DataDocumentoRiga>; archiviati: ContoDate<DataDocumentoRiga> };
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

  // ---- La striscia KPI (restyling 2026-08-26, modello Lovable) -------------
  /**
   * Gli importi dei termini in finestra: calcolo PURO (`overviewKpi`) sulle
   * righe di `date` già lette — nessuna interrogazione in più. La somma è
   * `null` quando non è onesta (nessun importo, valute miste).
   */
  importi: ImportiInScadenza;
  /**
   * Le analisi degli ultimi 60 giorni come serie settimanale (8 contenitori,
   * per la sparkline) più il conteggio degli ultimi 30. `null` = lettura
   * fallita: la card lo dichiara invece di mostrare uno zero finto — lo
   * stesso contratto delle tre sorelle degli incentivi qui sopra.
   */
  analisi: { ultimi30: number; settimane: number[]; trend: number | null } | null;
  /**
   * I documenti «da verificare» della POPOLAZIONE ATTIVA, ordinati per scadenza
   * (la colonna «Richiede attenzione» e la scheda in evidenza). `total` è il
   * numero esatto della funzione finestra, non la lunghezza dell'elenco — ed è
   * il numero che la pastiglia di testata dichiara, perché il collegamento
   * della pastiglia porta a `/documenti?stato=to_verify`, che mostra esattamente
   * questo insieme. `null` = lettura fallita.
   */
  attenzione: { items: DocumentHubItem[]; total: number } | null;
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
      date, ownership, catalogo, assessments, summary, timestampAnalisi, attenzione,
    ] = await Promise.all([
      taskService.list(companyId, { view: 'todo', limit: TASKS_SPLIT_MAX }),
      documentHubService.counts(companyId, false),
      documentHubService.counts(companyId, true),
      documentHubService.stateTotals(companyId, 'to_verify'),
      documentHubService.stateTotals(companyId, 'failed'),
      documentHubService.stateTotals(companyId, 'none'),
      documentHubService.dateDeiDocumenti(companyId),
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
      // ⚠️ LO STESSO CONTRATTO DELLE SUE DUE SORELLE. `catalogState` e
      // `assessmentCount` tornano `null` sul guasto — è dichiarato nel tipo qui
      // sopra e il blocco lo dice a schermo — mentre `summary` LANCIA. Senza
      // questo `.catch`, un guasto di `subsidy_home_summary` faceva cadere in
      // ErrorState l'INTERA Panoramica: attività, documenti, appartenenza,
      // catalogo, tutto. E teneva irraggiungibile `home.summaryUnknown`, il
      // ramo scritto e tradotto apposta per questo caso.
      incentivesService.summary(companyId, INCENTIVE_DAYS).catch(() => null),
      // Le due letture della striscia KPI (2026-08-26). Stesso contratto del
      // ramo incentivi: il guasto di una card non deve spegnere la pagina,
      // quindi `null` e non un lancio — la card dichiara il proprio limite.
      // 60 giorni: 8 settimane piene per la sparkline, e gli ultimi 30 si
      // contano dagli stessi timestamp — una sola interrogazione, due numeri.
      analysisService.timestampAnalisi(companyId, 60).catch(() => null),
      // I «da verificare» ATTIVI per scadenza: la colonna «Richiede attenzione»
      // e la scheda in evidenza. Il limite è un tetto da elenco, non un
      // troncamento nascosto: `total` resta il numero esatto della finestra.
      documentHubService.list(companyId, { state: 'to_verify', sort: 'deadline', limit: 6 })
        .catch(() => null),
    ]);

    const dateContate = {
      attivi: contoDate(date.attivi.righe, date.attivi.totale),
      archiviati: contoDate(date.archiviati.righe, date.archiviati.totale),
    };

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
      // Il TOTALE è quello esatto della funzione finestra; la ripartizione sta
      // sulle righe lette, e `parziale` dichiara quando le due cose non
      // coprono lo stesso insieme.
      date: dateContate,
      ownership,
      incentivi: { catalogo, assessments, summary },
      today,
      loadedAt: new Date().toISOString(),
      // La somma è un calcolo puro sulle righe già lette (le DUE popolazioni:
      // un termine archiviato resta un obbligo). Se le righe sono al tetto la
      // somma copre meno del reale — la card lo dichiara col ramo `parziale`,
      // che `dateContate` porta già.
      importi: importiInScadenza(
        [...dateContate.attivi.termini, ...dateContate.archiviati.termini],
        today,
      ),
      analisi: timestampAnalisi === null ? null : (() => {
        const settimane = serieSettimanale(timestampAnalisi, 8, new Date());
        const trentaGiorniFa = Date.now() - 30 * 86_400_000;
        return {
          ultimi30: timestampAnalisi.filter((ts) => new Date(ts).getTime() >= trentaGiorniFa).length,
          settimane,
          trend: trendPercentuale(settimane),
        };
      })(),
      attenzione,
    };
  }, [companyId, legalName]);
}
