// ============================================================================
// LA NATURA DI UNA DATA, IN LETTURA. Modulo portabile, nessuna dipendenza.
//
// ⚠️⚠️ PERCHÉ ESISTE, E PERCHÉ NON BASTA LA REGOLA IN SCRITTURA.
//
// L'11 agosto è stata aggiunta al validatore la domanda «chi è obbligato da
// questa data?», su un caso vero: un'email di Stripe aveva prodotto «Scadenza
// 22.01.2027» da una data che era l'entrata in vigore di un listino. La regola
// era giusta e il test era verde. Il 15 agosto quella riga era ANCORA nel
// database con la sua scadenza sbagliata, perché il validatore gira quando si
// ANALIZZA, e nessuno rianalizza un documento archiviato tre settimane fa.
//
// È la seconda volta che questo progetto paga la stessa lezione (la prima è
// stata la regola sul titolo non mostrabile, applicata in scrittura dal 11/08 e
// arrivata in lettura solo il 15/08): **una regola applicata solo in scrittura
// non protegge i dati già scritti.** Quindi la domanda del 15 agosto — «che
// cosa È questa data?» — nasce con due lati: il validatore la pone al modello,
// e questo modulo la pone alla riga già salvata.
//
// ⚠️ La risposta in lettura NON reinterpreta il testo. Non può e non deve: per
// sapere se «10.09.2026» era un sopralluogo servirebbe rileggere il documento
// col modello, cioè produrre un'analisi nuova. Qui si constata una cosa sola,
// e strutturale: **quella riga ha risposto alla domanda, o no?** Una scadenza
// la cui natura non è mai stata dichiarata non è un fatto — è un dato che
// nessuno ha verificato, e va mostrato come tale.
//
// ⚠️ L'analisi NON si riscrive. È un verbale immutabile (0010): si legge
// meglio, non si corregge a posteriori. Una migrazione che «sistemasse» le
// righe vecchie starebbe mettendo in bocca al modello una risposta che il
// modello non ha mai dato.
// ============================================================================

/** Le nature che una riga può dichiarare. Vuoto/assente = nessuna risposta. */
const NATURE_DECLARED = new Set(['term', 'event', 'reference', 'none']);

/**
 * La scadenza di un'analisi già salvata può presentarsi come un fatto?
 *
 * `false` (cioè «va verificata») quando c'è una data ma nessuno ha dichiarato
 * che cosa fosse. Senza data non c'è niente da qualificare: la domanda non si
 * pone e la risposta è `true`.
 */
export function deadlineNatureDeclared(row: {
  deadline: string | null | undefined;
  deadlineKind: string | null | undefined;
}): boolean {
  if (!row.deadline) return true;
  return typeof row.deadlineKind === 'string' && NATURE_DECLARED.has(row.deadlineKind);
}

/**
 * Il flag «da verificare» EFFETTIVO di una riga letta dal database.
 *
 * Somma TRE cose che non si sovrappongono: ciò che il validatore aveva già
 * deciso quando l'analisi è stata scritta, ciò che si constata adesso
 * leggendola, e ciò che una persona ha fatto nel frattempo. Senza la seconda,
 * le analisi anteriori al 2026-08-15 continuerebbero a mostrare «scadenza ·
 * affidabilità alta» su date di cui nessuno ha mai stabilito la natura.
 *
 * ⚠️⚠️ E SENZA LA TERZA L'AVVISO NON SI POTEVA CHIUDERE (2026-08-19). I primi
 * due ingressi non si spengono mai: `deadline_kind` è NULL su tutte le analisi
 * anteriori al 15.08 — per costruzione, non per distrazione — e nessuna
 * schermata lo scrive. Il flag restava quindi vero PER SEMPRE, e la scheda del
 * documento mostrava sulla stessa riga la pastiglia «corretto da una persona»
 * e il segno «da verificare», senza alcun gesto capace di togliere il secondo.
 * Un avviso che non si può chiudere smette di essere un avviso.
 *
 * ⚠️ LA CORREZIONE PREVALE, e non è una deroga: è la precedenza già in vigore
 * per il mittente in `etichettaDocumento`, dove `mittenteCorretto` vince sulla
 * confidenza del modello. Chi ha corretto quella data l'ha GUARDATA, e la
 * constatazione automatica non ha più niente da aggiungere a chi ha visto il
 * documento. ⚠️ L'ingresso ASSENTE non vale «corretta»: non aver guardato non
 * è aver visto, ed è il motivo per cui il confronto è con `=== true` e non con
 * la verità di un valore che può arrivare `undefined` da una riga che quella
 * colonna non la porta affatto.
 *
 * ⚠️ NON RISCRIVE NIENTE. La correzione è un fatto NUOVO che si affianca al
 * verbale (`analysis_corrections`), non una modifica del verbale: l'analisi
 * resta immutabile (0010) e questa somma si rifà a ogni lettura.
 */
export function deadlineRequiresVerification(row: {
  deadline: string | null | undefined;
  deadlineKind: string | null | undefined;
  storedFlag: boolean;
  /** Una persona ha corretto questa scadenza (`analysis_corrections`, campo `deadline`). */
  corrected?: boolean;
}): boolean {
  if (row.corrected === true) return false;
  return row.storedFlag || !deadlineNatureDeclared(row);
}
