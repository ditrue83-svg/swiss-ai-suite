import { useT, type TKey } from '../../i18n';
import { MarkGlyph, type MarkGlyphName } from './MarkGlyph';
import { calendarDaysUntil } from '../../lib/calendarDays';

/**
 * APPUNTAMENTO — il giorno in cui qualcosa ACCADE.
 *
 * ⚠️⚠️ PERCHÉ NON È `DeadlineMark`. Le cifre sono le stesse — è pur sempre una
 * data — ma le due cose non sono due gradi della stessa: un termine è il bordo
 * oltre cui succede qualcosa di male, un appuntamento è un punto in cui
 * succede qualcosa e basta. Il 2026-08-15 il prodotto le confondeva, e
 * «Scadenza 10.09.2026 · fra 26 giorni» era in realtà un sopralluogo del
 * Comune. Da un segno identico nasce di nuovo la stessa confusione, quindi il
 * segno è diverso: glifo `pin` (un momento fissato) invece di `arrow` (la
 * distanza da un termine), e la parola «Appuntamento» sempre scritta.
 *
 * ⚠️ NIENTE ROSSO PER IL PASSATO, e non è una svista. Un termine scaduto è
 * qualcosa che è andato storto; un appuntamento passato è semplicemente
 * passato — il sopralluogo c'è stato. Colorarlo di allarme inventerebbe un
 * problema che il dato non dichiara.
 */
export type AppointmentState = 'future' | 'soon' | 'today' | 'past';

/**
 * Lo stato di un appuntamento, come funzione pura.
 *
 * ⚠️ `today` È UN PARAMETRO, per la stessa ragione di `deadlineState`: una
 * funzione che legge l'orologio da sé non si può provare su un istante scelto.
 *
 * ⚠️ E il conto dei giorni è QUELLO CONDIVISO, non una terza copia: la copia
 * che stava qui era identica a quella di `DeadlineMark`, sbagliata nello stesso
 * modo — la data letta con i getter locali su mezzanotte UTC.
 */
export function appointmentState(
  date: string | null,
  soonDays = 7,
  today: Date = new Date(),
): { state: AppointmentState; days: number | null } {
  if (!date) return { state: 'past', days: null };
  const days = calendarDaysUntil(date, today);
  // Non si legge: non si inventa una distanza. Il segno non si mostra (sotto).
  if (days == null) return { state: 'past', days: null };
  if (days < 0) return { state: 'past', days: -days };
  if (days === 0) return { state: 'today', days: 0 };
  return { state: days <= soonDays ? 'soon' : 'future', days };
}

/**
 * La mappa della famiglia, nella forma delle altre otto: `test:shell-unit` la
 * importa per verificare che ogni stato abbia il suo glifo, la sua regola in
 * `app.css` e la sua parola in it/de/fr. Una famiglia che non la esporta
 * resterebbe fuori da tutti e tre i controlli.
 */
export const APPOINTMENT_STATES: Record<AppointmentState, { cls: string; glyph: MarkGlyphName; labelKey: TKey }> = {
  future: { cls: 'ma-future', glyph: 'pin', labelKey: 'marks.appointment.inDays' },
  soon: { cls: 'ma-soon', glyph: 'pin', labelKey: 'marks.appointment.inDays' },
  today: { cls: 'ma-today', glyph: 'pin', labelKey: 'marks.appointment.today' },
  past: { cls: 'ma-past', glyph: 'pin', labelKey: 'marks.appointment.daysAgo' },
};

export function AppointmentMark({ date, display, soonDays }: {
  date: string | null;
  /** La data già formattata per la lingua corrente. */
  display?: string | null;
  soonDays?: number;
}) {
  const t = useT();
  if (!date) return null;
  const { state, days } = appointmentState(date, soonDays);
  // ⚠️ Una data che non si legge non diventa «0 giorni fa»: il segno non compare.
  // È la stessa scelta della riga sopra per una data assente.
  if (days == null) return null;
  const distanza = state === 'today'
    ? t('marks.appointment.today')
    : state === 'past'
      ? (days === 1 ? t('marks.appointment.yesterday') : t('marks.appointment.daysAgo', { n: days ?? 0 }))
      : (days === 1 ? t('marks.appointment.tomorrow') : t('marks.appointment.inDays', { n: days ?? 0 }));
  return (
    <span className={`mark mark-appt ${APPOINTMENT_STATES[state].cls}`}>
      <MarkGlyph name={APPOINTMENT_STATES[state].glyph} />
      {/* La parola c'è SEMPRE: senza, restano cifre indistinguibili da un
          termine, ed è esattamente il difetto che questo segno esiste per
          togliere. */}
      {t('marks.appointment.label')}
      {display ? <> · {display}</> : null}
      {' · '}{distanza}
    </span>
  );
}
