// ============================================================================
// I CAMPI — Field, Input, Select, Textarea (2026-08-27, issue #84).
//
// CHE COSA MANCAVA. `states.tsx` aveva già Button, gli stati vuoti e gli
// scheletri: ciò che non era un componente era il CAMPO. Ogni schermata
// scriveva a mano la stessa anatomia:
//   <div className="field"><label>…</label><input … /></div>
// e a scriverla a mano si sbaglia in tre posti, sempre gli stessi:
//   · l'etichetta non è COLLEGATA al controllo — `htmlFor` mancante o con un
//     id inventato due volte: chi naviga da tastiera o con lettore di schermo
//     sente il campo ma non il suo nome (WCAG 1.3.1 / 4.1.2);
//   · l'errore è solo un colore — `aria-invalid` c'è nel CSS (`.field input
//     [aria-invalid]` borda di `--red-dark`) ma nessuno lo imposta, perché
//     impostarlo a mano campo per campo non lo fa nessuno;
//   · il messaggio di errore non è ANNUNCIATO — serve `aria-describedby` verso
//     un nodo vivo, altrimenti appare sullo schermo e tace nel lettore.
// Con un componente le tre cose non si possono più omettere per distrazione:
// l'id lo genera il campo stesso, `aria-invalid` segue `error`, e il messaggio
// è collegato per costruzione. Il CSS non cambia di una riga: il markup emesso
// è esattamente quello che `.field` già veste.
//
// ⚠️ IL TESTO NON SI SCRIVE QUI E NON SI SCRIVE NEL CHIAMANTE: etichetta,
// aiuto ed errore arrivano già tradotti dai dizionari, come ovunque
// (`i18n:coverage` esce 1 se non è così). Questi componenti non traducono
// niente — ricevono già le parole.
//
// ⚠️ `error` È UNA STRINGA, NON UN BOOLEANO, ed è voluto: un campo invalido
// senza il PERCHÉ costringe chi compila a indovinare. Se non c'è niente da
// dire, il campo non è in errore. Chi vuole solo il bordo rosso sta
// dichiarando un'allerta muta — e quella non la costruiamo.
// ============================================================================
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldShellProps {
  /** L'etichetta visibile, già tradotta. */
  label: string;
  /** Messaggio di errore già tradotto: imposta aria-invalid e collega il messaggio. */
  error?: string;
  /** Riga di aiuto sotto il controllo: spiegazione, formato atteso, esempio. */
  hint?: string;
  /** Segna il campo come obbligatorio: testo dell'etichetta e aria-required. */
  required?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

/** L'anatomia comune: etichetta collegata, errore annunciato, aiuto descritto. */
function FieldShell({ label, error, hint, required, children }: FieldShellProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? ' *' : ''}
      </label>
      {children(id, describedBy)}
      {hint && <div id={hintId} className="field-hint">{hint}</div>}
      {error && (
        <div id={errorId} className="field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

interface FieldControlProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

export function Input({ label, error, hint, required, ...rest }: FieldControlProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required}>
      {(id, describedBy) => (
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function Select({ label, error, hint, required, children, ...rest }: FieldControlProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export function Textarea({ label, error, hint, required, ...rest }: FieldControlProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required}>
      {(id, describedBy) => (
        <textarea
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  );
}
