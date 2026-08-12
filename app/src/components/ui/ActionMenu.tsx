// ============================================================================
// Menu di trabocco — dove va ciò che non deve competere con l'azione del momento.
//
// PERCHÉ ESISTE. Il dettaglio di un documento aveva sei pulsanti prima del
// contenuto, su tre righe, tutti dello stesso peso: fra «Analizza» e «Elimina»
// non c'era nessuna differenza visiva. Un pulsante distruttivo con lo stesso
// peso di quello che si deve premere non è una scelta offerta, è una trappola
// lasciata aperta. Qui dentro finiscono le azioni RARE (archivia, stampa,
// elimina); l'azione del momento resta fuori, sola e primaria.
//
// ⚠️ NON è un menu di navigazione e non ne imita la tastiera completa
// (frecce su/giù, home/end): sono da due a quattro voci, e il Tab del browser
// le percorre già nell'ordine giusto. Ciò che invece serve — e che un pannello
// che si chiude solo ripremendo il pulsante non ha — è la chiusura con Esc e
// con un clic fuori, con il fuoco che TORNA al pulsante. È la stessa regola
// della campanella, e sta scritta due volte perché sono due componenti; se
// nascesse un terzo pannello, il posto giusto sarebbe un hook condiviso.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';

export interface ActionMenuItem {
  /** Chiave di React e nient'altro: l'etichetta la porta `label`. */
  key: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /** Distruttiva: colore del testo, mai un fondo pieno — qui non si grida. */
  danger?: boolean;
  disabled?: boolean;
  /** Perché la voce è spenta. Un comando disattivato senza motivo sembra rotto. */
  hint?: string;
}

interface Props {
  /** Etichetta accessibile del pulsante: «Altre azioni». */
  label: string;
  items: ActionMenuItem[];
}

export function ActionMenu({ label, items }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // Un menu senza voci non è un menu vuoto: è un pulsante che non fa niente.
  if (items.length === 0) return null;

  return (
    <div className="menu-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" className="ic-sm" />
      </button>

      {open && (
        <div className="menu-panel" ref={panelRef} role="menu" aria-label={label}>
          {items.map((it) => (
            <div key={it.key}>
              <button
                type="button"
                role="menuitem"
                className={`menu-item${it.danger ? ' is-danger' : ''}`}
                disabled={it.disabled}
                onClick={() => {
                  // Prima si chiude, poi si agisce: se l'azione naviga altrove,
                  // un pannello ancora aperto resterebbe sopra la pagina nuova.
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon ? <Icon name={it.icon} className="ic-sm" /> : null}
                <span>{it.label}</span>
              </button>
              {it.hint && <div className="menu-hint">{it.hint}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
