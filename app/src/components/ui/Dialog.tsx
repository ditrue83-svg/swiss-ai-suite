// ============================================================================
// LA FINESTRA — il primo dialogo modale del progetto, e sta in un file suo
// perché un modale fatto male è un modale che INTRAPPOLA: chi naviga da
// tastiera esce dal riquadro e continua a tabulare dentro la pagina sotto,
// senza sapere dov'è. Le quattro cose che lo rendono un dialogo, e che nessuna
// libreria farà al posto nostro finché non ce n'è una:
//
//   1. `role="dialog"` + `aria-modal` + un NOME (`aria-labelledby`). Senza il
//      nome, un lettore di schermo annuncia «finestra di dialogo» e nient'altro.
//   2. IL FUOCO ENTRA all'apertura e TORNA da dove veniva alla chiusura. Un
//      fuoco che resta sul corpo della pagina fa ripartire la tabulazione
//      dall'inizio del documento, cioè dal marchio.
//   3. IL FUOCO NON ESCE finché è aperta: Tab sull'ultimo elemento torna al
//      primo, Maiusc+Tab sul primo va all'ultimo.
//   4. Esc chiude, e il velo dietro chiude. Sono due gesti che tutti provano.
//
// ⚠️ VA IN UN PORTALE, e non è estetica: la finestra nasce dentro la colonna
// laterale, che ha `position: sticky` e `overflow` propri. Un figlio in
// `position: fixed` dentro un antenato trasformato o con overflow viene
// ritagliato — il velo coprirebbe la colonna e basta. Il portale la appende al
// corpo del documento, dove `fixed` significa davvero «rispetto allo schermo».
//
// ⚠️ LO SCORRIMENTO DEL CORPO SI BLOCCA, con la stessa riga che l'AppShell usa
// già per il cassetto: senza, la rotella scorre la pagina SOTTO la finestra, e
// il contenuto che si vede non è quello con cui si sta lavorando.
// ============================================================================
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';

/** Ciò che può ricevere il fuoco dentro la finestra, nell'ordine del documento. */
const FUOCABILI = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Il titolo visibile, che è anche il NOME della finestra per chi non vede. */
  title: string;
  children: ReactNode;
  /** Classe sul riquadro, per chi ha bisogno di una misura sua. */
  className?: string;
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const t = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Da dove veniva il fuoco: ci torna alla chiusura.
  const provenienza = useRef<HTMLElement | null>(null);

  const elementiFuocabili = useCallback(
    () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FUOCABILI) ?? [])
      .filter((el) => el.offsetParent !== null || el === document.activeElement),
    [],
  );

  // (2) Il fuoco entra, e alla chiusura torna da dove veniva.
  //
  // ⚠️ SUBITO, NON AL PROSSIMO FOTOGRAMMA. La prima stesura chiamava
  // `requestAnimationFrame` — «prima che il riquadro sia dipinto il fuoco non
  // fa scorrere nulla» — e al banco il fuoco NON entrava mai: `rAF` è
  // sospeso quando il documento non è in primo piano (`document.hasFocus()`
  // falso), e una finestra che si apre senza fuoco lascia chi naviga da
  // tastiera fermo sul corpo della pagina, dietro il velo.
  // Un `useEffect` gira a DOM già montato: `.focus()` funziona lì, e la
  // scrollata dentro la vista la fa il browser da sé.
  useEffect(() => {
    if (!open) return;
    provenienza.current = document.activeElement as HTMLElement | null;
    const primi = elementiFuocabili();
    (primi[0] ?? panel.current)?.focus();
    return () => { provenienza.current?.focus?.(); };
  }, [open, elementiFuocabili]);

  // (4) Esc chiude · (3) Tab non esce.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const el = elementiFuocabili();
      if (el.length === 0) { e.preventDefault(); return; }
      const primo = el[0]!, ultimo = el[el.length - 1]!;
      // `document.activeElement` e non `e.target`: il fuoco può stare su un
      // elemento che non è quello che ha generato l'evento.
      const attivo = document.activeElement;
      if (!e.shiftKey && attivo === ultimo) { e.preventDefault(); primo.focus(); }
      else if (e.shiftKey && attivo === primo) { e.preventDefault(); ultimo.focus(); }
      else if (!panel.current?.contains(attivo)) { e.preventDefault(); primo.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose, elementiFuocabili]);

  // Lo scorrimento del corpo si ferma finché la finestra è aperta.
  useEffect(() => {
    if (!open) return;
    const prima = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prima; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="dialog-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panel}
        className={`dialog${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog-head">
          <h2 id={titleId} className="dialog-title">{title}</h2>
          <button className="dialog-close" onClick={onClose} aria-label={t('dialog.close')}>
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
