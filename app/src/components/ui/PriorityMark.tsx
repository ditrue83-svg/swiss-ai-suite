import { useT, type TKey } from '../../i18n';
import { MarkGlyph, type MarkGlyphName } from './MarkGlyph';
import type { TaskPriority } from '../../types/models';

/**
 * PRIORITÀ — la DIREZIONE è il segno: due tratti in su, uno di lato, uno in
 * giù. Il grado si vede prima di leggere la parola, e si vede in bianco e nero.
 *
 * ⚠️ NON la triade di punti: quella è la CONFIDENZA. Erano già due significati
 * distinti (quanto è affidabile un'analisi / quanto conta un lavoro) e dare
 * loro lo stesso segno avrebbe rifatto, dentro il sistema nuovo, l'errore che
 * il sistema è nato per togliere.
 *
 * ⚠️ E NON IL ROSSO. Fino a oggi la priorità alta era `badge-alta`, cioè il
 * rosso degli errori: un lavoro importante non è un guasto, e il rosso in
 * questo prodotto vuol dire che qualcosa è andato storto nel mondo (una
 * scadenza mancata) o nell'interfaccia (un'analisi fallita). Qui il rinforzo
 * è il PESO dell'inchiostro, non l'allarme.
 *
 * Le etichette sono quelle di dominio (`labels.urgency`), le stesse della
 * tendina dei filtri: un quarto testo scritto a mano sarebbe il primo a
 * restare indietro in tedesco.
 *
 * Copre entrambe le scale ancora vive: `TaskPriority` (`low·medium·high`, la
 * colonna del database delle attività) e la terna `alta·media·bassa` che Admin
 * AI calcola per le azioni estratte. Sono due tipi
 * distinti e restano distinti — unificarli in TypeScript farebbe passare il
 * compilatore su un assegnamento che il database rifiuta — ma il SEGNO è uno.
 */
export type PriorityValue = TaskPriority | 'alta' | 'media' | 'bassa';

export const PRIORITY_LEVELS: Record<PriorityValue, { cls: string; glyph: MarkGlyphName; labelKey: TKey }> = {
  high: { cls: 'mo-high', glyph: 'levelUp', labelKey: 'labels.urgency.alta' },
  medium: { cls: 'mo-medium', glyph: 'levelFlat', labelKey: 'labels.urgency.media' },
  low: { cls: 'mo-low', glyph: 'levelDown', labelKey: 'labels.urgency.bassa' },
  // scala delle urgenze estratte da Admin AI
  alta: { cls: 'mo-high', glyph: 'levelUp', labelKey: 'labels.urgency.alta' },
  media: { cls: 'mo-medium', glyph: 'levelFlat', labelKey: 'labels.urgency.media' },
  bassa: { cls: 'mo-low', glyph: 'levelDown', labelKey: 'labels.urgency.bassa' },
};

export function PriorityMark({ level }: { level: PriorityValue }) {
  const t = useT();
  const k = PRIORITY_LEVELS[level];
  return (
    <span className={`mark mark-prio ${k.cls}`}>
      <MarkGlyph name={k.glyph} />
      {t(k.labelKey)}
    </span>
  );
}
