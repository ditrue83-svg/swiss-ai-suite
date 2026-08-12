import { useT, type TKey } from '../../i18n';
import { MarkGlyph, type MarkGlyphName } from './MarkGlyph';
import type { Confidence } from '../../types/models';

/**
 * CONFIDENZA — la triade di punti: quanti sono PIENI è il segno (3·2·1), il
 * colore è rinforzo. Prima era una pastiglia colorata identica a quelle di
 * urgenza e scadenza: tre significati diversi, una sola forma.
 *
 * Le etichette sono quelle di dominio già esistenti (`labels.confidence`):
 * lo stato si dichiara in un posto solo. Aggiungere un livello = una riga qui.
 */
export const CONFIDENCE_LEVELS: Record<Confidence, { cls: string; glyph: MarkGlyphName; labelKey: TKey }> = {
  alta: { cls: 'mc-alta', glyph: 'dots3', labelKey: 'labels.confidence.alta' },
  media: { cls: 'mc-media', glyph: 'dots2', labelKey: 'labels.confidence.media' },
  bassa: { cls: 'mc-bassa', glyph: 'dots1', labelKey: 'labels.confidence.bassa' },
};

export function ConfidenceBadge({ level }: { level: Confidence }) {
  const t = useT();
  const k = CONFIDENCE_LEVELS[level];
  return (
    <span className={`mark mark-conf ${k.cls}`}>
      <MarkGlyph name={k.glyph} />
      {t(k.labelKey)}
    </span>
  );
}
