// ============================================================================
// I GIORNI DI CALENDARIO FRA OGGI E UNA DATA — una funzione, per tutti.
//
// ⚠️⚠️ PERCHÉ STA IN `_shared` E NON IN `src/lib`. Questa domanda se la fanno
// DUE RUNTIME: l'interfaccia (Inbox, Documenti, Contratti, Clienti, il motore
// di lettura) e le Edge Function (il motore delle Automazioni, che dall'urgenza
// di una scadenza fa scattare una regola). `src/lib/` da Deno non si importa;
// `_shared/` da tutti e tre — browser, Deno, Node — sì, ed è già il modo in cui
// `deadlineNature.ts` vive.
//
// ⚠️ MA LA COLLOCAZIONE NON DICE CHI CONSUMA. `deadlineNature.ts` sta qui ed è
// consumato SOLO dal frontend: chiunque debba stabilire se una modifica a
// questo file richieda un deploy tracci gli import, non guardi la cartella.
// Questo file, oggi, lo consumano davvero entrambi i lati — quindi toccarlo
// richiede sia una pubblicazione del frontend sia un deploy delle funzioni.
//
// ---------------------------------------------------------------------------
// IL CENSIMENTO CHE HA PORTATO QUI (2026-08-24). La stessa domanda aveva SEI
// risposte in questo albero, tre delle quali sbagliate nello stesso modo:
//
//   ✅ calendarDaysUntil   src/lib/calendarDays.ts      corretta, ed è questa
//   ❌ daysUntil           src/lib/format.ts            ms/86400
//   ❌ daysUntil           features/admin-ai/engine.ts  ms/86400
//   ~  daysUntil           features/contracts/…         giusta, ma copia
//   ~  daysUntil           features/crm/crmModel.ts     copia identica
//   ❌ daysUntilMs         _shared/automation/facts.ts  ms/86400
//
// ⚠️ IL DIFETTO, dimostrato e non dedotto. `Math.ceil((data - adesso)/86400000)`
// confronta due ISTANTI. `new Date('2026-08-25')` è mezzanotte UTC — è la
// norma per una data senza ora — e `Date.now()` è adesso. La sera del 24 agosto
// a Los Angeles (che in UTC è già il 25) il conto dà:
//
//     scadenza 2026-08-25 → daysUntil = 0        «scade oggi»
//                        → giorni di calendario = 1   «scade domani»
//
// Ogni scadenza risultava un giorno in ANTICIPO a chi apre l'app a ovest di
// Greenwich. A Zurigo il conto torna, ed è per questo che è vissuto tanto.
//
// ⚠️ E TUTTE le colonne che alimentano questi conti sono `date`, cioè date
// PURE: `document_analyses.deadline` (0002), `list_documents.deadline` (0017),
// `crm_opportunities.next_step_due_date` (0026), `email_messages.
// analysis_deadline` (0013). Non c'è un solo chiamante che passi un istante,
// quindi non c'è un caso in cui la vecchia aritmetica fosse quella giusta.
//
// ---------------------------------------------------------------------------
// LA REGOLA, e sta tutta nell'asimmetria delle due righe:
//   la DATA si legge in UTC     perché mezzanotte UTC è come è stata scritta;
//   OGGI si legge in LOCALE     perché «oggi» è il giorno di chi guarda.
// ============================================================================

/**
 * Giorni interi fra il giorno locale di `today` e il giorno della data.
 * Positivo nel futuro, `0` oggi, negativo nel passato.
 *
 * ⚠️ `today` È UN PARAMETRO e non `new Date()` letto dentro: una funzione che
 * legge l'orologio da sé non si può provare su un istante scelto. È la ragione
 * per cui le tre versioni sbagliate non erano provabili — e infatti nessuna
 * aveva un test che le vedesse cadere.
 *
 * `null` quando la data non c'è o non si legge: NON zero. «Nessuna scadenza» e
 * «scade oggi» sono due cose diverse, e confonderle è il fallback silenzioso
 * che questo progetto non ammette.
 */
export function calendarDaysUntil(
  dateIso: string | null | undefined,
  today: Date = new Date(),
): number | null {
  if (!dateIso) return null;
  const due = new Date(dateIso);
  if (Number.isNaN(due.getTime())) return null;
  const a = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86_400_000);
}
