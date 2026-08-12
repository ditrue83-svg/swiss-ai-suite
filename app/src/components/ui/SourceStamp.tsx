import { useT, type TKey } from '../../i18n';
import { MarkGlyph, type MarkGlyphName } from './MarkGlyph';
import type { SubsidyFreshness } from '../../types/database';

/**
 * FONTE — il timbro d'archivio: maiuscoletto spaziato + data in cifre
 * tabellari. La forma è quella del protocollo amministrativo, non il badge da
 * cruscotto. `demo` è il timbro a CORNICE: dichiara il dato dimostrativo con
 * la sobrietà di un timbro, non con l'ambra piena di un avviso.
 *
 * Gli stati sono quelli veri del dominio: i quattro di `SubsidyFreshness`
 * (⚠️ `unverified` non è «vecchia»: è «mai controllata») più `demo`, che nel
 * dominio è un'altra colonna. Aggiungere uno stato = una riga qui.
 */
export type SourceState = SubsidyFreshness | 'demo';

export const SOURCE_STATES: Record<SourceState, { cls: string; glyph: MarkGlyphName; labelKey: TKey }> = {
  fresh: { cls: 'ms-fresh', glyph: 'check', labelKey: 'incentives.freshness.fresh' },
  aging: { cls: 'ms-aging', glyph: 'question', labelKey: 'incentives.freshness.aging' },
  stale: { cls: 'ms-stale', glyph: 'bang', labelKey: 'incentives.freshness.stale' },
  unverified: { cls: 'ms-unverified', glyph: 'circleDashed', labelKey: 'incentives.freshness.unverified' },
  demo: { cls: 'ms-demo', glyph: 'circleDashed', labelKey: 'marks.source.demo' },
};

export function SourceStamp({ state, date }: { state: SourceState; date?: string | null }) {
  const t = useT();
  const k = SOURCE_STATES[state];
  return (
    <span className={`mark mark-src ${k.cls}`}>
      <MarkGlyph name={k.glyph} />
      {t(k.labelKey)}
      {date ? <span className="ms-date">· {date}</span> : null}
    </span>
  );
}
