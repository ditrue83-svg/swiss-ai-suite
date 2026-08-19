// ============================================================================
// I giorni di CALENDARIO fra oggi e una data.
//
// ⚠️⚠️ PERCHÉ STA IN UN MODULO SUO. Questo conto esisteva in tre copie:
// `calendarDaysUntil` in `features/tasks/taskFormat.ts`, scritto bene, e due
// `giorniA` identici dentro `DeadlineMark` e `AppointmentMark`, scritti male
// nello stesso modo. Le due copie sbagliate erano nate copiandosi a vicenda, e
// nessuna delle due sapeva dell'altra né della prima. Tre aritmetiche della
// stessa domanda divergono sempre: quale sia in vantaggio dipende da chi ha
// toccato per ultimo il proprio file.
//
// ⚠️ IL DIFETTO, per esteso. `new Date('2026-08-20')` è mezzanotte UTC — è la
// norma per una data senza ora. Le due copie la rileggevano con i getter
// LOCALI: a New York quell'istante è il 19 agosto alle 20:00, quindi
// `getDate()` rispondeva 19. Una scadenza di OGGI risultava «scaduta ieri», in
// rosso, a chi apriva l'app da un fuso a ovest di Greenwich. A Zurigo il conto
// tornava, ed è il motivo per cui nessuno l'ha visto: il difetto non si vede da
// qui.
//
// La regola è una sola, e sta tutta nell'asimmetria delle due righe qui sotto:
// la DATA si legge in UTC (perché mezzanotte UTC è come è stata scritta), OGGI
// si legge in LOCALE (perché «oggi» è il giorno di chi guarda lo schermo).
// ============================================================================

/**
 * Giorni interi fra il giorno locale di `today` e il giorno della data.
 * Positivo nel futuro, `0` oggi, negativo nel passato.
 *
 * ⚠️ `today` È UN PARAMETRO e non `new Date()` letto dentro: una funzione che
 * legge l'orologio da sé non si può provare su un istante scelto.
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
