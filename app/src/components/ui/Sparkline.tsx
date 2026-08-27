// ============================================================================
// Sparkline — la serie storica in miniatura della striscia KPI (2026-08-26).
//
// ⚠️ ESISTE PER UNA SERIE SOLA: le analisi per settimana, l'unica grandezza
// della Panoramica che ha una storia leggibile (`document_analyses.created_at`).
// La regola del progetto — «un grafico su quattro numeri è decorazione» —
// non è cambiata: questa linea entra dove la serie ESISTE, e la card che non
// ha serie resta senza. Scritta a mano e non con una libreria: otto punti e
// una spezzata non comprano una dipendenza.
// ============================================================================

/** Quanti pixel di respiro lascia la linea dentro il viewBox, in verticale:
 *  lo stroke non deve mai toccare il bordo della card. */
const MARGINE = 3;

export function Sparkline({ data, width = 96, height = 28 }: {
  data: readonly number[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const passoX = (width - MARGINE * 2) / (data.length - 1);
  const utileY = height - MARGINE * 2;
  const punti = data.map((v, i) => {
    const x = MARGINE + i * passoX;
    // Lo zero tocca il fondo (meno il margine), il massimo il tetto: la forma
    // della settimana vuota resta visibile — una linea piatta «in mezzo»
    // racconterebbe una stabilità che non c'è.
    const y = MARGINE + utileY * (1 - v / max);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `M${MARGINE},${height - MARGINE} L${punti.join(' L')} L${(width - MARGINE).toFixed(1)},${height - MARGINE} Z`;
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <path className="sparkline-area" d={area} />
      <polyline className="sparkline-line" points={punti.join(' ')} />
    </svg>
  );
}
