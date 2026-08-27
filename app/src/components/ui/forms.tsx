// ============================================================================
// Primitive di modulo — 2026-08-27.
//
// Prima di questo file ogni schermata riscriveva a mano lo stesso blocco:
// `<div className="field">` + `<label htmlFor>` + controllo + didascalia, e il
// legame fra label e campo (o fra errore e campo) dipendeva dalla memoria di
// chi scriveva. Qui il legame è COSTRUITO: `id` entra una volta e genera
// `htmlFor`, `aria-invalid` e `aria-describedby` da solo.
//
// Sono componenti SOTTILI come gli altri di questa cartella: niente logica di
// business, niente stato interno, le stringhe arrivano dal chiamante (l'app è
// i18n, qui non si traduce nulla). Lo stile è tutto nelle classi globali di
// `styles/app.css` ed `extra.css` (`.field`, `.field-hint`, `.field-error`,
// `.card`): questi componenti le compongono, non ne inventano di nuove.
//
// Come `states.tsx`, ciò che è decisione resta fuori: chi salva, chi valida e
// quando mostrare l'errore è affare della feature, non della primitiva.
// ============================================================================
import { forwardRef } from 'react';
import type {
  InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes,
} from 'react';

/* Le parti comuni: `id` è obbligatorio perché senza non esiste il legame
   label↔campo, e senza quello il modulo non si usa da tastiera né con un
   lettore di schermo. `error` vince su `hint`: i due non stanno mai insieme,
   perché `aria-describedby` punta a UN solo nodo e il messaggio urgente è
   l'errore. */
interface BaseFieldProps {
  id: string;
  label: ReactNode;
  /** Didascalia sotto il campo, sempre visibile (`.field-hint`). */
  hint?: ReactNode;
  /** Il guasto dell'ultimo tentativo: annunciato (`role="alert"), non solo colorato. */
  error?: ReactNode;
  /**
   * Classi EXTRA sul wrapper `.field` (es. `m-0` dentro barre e griglie fitte).
   * `className` resta del controllo: chi scrive `className` si aspetta che finisca
   * sull'input, e chi deve toccare il wrapper di solito deve togliere il margine.
   */
  fieldClassName?: string;
}

/* Il blocco `.field` con label, controllo e messaggio. Le primitive qui sotto
   lo condividono tutte: lo stato errore si dichiara in un posto solo. */
function FieldShell({ id, label, hint, error, fieldClassName, children }: BaseFieldProps & {
  children: (messageId: string | undefined) => ReactNode;
}) {
  const messageId = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={['field', fieldClassName ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={id}>{label}</label>
      {children(messageId)}
      {error
        ? <div className="field-error" id={`${id}-err`} role="alert">{error}</div>
        : hint
          ? <div className="field-hint" id={`${id}-hint`}>{hint}</div>
          : null}
    </div>
  );
}

/* `forwardRef` perché il fuoco programmatico (il modulo che si apre a metà
   pagina e mette il cursore nel primo campo) passa per il ref dell'`input`. */
export const Input = forwardRef<HTMLInputElement, BaseFieldProps & InputHTMLAttributes<HTMLInputElement>>(
  function Input({ id, label, hint, error, fieldClassName, ...rest }, ref) {
    return (
      <FieldShell id={id} label={label} hint={hint} error={error} fieldClassName={fieldClassName}>
        {(messageId) => (
          <input
            id={id}
            ref={ref}
            aria-invalid={error ? true : undefined}
            aria-describedby={messageId}
            {...rest}
          />
        )}
      </FieldShell>
    );
  },
);

export function Select({ id, label, hint, error, fieldClassName, children, ...rest }:
  BaseFieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} fieldClassName={fieldClassName}>
      {(messageId) => (
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export function Textarea({ id, label, hint, error, fieldClassName, ...rest }:
  BaseFieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} fieldClassName={fieldClassName}>
      {(messageId) => (
        <textarea
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

/* La spunta NON sta in `.field`: l'etichetta va accanto alla casella, non
   sopra, e impilarla come gli altri campi la farebbe sembrare un campo di
   testo. Segue il pattern `.task-check` già usato dalle liste di controllo. */
export function Checkbox({ id, label, hint, error, fieldClassName, ...rest }:
  BaseFieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <div className={['field', fieldClassName ?? ''].filter(Boolean).join(' ')}>
      <div className="task-check">
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          {...rest}
        />
        <label htmlFor={id}>{label}</label>
      </div>
      {error
        ? <div className="field-error" id={`${id}-err`} role="alert">{error}</div>
        : hint
          ? <div className="field-hint" id={`${id}-hint`}>{hint}</div>
          : null}
    </div>
  );
}

/* `.card` è il livello 1 delle superfici (`--surface-1`): lo stesso selettore
   della classe, non una copia. `title` è opzionale perché molte schede sono
   solo contenuto; quando c'è, porta il markup `.card-title` già previsto. */
export function Card({ title, className, children }: {
  title?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={['card', className ?? ''].filter(Boolean).join(' ')}>
      {title && <div className="card-title">{title}</div>}
      {children}
    </section>
  );
}
