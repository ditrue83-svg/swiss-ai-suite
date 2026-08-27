// ============================================================================
// LA SCHEDA — il componente che formalizza i TRE LIVELLI di superficie
// (2026-08-27, issue #84).
//
// CHE COSA MANCAVA. I livelli esistevano come CLASSI (`.surface-1`,
// `.surface-2`, `.surface-3`, documentate nei token) ma non come componente:
// ogni schermata sceglieva la classe a occhio, e la scelta del livello — che
// nei token dichiara QUANTO PESA ciò che contiene — finiva per seguire la
// comodità del momento invece della gerarchia della pagina.
//
// I TRE LIVELLI, ripresi pari pari dai token perché la regola è quella:
//   elevated  (`.card` / `.surface-1`)  fondo proprio, bordo, ombra → si LEGGE
//   flat      (`.surface-2`)            nessun fondo, filetto sopra → si CONSULTA
//   inline    (`.surface-3`)            nessun contenitore → si SCORRE
// ⚠️ Sette schede identiche nella stessa pagina non fanno gerarchia, la fanno
// sparire: se tutto è `elevated`, il default non è una scelta, è un rumore.
// Il livello si sceglie dove si decide che cosa quel blocco conta.
//
// ⚠️ IL TITOLO È OPZIONALE DI PROPOSITO. `.card-title` veste il titolo di una
// scheda; un blocco `flat` o `inline` con un titolo grande sta dichiarando un
// peso che il suo livello non ha — se serve un titolo, quasi sempre il livello
// giusto era `elevated`. Il componente non lo vieta (ci sono casi legittimi)
// ma lo rende una decisione esplicita.
//
// ⚠️ `inline` Emette LE COPPIE chiave/valore, non testo libero: la classe
// `.surface-3` è costruita su `.sf-k` / `.sf-v` (etichetta maiuscola + valore,
// misura `--fs-meta`). Chi ha bisogno di una riga di prosa non sta scorrendo
// metadati: sta scrivendo testo, e la sua casa è il corpo della pagina.
// ============================================================================
import type { ReactNode } from 'react';

export type SurfaceLevel = 'elevated' | 'flat' | 'inline';

const LEVEL_CLASS: Record<SurfaceLevel, string> = {
  elevated: 'card',
  flat: 'surface-2',
  inline: 'surface-3',
};

export function Card({
  level = 'elevated',
  title,
  actions,
  className,
  children,
}: {
  level?: SurfaceLevel;
  /** Titolo del blocco, già tradotto. Vedi la testata: con `flat`/`inline` è una decisione, non un default. */
  title?: ReactNode;
  /** Azioni in testa alla scheda (pulsanti, menu): solo con `elevated`. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const cls = [LEVEL_CLASS[level], className ?? ''].filter(Boolean).join(' ');
  return (
    <section className={cls}>
      {(title || actions) && (
        <div className="card-title">
          {title}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Una coppia chiave/valore per il livello `inline`: etichetta + valore. */
export function Fact({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <>
      <span className="sf-k">{k}</span>
      <span className="sf-v">{v}</span>
    </>
  );
}
