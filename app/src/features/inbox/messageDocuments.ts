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
import { stateOf } from '@/features/documents/documentModel';
import type {
  DocumentState, EmailAttachment, EmailDocumentRelation, EmailLinkedDocument,
} from '@/types/models';
import type { AnalysisStatus, DocumentStatus } from '@/types/database';

export interface MessageDocumentRow {
  documentId: string;
  relation: EmailDocumentRelation;
  title: string;
  /** Il nome del file, quando la riga viene da un allegato. */
  filename: string | null;
  /**
   * Lo stesso vocabolario del Document Hub — e `null` quando da qui NON si sa.
   * ⚠️ `null` non è pigrizia: `documents.status` e lo stato dell'analisi
   * POSSONO divergere, e il 2026-07-31 in produzione c'era una riga
   * `status = 'completed'` con l'ultima analisi `needs_review`. Scrivere
   * «Analizzato» su quel documento significherebbe dire una cosa che la
   * schermata del documento smentisce due clic più in là.
   */
  state: DocumentState | null;
  /**
   * È il documento su cui il messaggio mostra l'analisi (§33): l'allegato se
   * c'è, altrimenti il corpo. Non si fondono evidenze di fonti diverse.
   */
  isPrimary: boolean;
}

/**
 * Lo stato di un documento di cui NON si è letta l'analisi.
 *
 * Il carico del messaggio porta `documents.status`, che da solo decide con
 * certezza tre casi e non gli altri:
 *   · in lavorazione, fallito, mai analizzato  → si sanno;
 *   · «completato» / «da verificare»           → NON si sanno, perché quello
 *     stato lo stabilisce l'ultimo tentativo di analisi, e i due valori
 *     possono divergere (misurato in produzione il 2026-07-31: un documento
 *     `completed` con l'ultima analisi `needs_review`).
 *
 * Nel dubbio si restituisce `null` e la riga non mostra nessuna pastiglia: la
 * schermata del documento lo dice, e lo dice giusto. Un'etichetta plausibile e
 * sbagliata è peggio di un'etichetta assente.
 */
export function documentStateFromStatus(status: DocumentStatus): DocumentState | null {
  switch (status) {
    case 'extracting':
    case 'analyzing':
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'uploaded':
      return 'none';
    case 'completed':
    case 'needs_review':
    case 'analyzed':
      return null;
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
  /**
   * L'esito dell'ultima analisi del documento PRINCIPALE, che il dettaglio del
   * messaggio carica già per mostrare «Cosa richiede attenzione». Per quella
   * riga lo stato si ricava con `stateOf`, la STESSA funzione del Document
   * Hub: là dove il dato c'è, si usa quello vero.
   */
  primaryAnalysisStatus: AnalysisStatus | null = null,
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
    state: primary?.documentId === d.documentId && primaryAnalysisStatus !== null
      ? stateOf(primaryAnalysisStatus, d.status)
      : documentStateFromStatus(d.status),
    isPrimary: primary?.documentId === d.documentId,
  }));
}
