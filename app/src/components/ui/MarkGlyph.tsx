import type { ReactElement } from 'react';

/**
 * I glifi delle marcature di provenienza. Sono SVG interni e non caratteri:
 * il sottoinsieme del font servito non c'entra, `fonts:check` nemmeno, e la
 * forma è identica su ogni sistema. Griglia 14×14, tratto in `currentColor`
 * (il colore lo decide la classe della marcatura, che lo prende dai token).
 *
 * ⚠️ Un glifo non porta MAI il significato da solo: accompagna un'etichetta o
 * una forma di famiglia (filetto, triade, timbro, cifre). Chi non distingue i
 * colori distingue comunque le forme — è la regola del sistema, non un extra.
 */
const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<string, { viewBox: string; body: ReactElement }> = {
  /** Giudizio positivo (idoneità probabile, fonte verificata). */
  check: { viewBox: '0 0 14 14', body: <path {...STROKE} d="M2.75 7.5 5.5 10.25 11.25 3.75" /> },
  /** Giudizio negativo PROBABILE: il tratto, non il pieno. */
  cross: { viewBox: '0 0 14 14', body: <path {...STROKE} d="M3.5 3.5l7 7M10.5 3.5l-7 7" /> },
  /** Giudizio negativo DEFINITIVO: il pieno. La croce si ritaglia nel fondo. */
  crossFilled: {
    viewBox: '0 0 14 14',
    body: (
      <>
        <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="currentColor" stroke="none" />
        <path fill="none" stroke="var(--card)" strokeWidth="1.75" strokeLinecap="round" d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8" />
      </>
    ),
  },
  /** Da verificare: la domanda aperta. */
  question: {
    viewBox: '0 0 14 14',
    body: (
      <>
        <path {...STROKE} d="M4.5 5.1a2.5 2.5 0 1 1 3.68 2.2c-.72.4-1.18.86-1.18 1.6v.2" />
        <circle cx="7" cy="11.6" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  /** Attenzione misurata (fonte vecchia, termine scaduto). */
  bang: {
    viewBox: '0 0 14 14',
    body: (
      <>
        <path {...STROKE} d="M7 2.6v5.2" />
        <circle cx="7" cy="11.2" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  /** Assenza dichiarata (nessuna scadenza). */
  dash: { viewBox: '0 0 14 14', body: <path {...STROKE} d="M3 7h8" /> },
  /** Distanza nel tempo (giorni mancanti). */
  arrow: { viewBox: '0 0 14 14', body: <path {...STROKE} d="M2.6 7h7.6M7.4 3.8 10.6 7l-3.2 3.2" /> },
  /** La citazione: i caporali del testo originale. */
  quote: { viewBox: '0 0 14 14', body: <path {...STROKE} d="M3.2 4 6.2 7l-3 3M7.8 4l3 3-3 3" /> },
  /** Mai verificata: il cerchio che nessuno ha ancora chiuso. */
  circleDashed: { viewBox: '0 0 14 14', body: <circle {...STROKE} cx="7" cy="7" r="4.9" strokeDasharray="2.4 2.2" /> },
  /** La triade della confidenza: QUANTI sono pieni è il segno, non il colore.
   *  ⚠️ Il punto vuoto deve avere un FORO visibile: con raggio sotto i due
   *  pixel resi, pieno e vuoto erano la stessa cosa — visto in tema scuro. */
  dots3: {
    viewBox: '0 0 26 14',
    body: (
      <>
        <circle cx="4" cy="7" r="2.8" fill="currentColor" stroke="none" />
        <circle cx="13" cy="7" r="2.8" fill="currentColor" stroke="none" />
        <circle cx="22" cy="7" r="2.8" fill="currentColor" stroke="none" />
      </>
    ),
  },
  dots2: {
    viewBox: '0 0 26 14',
    body: (
      <>
        <circle cx="4" cy="7" r="2.8" fill="currentColor" stroke="none" />
        <circle cx="13" cy="7" r="2.8" fill="currentColor" stroke="none" />
        <circle cx="22" cy="7" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
      </>
    ),
  },
  dots1: {
    viewBox: '0 0 26 14',
    body: (
      <>
        <circle cx="4" cy="7" r="2.8" fill="currentColor" stroke="none" />
        <circle cx="13" cy="7" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <circle cx="22" cy="7" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
      </>
    ),
  },
};

export type MarkGlyphName = keyof typeof GLYPHS;

export function MarkGlyph({ name, className }: { name: MarkGlyphName; className?: string }) {
  const g = GLYPHS[name];
  return (
    <svg className={className ? `mk-glyph ${className}` : 'mk-glyph'} viewBox={g.viewBox} aria-hidden="true" focusable="false">
      {g.body}
    </svg>
  );
}
