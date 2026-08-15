// ============================================================================
// Barre orizzontali — il grafico più semplice che questo prodotto usa.
//
// Stava dentro HomePage. Dal 2026-08-15 le statistiche dei documenti vivono
// nell'archivio (§37: la Panoramica è una schermata d'azione) e la Panoramica
// tiene solo «Scadenze in arrivo»: due schermate, un disegno solo. Copiarlo
// avrebbe voluto dire due grafici che si somigliano finché qualcuno non ne
// tocca uno.
// ============================================================================
export interface BarRow { cat: string; val: number; cls?: string; dotCls?: string }

/**
 * La lunghezza è la QUOTA SUL TOTALE della serie, non sul valore più alto:
 * normalizzando sul massimo, un solo documento riempiva la barra fino in fondo
 * e sembrava «tanto». Con il totale al denominatore la lunghezza dice qualcosa
 * di vero — quanta parte dell'insieme sta in questa riga — e il numero accanto
 * resta il dato esatto.
 */
export function Bars({ rows }: { rows: BarRow[] }) {
  const total = rows.reduce((n, r) => n + r.val, 0);
  return (
    <>
      {rows.map((r) => (
        <div className="bar-row" key={r.cat}>
          <div className="bar-cat">{r.dotCls && <span className={`bar-dot ${r.dotCls}`} />}{r.cat}</div>
          <div className="bar-track">
            {/* A zero non si disegna nulla: una barra minima mostrerebbe una
                quantità che non c'è. */}
            {r.val > 0 && <div className={`bar-fill ${r.cls ?? ''}`} style={{ width: `${Math.round((r.val / total) * 100)}%` }} />}
          </div>
          <div className="bar-val">{r.val}</div>
        </div>
      ))}
    </>
  );
}
