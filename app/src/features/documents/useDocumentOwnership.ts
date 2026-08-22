// ============================================================================
// useDocumentOwnership — l'appartenenza di un documento, per le schermate che
// hanno in mano SOLO il suo identificativo.
//
// PERCHÉ ESISTE. La regola «appartenenza in dubbio = niente attività» vive in
// `documentToTask.ts` ed è un campo obbligatorio: chi crea un'attività deve
// dichiarare che cosa sa. Ma per dichiarare il vero serve il verdetto, e il
// verdetto nasce dall'ANALISI del documento — che la schermata delle Finanze
// non ha mai avuto in pagina. Finché è stato così, quella pagina poteva solo
// dire «non valutata», ed è precisamente il buco che il 2026-08-21 ha lasciato
// nascere «Pagare la fattura» da una fattura intestata a un'altra persona.
//
// Qui si mette insieme il pezzo mancante — l'analisi — e si passa il resto a
// `useAnalysisTrust`, che di suo raccoglie rubrica e correzioni. Il risultato è
// già nella forma che il modulo delle attività pretende, così una schermata
// nuova non deve rifare il ragionamento né ricordarsi la traduzione.
//
// ⚠️ OGNI SILENZIO PORTA IL SUO MOTIVO. «Non valutata» non blocca — è la stessa
// scelta delle altre due schermate — ma non è mai un valore muto: il `perche`
// dice se l'analisi si sta ancora leggendo, se non è arrivata, o se quel
// documento un'analisi non ce l'ha proprio. Un buco senza ragione scritta non
// si ritrova più.
// ============================================================================
import { useAsync } from '@/hooks/useAsync';
import { analysisService } from '@/services/analysisService';
import { appartenenzaDa, type Appartenenza } from '@/features/tasks/taskFromDocument';
import { useAnalysisTrust } from './useAnalysisTrust';
import { motivoAppartenenza } from './ownershipReason';

export interface OwnershipGate {
  /** Il documento risulta di un altro: da qui non nascono attività. */
  dubbia: boolean;
  /** Da passare a `createTaskFromDocument`. Non si compone a mano. */
  appartenenza: Appartenenza;
}

export function useDocumentOwnership(documentId: string | null): OwnershipGate {
  // ⚠️ Il ramo senza documento NON è un errore: una voce di Finanze creata a
  // mano può non avere un documento dietro, e allora non c'è niente da valutare.
  const analisi = useAsync(
    () => (documentId ? analysisService.getForDocument(documentId) : Promise.resolve(null)),
    [documentId],
  );
  const trust = useAnalysisTrust(analisi.data);

  // ⚠️ La scala delle ragioni sta in `ownershipReason.ts` ed è PROVATA. Quello
  // che resta qui — le due righe che compongono il verdetto — nessuna
  // asserzione lo vede: un gancio che ne compone altri il banco offline non lo
  // monta. È coperto dalla guardia sui sorgenti (sezione 17) e dalla rilettura,
  // non da un test, e vale la pena saperlo invece di crederlo protetto.
  const perche = motivoAppartenenza({
    documentId, loading: analisi.loading, error: analisi.error, analisi: analisi.data,
  });

  return {
    dubbia: trust?.unavailable === 'ownership',
    appartenenza: appartenenzaDa(trust, perche),
  };
}
