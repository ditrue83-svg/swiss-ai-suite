import { useT, type TKey } from '../../i18n';
import { MarkGlyph, type MarkGlyphName } from './MarkGlyph';
import type { EligibilityStatus, SubsidyEligibilityStatus } from '../../types/database';

/**
 * IDONEITÀ — glifo di giudizio + parola, SEMPRE insieme: fra «probabilmente
 * non idoneo» e «non idoneo» decide l'etichetta, il glifo dà la classe a colpo
 * d'occhio (? aperto · ✓ a tratto · ✕ a tratto · ✕ pieno). Il definitivo è
 * PIENO, il probabile è a tratto: la differenza si vede senza colore.
 *
 * Copre ENTRAMBE le scale del dominio — `EligibilityStatus` (schede incentivo)
 * e `SubsidyEligibilityStatus` (valutazione 2.0, dove non esiste `eligible`
 * di proposito: dichiarare idonea un'impresa spetta all'autorità, non a noi.
 * Le etichette restano quelle dei dizionari già esistenti: un posto solo.
 * Aggiungere uno stato = una riga qui, e la legenda si aggiorna da sola.
 */
export type EligibilityValue = EligibilityStatus | SubsidyEligibilityStatus;

export const ELIGIBILITY_STATES: Record<EligibilityValue, { cls: string; glyph: MarkGlyphName; labelKey: TKey }> = {
  // scala 1.0 (EligibilityStatus, etichette in subsidy.labels.eligibility)
  unknown: { cls: 'me-verify', glyph: 'question', labelKey: 'subsidy.labels.eligibility.unknown' },
  likely: { cls: 'me-yes', glyph: 'check', labelKey: 'subsidy.labels.eligibility.likely' },
  unlikely: { cls: 'me-unlikely', glyph: 'cross', labelKey: 'subsidy.labels.eligibility.unlikely' },
  ineligible: { cls: 'me-no', glyph: 'crossFilled', labelKey: 'subsidy.labels.eligibility.ineligible' },
  // scala della valutazione 2.0 (SubsidyEligibilityStatus)
  not_assessed: { cls: 'me-verify', glyph: 'question', labelKey: 'incentives.eligibility.notAssessed' },
  insufficient_information: { cls: 'me-verify', glyph: 'question', labelKey: 'incentives.eligibility.insufficient' },
  potentially_eligible: { cls: 'me-yes', glyph: 'check', labelKey: 'incentives.eligibility.potentially' },
  likely_ineligible: { cls: 'me-unlikely', glyph: 'cross', labelKey: 'incentives.eligibility.likelyIneligible' },
};

export function EligibilityMark({ status }: { status: EligibilityValue }) {
  const t = useT();
  const k = ELIGIBILITY_STATES[status];
  return (
    <span className={`mark mark-elig ${k.cls}`}>
      <MarkGlyph name={k.glyph} />
      {t(k.labelKey)}
    </span>
  );
}
