import { useT, type TKey } from '../../i18n';
import { MarkGlyph, type MarkGlyphName } from './MarkGlyph';
import type { TaskStatus } from '../../types/models';

/**
 * STATO DEL LAVORO — la casella che si riempie: vuota · a metà · in pausa ·
 * spuntata. È una PROGRESSIONE, e si legge come tale senza colore.
 *
 * PERCHÉ ESISTE. Nell'elenco delle attività «Da fare», «media» e «fra 28
 * giorni» erano tre pastiglie identiche: uno STATO, una PRIORITÀ e un TERMINE
 * con la stessa forma e tre colori: chi non distingue i colori leggeva tre
 * etichette qualsiasi in fila. Sono tre domande diverse — a che punto è, quanto
 * conta, entro quando — e ora sono tre famiglie di segni diverse.
 *
 * ⚠️ Le etichette sono quelle di dominio già esistenti (`tasks.status*`), le
 * stesse della tendina del dettaglio: lo stato si dichiara in un posto solo.
 * Aggiungere uno stato = una riga in TASK_STATES, e la legenda lo mostra da sé.
 */
export const TASK_STATES: Record<TaskStatus, { cls: string; glyph: MarkGlyphName; labelKey: TKey }> = {
  open: { cls: 'mw-open', glyph: 'boxOpen', labelKey: 'tasks.statusOpen' },
  in_progress: { cls: 'mw-doing', glyph: 'boxDoing', labelKey: 'tasks.statusInProgress' },
  waiting: { cls: 'mw-waiting', glyph: 'boxWaiting', labelKey: 'tasks.statusWaiting' },
  completed: { cls: 'mw-done', glyph: 'boxDone', labelKey: 'tasks.statusCompleted' },
};

export function StatusMark({ status }: { status: TaskStatus }) {
  const t = useT();
  const k = TASK_STATES[status];
  return (
    <span className={`mark mark-state ${k.cls}`}>
      <MarkGlyph name={k.glyph} />
      {t(k.labelKey)}
    </span>
  );
}
