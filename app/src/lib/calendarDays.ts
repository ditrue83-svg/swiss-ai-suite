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

/**
 * IL RICONOSCITORE DELLA DATA PURA: `YYYY-MM-DD`, la forma con cui una colonna
 * `date` esce dal database — `due_date`, `appointment_date`, `document_date`,
 * `deadline`, e le decine di altre.
 *
 * ⚠️ ANCORATA ANCHE IN CODA. `2026-08-20T14:30:00Z` è un ISTANTE e va letto
 * come istante: convertirlo al giorno locale è esattamente ciò che si vuole.
 * Un'ancora solo in testa confonderebbe le due cose, che è il difetto opposto.
 */
const DATA_PURA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * La data pura come giorno LOCALE. `null` se il valore non è una data pura:
 * chi chiama prosegue con `new Date(value)`, che per un istante è giusto.
 *
 * ⚠️ È LA STESSA REGOLA DI `calendarDaysUntil`, LETTA DALL'ALTRO LATO. Lì
 * serve il giorno di calendario scritto nel dato, e si legge in UTC perché
 * mezzanotte UTC è come è stata scritta. Qui serve un istante che il
 * formattatore renda con QUEL giorno, e allora la si costruisce in locale:
 * `new Date('2026-08-20')` è mezzanotte UTC, e a ovest di Greenwich
 * `toLocaleDateString` la stampa come il 19.
 *
 * ⚠️⚠️ IL RITORNO SI VERIFICA. `new Date(2026, 1, 31)` non è un errore: JS
 * trabocca al 3 marzo. Senza il controllo, un `2026-02-31` — oggi reso «—»,
 * cioè «non si legge» — diventerebbe una data plausibile e sbagliata, che è
 * peggio di nessuna data.
 */
/**
 * La FORMA di una data pura, valida o no. Serve a chi deve distinguere «non è
 * una data pura» da «è una data pura che non esiste»: `giornoLocale` risponde
 * `null` a entrambe, ma le due meritano risposte diverse a schermo.
 */
export function sembraDataPura(value: string): boolean {
  return DATA_PURA.test(value);
}

export function giornoLocale(value: string): Date | null {
  const m = DATA_PURA.exec(value);
  if (!m) return null;
  const [anno, mese, giorno] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(anno, mese - 1, giorno);
  const tornaUguale = d.getFullYear() === anno && d.getMonth() === mese - 1 && d.getDate() === giorno;
  return tornaUguale ? d : null;
}
