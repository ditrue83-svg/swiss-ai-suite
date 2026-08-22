// ============================================================================
// Perché l'appartenenza non è stata valutata — la scala delle ragioni, PURA.
//
// Sta in un file suo, senza un solo import, per la ragione di sempre in questo
// progetto: `useDocumentOwnership` è un gancio che ne compone altri due e uno
// script di prova non riesce a montarlo. Quello che si può provare va tirato
// fuori, o resta un verde che non sa diventare rosso.
//
// ⚠️ L'ORDINE È UNA DECISIONE. «Non c'è un documento» viene prima di «sto
// leggendo», perché senza documento non si legge niente e dire «in lettura»
// sarebbe una bugia cortese. «Non leggibile» viene prima di «non c'è
// un'analisi»: un guasto di rete e un documento mai analizzato sono due fatti
// diversi, e confonderli manda a cercare il problema dalla parte sbagliata.
// ============================================================================

export interface StatoLettura {
  documentId: string | null;
  loading: boolean;
  error: string | null;
  /** L'analisi trovata, quando la lettura è finita bene. */
  analisi: unknown | null;
}

export function motivoAppartenenza(s: StatoLettura): string {
  if (!s.documentId) return 'nessun documento collegato a questa voce';
  if (s.loading) return 'analisi del documento ancora in lettura';
  if (s.error) return 'analisi del documento non leggibile';
  if (!s.analisi) return 'il documento non ha un’analisi da cui valutare l’appartenenza';
  return 'verdetto di attendibilità non ancora disponibile';
}
