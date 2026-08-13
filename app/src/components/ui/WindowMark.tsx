import { useT, type TKey } from '../../i18n';
import { MarkGlyph, type MarkGlyphName } from './MarkGlyph';
import type { SubsidyCallStatus } from '../../types/database';

/**
 * FINESTRA DI CANDIDATURA — la forma è la PARENTESI: l'etichetta sta dentro
 * `[ ]`, che è il disegno di una finestra che si apre e si chiude. Nessun'altra
 * famiglia porta parentesi, e si riconoscono a stampa in bianco e nero.
 *
 * ⚠️ NON è un TERMINE, e non deve somigliargli. Il termine è una data e una
 * distanza in giorni (cifre tabellari); la finestra è lo STATO del bando: può
 * essere aperta senza avere una scadenza dichiarata, e può avere una scadenza
 * pur essendo chiusa. Erano la stessa pastiglia neutra, e quindi la stessa cosa.
 *
 * ⚠️ `unknown` NON è un ripiego: significa che la fonte non dichiara se la
 * finestra sia aperta, e mostrarla come aperta o come chiusa sarebbe in
 * entrambi i casi un'invenzione. È il valore che porta il modulo 1.0, dove la
 * finestra esiste solo come frase («domande entro il 31.03 di ogni anno») e
 * nessuno ha controllato oggi se sia davvero aperta.
 *
 * Le etichette sono quelle di dominio già esistenti (`incentives.callStatus`):
 * un posto solo. Aggiungere uno stato = una riga qui, e la legenda si aggiorna.
 */
export const WINDOW_STATES: Record<SubsidyCallStatus, { cls: string; glyph: MarkGlyphName; labelKey: TKey }> = {
  open: { cls: 'mn-open', glyph: 'check', labelKey: 'incentives.callStatus.open' },
  upcoming: { cls: 'mn-upcoming', glyph: 'arrow', labelKey: 'incentives.callStatus.upcoming' },
  continuous: { cls: 'mn-continuous', glyph: 'arrowBoth', labelKey: 'incentives.callStatus.continuous' },
  closed: { cls: 'mn-closed', glyph: 'crossFilled', labelKey: 'incentives.callStatus.closed' },
  suspended: { cls: 'mn-suspended', glyph: 'bang', labelKey: 'incentives.callStatus.suspended' },
  unknown: { cls: 'mn-unknown', glyph: 'question', labelKey: 'incentives.callStatus.unknown' },
};

export function WindowMark({ status }: { status: SubsidyCallStatus }) {
  const t = useT();
  const k = WINDOW_STATES[status];
  return (
    <span className={`mark mark-win ${k.cls}`}>
      <MarkGlyph name={k.glyph} />
      {t(k.labelKey)}
    </span>
  );
}
