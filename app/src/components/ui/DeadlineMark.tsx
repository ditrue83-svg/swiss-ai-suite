import { useT, type TKey } from '../../i18n';
import { MarkGlyph, type MarkGlyphName } from './MarkGlyph';
import { calendarDaysUntil } from '../../lib/calendarDays';

/**
 * TERMINE — le CIFRE sono il segno: data tabellare + distanza in giorni.
 * Un termine non somiglia mai a uno stato di fiducia: là punti e filetti, qui
 * sempre numeri (o il tratto lungo di «nessuna scadenza»). Prima «Da
 * verificare» e «Scadenza 10.09.2026» erano la stessa pastiglia ambra.
 *
 * Lo scaduto è rosso e non è un'eccezione: un termine mancato è qualcosa che è
 * andato storto NEL MONDO. L'incertezza («data da verificare») resta ambra.
 *
 * `date` è l'ISO per il conto dei giorni; `display` è la data già formattata
 * dal chiamante (che ha il suo `formatDate` per la lingua giusta).
 */
export type DeadlineState = 'days' | 'soon' | 'today' | 'over' | 'none' | 'toVerify';

export const DEADLINE_STATES: Record<DeadlineState, { cls: string; glyph: MarkGlyphName; labelKey: TKey | null }> = {
  days: { cls: 'md-days', glyph: 'arrow', labelKey: 'marks.deadline.inDays' },
  soon: { cls: 'md-soon', glyph: 'arrow', labelKey: 'marks.deadline.inDays' },
  today: { cls: 'md-soon', glyph: 'bang', labelKey: 'marks.deadline.today' },
  over: { cls: 'md-over', glyph: 'bang', labelKey: 'marks.deadline.overdue' },
  none: { cls: 'md-none', glyph: 'dash', labelKey: 'marks.deadline.none' },
  toVerify: { cls: 'md-verify', glyph: 'question', labelKey: 'marks.deadline.toVerify' },
};

/**
 * Lo stato di un termine, come funzione pura: i casi limite si provano qui.
 *
 * ⚠️ IL CONTO DEI GIORNI NON È QUI. Sta in `lib/calendarDays`, insieme a quello
 * dell'appuntamento e a quello delle Attività: erano tre copie, e due —
 * questa e quella di `AppointmentMark` — leggevano la data con i getter LOCALI
 * su un istante che è mezzanotte UTC. A ovest di Greenwich una scadenza di
 * oggi si mostrava «scaduta ieri», in rosso.
 *
 * ⚠️ `today` È UN PARAMETRO e non `new Date()` letto dentro. Una funzione che
 * legge l'orologio da sé non si può provare su un istante scelto — è la stessa
 * ragione per cui `priorityFromDueDate` lo prende, ed è il difetto già pagato
 * dalla sezione 9 di `test:workflows-unit`. Da quando lo scadenziario ha
 * smesso di contare i giorni per conto suo (`overdueByDays`), questo è
 * l'UNICO conto del ritardo nel prodotto: provarlo non è un lusso.
 */
export function deadlineState(
  date: string | null,
  toVerify?: boolean,
  soonDays = 7,
  today: Date = new Date(),
): { state: DeadlineState; days: number | null } {
  if (!date) return { state: 'none', days: null };
  if (toVerify) return { state: 'toVerify', days: null };
  const days = calendarDaysUntil(date, today);
  // Una data che c'è ma non si legge non è «nessuna scadenza»: è una data da
  // verificare. Prima diventava `NaN` e la pagina scriveva «fra NaN giorni».
  if (days == null) return { state: 'toVerify', days: null };
  if (days < 0) return { state: 'over', days: -days };
  if (days === 0) return { state: 'today', days: 0 };
  return { state: days <= soonDays ? 'soon' : 'days', days };
}

export function DeadlineMark({ date, display, toVerify, soonDays }: {
  date: string | null;
  /** La data già formattata per la lingua corrente. Senza, si mostra solo la distanza. */
  display?: string | null;
  /** L'analisi dichiara che la data va verificata: non si presenta come un fatto. */
  toVerify?: boolean;
  soonDays?: number;
}) {
  const t = useT();
  const { state, days } = deadlineState(date, toVerify, soonDays);
  const k = DEADLINE_STATES[state];
  const distanza = state === 'days' || state === 'soon'
    ? (days === 1 ? t('marks.deadline.tomorrow') : t('marks.deadline.inDays', { n: days ?? 0 }))
    : state === 'over'
      ? (days === 1 ? t('marks.deadline.yesterday') : t('marks.deadline.overdue', { n: days ?? 0 }))
      : k.labelKey ? t(k.labelKey) : '';
  return (
    <span className={`mark mark-due ${k.cls}`}>
      <MarkGlyph name={k.glyph} />
      {display ? <>{display} · </> : null}
      {distanza}
    </span>
  );
}
