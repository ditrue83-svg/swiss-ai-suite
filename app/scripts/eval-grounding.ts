// ============================================================================
// La regola di ancoraggio della VALUTAZIONE — funzione pura, provata offline.
//
// ⚠️ PERCHÉ È UN MODULO A SÉ E NON UNA RIGA DENTRO `eval-assistant.ts`.
// Questa regola decide se una risposta è un fallimento, e ha già sbagliato una
// volta: trattava importi e date allo stesso modo e bocciava una risposta
// corretta. Una regola del genere, scritta in linea dentro uno script che
// costa denaro a ogni esecuzione, si può provare soltanto spendendo — e
// infatti non era provata. Qui è una funzione pura con i suoi casi in
// `npm run test:assistant-unit`, che gira offline e in due decimi di secondo.
//
// ⚠️ NON È CODICE DI PRODOTTO, e per questo non vive in
// `supabase/functions/_shared/`: è la politica di una PROVA. Metterla là la
// spedirebbe dentro il bundle della Edge Function, dove non serve a nessuno.
// ============================================================================

/**
 * La diagnostica che il PRODOTTO produce su una risposta (`GroundingReport` in
 * `_shared/assistant/answer.ts`). È ridichiarata qui con i soli campi che
 * servono, perché questo modulo deve poter essere letto e provato senza
 * trascinarsi dietro il runtime dell'assistente.
 */
export interface DiagnosticaAncoraggio {
  /** Il verdetto del prodotto: true = nessun valore da contestare. */
  ok: boolean;
  unsupportedAmounts: string[];
  unsupportedDates: string[];
}

export interface RegoleDelCaso {
  /**
   * La DOMANDA nomina una finestra temporale («nei prossimi 90 giorni»,
   * «questa settimana»). Vale SOLO per le date.
   */
  allowDerivedDates?: boolean;
}

/**
 * I valori che rendono la risposta inaccettabile. Elenco vuoto = nessun
 * problema di ancoraggio.
 *
 * TRE REGOLE, e ognuna è stata pagata:
 *
 * 1. **Se il prodotto dice `ok`, la valutazione non lo contraddice.** Oggi
 *    `ok` è derivato dai due elenchi, quindi la condizione è ridondante — ma
 *    se un giorno il prodotto introducesse una tolleranza, ignorarlo
 *    rifarebbe l'errore che questo file esiste per chiudere: una prova più
 *    severa del prodotto che valuta.
 *
 * 2. **Un IMPORTO non ancorato è sempre un difetto.** È denaro che chi legge
 *    non può risalire a nessuna fonte, ed è il caso che il modulo esiste per
 *    impedire. Nessun caso lo esenta.
 *
 * 3. **Una DATA non ancorata a volte è la domanda ridichiarata.** A «quali
 *    contratti si rinnovano nei prossimi 90 giorni?» l'assistente può
 *    rispondere «nessuno (finestra dal 30.07.2026)»: quella data non sta in
 *    nessuna fonte perché è il BORDO della finestra chiesta, non un fatto
 *    inventato. `allowDerivedDates` si dichiara sul singolo caso e solo dove
 *    è la domanda a nominare una finestra — non è un interruttore generale.
 */
export function valoriNonAncorati(
  diagnostica: DiagnosticaAncoraggio | null | undefined,
  regole: RegoleDelCaso = {},
): string[] {
  if (!diagnostica) return [];
  if (diagnostica.ok) return [];

  const importi = diagnostica.unsupportedAmounts ?? [];
  const date = regole.allowDerivedDates ? [] : diagnostica.unsupportedDates ?? [];
  return [...importi, ...date];
}
