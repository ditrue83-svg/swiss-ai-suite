// ============================================================================
// Il modulo di creazione di un'attività — UNO SOLO in tutto il prodotto.
//
// Prima esisteva dentro `TasksPage`, e il Calendario ci arrivava con la data
// nell'URL proprio per non averne un secondo (§17). Con la revisione del
// percorso «documento → attività» il modulo serve anche nel dettaglio di un
// documento: scriverlo lì una seconda volta avrebbe significato due posti in
// cui ricordarsi della priorità proposta, del titolo vuoto e del doppio invio.
//
// Il componente è SOTTILE di proposito: tutte le decisioni stanno in
// `taskCreateModel.ts`, che è puro e quindi provabile — in questo repository le
// suite sono script Node, senza DOM, e ciò che vive dentro un componente non lo
// verifica nessuna asserzione.
//
// È CONTROLLATO (valori + `onChange`) e non autonomo: chi lo usa deve poter
// decidere che cosa succede dopo il salvataggio — `TasksPage` azzera i campi e
// richiude il riquadro, il dettaglio di un documento mostra l'attività appena
// creata. Uno stato interno avrebbe reso quei due comportamenti indistinguibili.
// ============================================================================
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import {
  canSubmitTaskForm, effectivePriority, type TaskFormValues,
} from './taskCreateModel';
import type { AssignableMember, TaskPriority } from '@/types/models';

interface Props {
  values: TaskFormValues;
  onChange: (values: TaskFormValues) => void;
  /** Il salvataggio vero. Chi lo passa decide anche che cosa succede dopo. */
  onSubmit: () => void;
  /** Se c'è, compare «Annulla». Chi lo passa deve riportare il fuoco al pulsante che ha aperto il modulo. */
  onCancel?: () => void;
  saving: boolean;
  /** Il guasto dell'ULTIMO tentativo. Viene annunciato, non solo colorato. */
  error?: string | null;
  members: AssignableMember[];
  /**
   * Prefisso degli `id`. Due moduli nella stessa pagina con gli stessi `id`
   * romperebbero il legame `label`/campo, e con esso l'uso da tastiera.
   */
  idPrefix: string;
  /** Etichetta del pulsante di conferma: «Aggiungi» in elenco, «Crea attività» da un documento. */
  submitLabel?: string;
  /** Il fuoco entra nel primo campo quando il modulo compare. */
  autoFocus?: boolean;
}

export function TaskCreateForm({
  values, onChange, onSubmit, onCancel, saving, error, members, idPrefix,
  submitLabel, autoFocus,
}: Props) {
  const t = useT();
  const L = useLabels();
  const titleRef = useRef<HTMLInputElement>(null);

  // Il fuoco nel primo campo quando il modulo si apre. `autoFocus` come
  // attributo JSX non basta: il modulo compare a metà pagina dopo un clic, e in
  // quel caso il browser non lo applica in modo affidabile.
  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  const set = (patch: Partial<TaskFormValues>) => onChange({ ...values, ...patch });
  const canSubmit = canSubmitTaskForm(values, saving);
  // La priorità MOSTRATA è quella che verrà salvata: la scelta se c'è,
  // altrimenti la proposta della scadenza.
  const shownPriority = effectivePriority(values);

  return (
    <div className="grid-2">
      <div className="field">
        <label htmlFor={`${idPrefix}-title`}>{t('tasks.titleField')}</label>
        <input
          id={`${idPrefix}-title`} ref={titleRef} value={values.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={t('tasks.titlePlaceholder')}
          disabled={saving}
          required
          aria-required="true"
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-due`}>{t('tasks.dueLabel')}</label>
        <input
          id={`${idPrefix}-due`} type="date" value={values.dueDate}
          onChange={(e) => set({ dueDate: e.target.value })}
          disabled={saving}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-prio`}>{t('tasks.priorityLabel')}</label>
        <select
          id={`${idPrefix}-prio`} value={shownPriority}
          onChange={(e) => set({ priority: e.target.value as TaskPriority })}
          disabled={saving}
        >
          <option value="high">{L.urgency('alta')}</option>
          <option value="medium">{L.urgency('media')}</option>
          <option value="low">{L.urgency('bassa')}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-assignee`}>{t('tasks.assignee')}</label>
        <select
          id={`${idPrefix}-assignee`} value={values.assigneeUserId}
          onChange={(e) => set({ assigneeUserId: e.target.value })}
          disabled={saving}
        >
          <option value="">{t('tasks.unassigned')}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name || t('tasks.unnamedMember')}</option>
          ))}
        </select>
      </div>

      {/* Un guasto va ANNUNCIATO: chi usa un lettore di schermo non vede il
          riquadro rosso comparire sotto il pulsante. */}
      {error && (
        <div className="warn-box" role="alert" style={{ gridColumn: '1 / -1' }}>{error}</div>
      )}

      <div className="row-wrap" style={{ gridColumn: '1 / -1' }}>
        <button
          type="button"
          className="btn btn-primary btn-sm btn-block-mobile"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-busy={saving || undefined}
        >
          {saving ? <span className="spinner" aria-hidden="true" /> : <Icon name="plus" className="ic-sm" />}
          {' '}{submitLabel ?? t('tasks.add')}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-sm" onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
