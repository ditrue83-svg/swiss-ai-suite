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
  /**
   * Un momento FISSATO sulla linea del tempo: l'appuntamento.
   *
   * ⚠️ Deliberatamente diverso da `arrow`, che è la DISTANZA verso un termine.
   * Una data di sopralluogo e una scadenza non devono somigliarsi: la prima è
   * un punto in cui qualcosa accade, la seconda è il bordo oltre cui qualcosa
   * va storto. Il 2026-08-15 erano la stessa cosa, con le stesse cifre e lo
   * stesso segno, e da lì sono nate tre attività con la data sbagliata.
   */
  pin: {
    viewBox: '0 0 14 14',
    body: (
      <>
        <path {...STROKE} d="M2.4 11.4h9.2M7 11.4V4.6" />
        <circle cx="7" cy="3.2" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  /** Distanza nel tempo SENZA fine: la finestra sempre aperta. */
  arrowBoth: { viewBox: '0 0 14 14', body: <path {...STROKE} d="M1.8 7h10.4M4.4 4.4 1.8 7l2.6 2.6M9.6 4.4 12.2 7l-2.6 2.6" /> },
  /** Mai verificata: il cerchio che nessuno ha ancora chiuso. */
  circleDashed: { viewBox: '0 0 14 14', body: <circle {...STROKE} cx="7" cy="7" r="4.9" strokeDasharray="2.4 2.2" /> },

  /* -- STATO DEL LAVORO: LA CASELLA CHE SI RIEMPIE. ---------------------------
     Quattro volte lo stesso quadrato, e cambia solo quanto è pieno: è una
     PROGRESSIONE, e si legge come tale anche senza colore e senza parola.
     ⚠️ Non è un glifo di giudizio (quelli sono ✓ ✕ ?): un'attività «da fare»
     non è un verdetto negativo, e un'attività conclusa non è un'approvazione. */
  /** Da fare: la casella vuota. */
  boxOpen: { viewBox: '0 0 14 14', body: <rect {...STROKE} x="2.1" y="2.1" width="9.8" height="9.8" rx="2" /> },
  /** In corso: la metà sinistra è piena — il lavoro è cominciato, non finito. */
  boxDoing: {
    viewBox: '0 0 14 14',
    body: (
      <>
        <path d="M4.1 2.1h2.9v9.8H4.1a2 2 0 0 1-2-2V4.1a2 2 0 0 1 2-2z" fill="currentColor" stroke="none" />
        <rect {...STROKE} x="2.1" y="2.1" width="9.8" height="9.8" rx="2" />
      </>
    ),
  },
  /** In attesa: la casella in pausa. Il lavoro non è fermo per nostra scelta. */
  boxWaiting: {
    viewBox: '0 0 14 14',
    body: (
      <>
        <rect {...STROKE} x="2.1" y="2.1" width="9.8" height="9.8" rx="2" />
        <path {...STROKE} d="M5.7 5.2v3.6M8.3 5.2v3.6" />
      </>
    ),
  },
  /** Completata: la casella spuntata. */
  boxDone: {
    viewBox: '0 0 14 14',
    body: (
      <>
        <rect {...STROKE} x="2.1" y="2.1" width="9.8" height="9.8" rx="2" />
        <path {...STROKE} d="m4.5 7.2 1.9 1.9 3.3-4" />
      </>
    ),
  },

  /* -- PRIORITÀ: LA DIREZIONE È IL SEGNO. -------------------------------------
     ⚠️ NON una quantità di punti: quella è la CONFIDENZA, e due famiglie con
     lo stesso segno sono una famiglia sola letta male. Qui il segno è dove
     punta il tratto — su, di lato, giù — e la direzione si distingue a colpo
     d'occhio anche in bianco e nero, che i punti a distanza non fanno. */
  /** Alta: due tratti verso l'alto. Il raddoppio è il grado, non il colore. */
  levelUp: { viewBox: '0 0 14 14', body: <path {...STROKE} d="M3.2 7.2 7 3.4l3.8 3.8M3.2 11 7 7.2l3.8 3.8" /> },
  /** Media: il tratto di lato — né sopra né sotto la linea del lavoro. */
  levelFlat: { viewBox: '0 0 14 14', body: <path {...STROKE} d="M5.1 3.2 8.9 7l-3.8 3.8" /> },
  /** Bassa: un tratto verso il basso. */
  levelDown: { viewBox: '0 0 14 14', body: <path {...STROKE} d="M3.2 5 7 8.8 10.8 5" /> },
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

/**
 * I nomi dei glifi, a runtime. Serve a `test:shell-unit` per provare che ogni
 * famiglia di marcature chieda un glifo che esiste davvero: un nome sbagliato
 * in una mappa non è un errore di compilazione (le mappe sono tipizzate su
 * `MarkGlyphName`, ma una modifica al volo o un cast lo aggirano) e a schermo
 * si vede come un segno che manca — cioè come una marcatura senza forma, che è
 * esattamente ciò che questo sistema esiste per non avere.
 */
export const GLYPH_NAMES = Object.keys(GLYPHS) as MarkGlyphName[];

export function MarkGlyph({ name, className }: { name: MarkGlyphName; className?: string }) {
  const g = GLYPHS[name];
  return (
    <svg className={className ? `mk-glyph ${className}` : 'mk-glyph'} viewBox={g.viewBox} aria-hidden="true" focusable="false">
      {g.body}
    </svg>
  );
}
