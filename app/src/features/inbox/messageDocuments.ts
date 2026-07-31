// ============================================================================
// Che cosa ha prodotto una comunicazione — funzioni PURE.
//
// PERCHÉ ESISTE
// Il dettaglio di un messaggio mostrava, per ogni documento nato dalla posta,
// un pulsante «Apri analisi». Tre conseguenze, tutte trovate guardando la
// schermata e non il codice:
//   · con un corpo E un allegato importati comparivano DUE pulsanti identici,
//     e niente diceva quale fosse quale;
//   · si arrivava solo alla schermata di analisi, mai al documento — cioè al
//     posto dove quel documento si organizza, si archivia e diventa lavoro;
//   · se l'analisi non c'era ancora, il pulsante prometteva una schermata che
//     non aveva niente da mostrare.
//
// ⚠️ QUI NON SI COPIA NIENTE DEL DOCUMENT HUB. Lo stato che queste funzioni
// leggono (`EmailLinkedDocument.status`) è già nel carico del messaggio, e le
// etichette sono quelle di `documents.states.*`: un secondo vocabolario per
// dire «in elaborazione» avrebbe prodotto due parole per lo stesso stato.
// ============================================================================
import type {
  DocumentState, EmailAttachment, EmailDocumentRelation, EmailLinkedDocument,
} from '@/types/models';
import type { DocumentStatus } from '@/types/database';

export interface MessageDocumentRow {
  documentId: string;
  relation: EmailDocumentRelation;
  title: string;
  /** Il nome del file, quando la riga viene da un allegato. */
  filename: string | null;
  /** Lo stesso vocabolario del Document Hub: nessuna parola nuova. */
  state: DocumentState;
  /**
   * È il documento su cui il messaggio mostra l'analisi (§33): l'allegato se
   * c'è, altrimenti il corpo. Non si fondono evidenze di fonti diverse.
   */
  isPrimary: boolean;
}

/**
 * Lo stato del documento a partire dal suo `status`.
 *
 * ⚠️ Deliberatamente NON usa `stateOf` del Document Hub: quella funzione
 * decide dall'esito dell'ULTIMO TENTATIVO di analisi, un dato che il carico
 * del messaggio non porta. Fingere di saperlo qui vorrebbe dire raccontare uno
 * stato che nessuno ha letto. Da `uploaded` si ricava «non ancora analizzato»,
 * che è vero; il resto lo racconta la schermata del documento.
 */
export function documentStateFromStatus(status: DocumentStatus): DocumentState {
  switch (status) {
    case 'extracting':
    case 'analyzing':
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'needs_review':
      return 'to_verify';
    case 'completed':
    case 'analyzed':
      return 'analyzed';
    case 'uploaded':
      return 'none';
  }
}

/**
 * Il documento PRINCIPALE del messaggio: l'allegato se c'è, il corpo altrimenti.
 *
 * Era scritto dentro il componente ed è la stessa regola di §33. Sta qui perché
 * ora la usano in due — il caricamento dell'analisi e l'elenco dei documenti —
 * e due copie della stessa scelta finirebbero per indicare due documenti
 * diversi come «principale».
 */
export function primaryDocumentOf(
  documents: EmailLinkedDocument[],
): EmailLinkedDocument | null {
  return documents.find((d) => d.relation === 'attachment') ?? documents[0] ?? null;
}

export function messageDocumentRows(
  documents: EmailLinkedDocument[],
  attachments: EmailAttachment[],
): MessageDocumentRow[] {
  const primary = primaryDocumentOf(documents);
  return documents.map((d) => ({
    documentId: d.documentId,
    relation: d.relation,
    title: d.title,
    // Il nome del file lo porta l'allegato, non il documento: il titolo del
    // documento può essere stato cambiato a mano nel Document Hub, e in quel
    // caso sono due informazioni diverse ed entrambe utili.
    filename: d.attachmentId
      ? attachments.find((a) => a.id === d.attachmentId)?.filename ?? null
      : null,
    state: documentStateFromStatus(d.status),
    isPrimary: primary?.documentId === d.documentId,
  }));
}
