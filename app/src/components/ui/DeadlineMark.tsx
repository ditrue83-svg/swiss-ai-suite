import { useT, type TKey } from '../../i18n';
import { MarkGlyph, type MarkGlyphName } from './MarkGlyph';

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

/** Giorni interi da oggi alla data, nel fuso locale (le scadenze sono giorni civili, non istanti). */
function giorniA(dateIso: string): number {
  const oggi = new Date();
  const a = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate());
  const d = new Date(dateIso);
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Lo stato di un termine, come funzione pura: i casi limite si provano qui. */
export function deadlineState(date: string | null, toVerify?: boolean, soonDays = 7): { state: DeadlineState; days: number | null } {
  if (!date) return { state: 'none', days: null };
  if (toVerify) return { state: 'toVerify', days: null };
  const days = giorniA(date);
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
