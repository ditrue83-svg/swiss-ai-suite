// ============================================================================
// Illustrazioni degli stati vuoti — 2026-08-27.
//
// Lo stato vuoto è il primo schermo che un cliente nuovo vede: fino a ieri era
// la sola pastiglia `.ec-ico` con l'icona, identica ovunque. Queste scene la
// AFFIANCANO (non la sostituiscono: `EmptyCta` senza `art` resta com'è) dove
// il vuoto è il contenuto — archivio senza documenti, inbox senza messaggi.
//
// Regole della famiglia, perché restino riconoscibili:
//   · stessa anatomia delle icone di `Icon.tsx` portata a 120×90: contorni a
//     tratto, angoli morbidi, niente ombre disegnate a mano;
//   · solo colori dai token (`--accent-soft` per l'alone, `--accent-text` per
//     i tratti principali, `--line-strong` e `--muted` per i secondari,
//     `--accent` per l'UNICO segno pieno di ogni scena): il giorno che la
//     palette cambia, queste cambiano con lei;
//   · un solo accento pieno per scena — il punto che dice «qui succede
//     qualcosa», come l'azzurro dell'azione nel resto dell'app;
//   · `aria-hidden`: decorano, il messaggio lo portano titolo e didascalia.
// ============================================================================
import type { ReactNode } from 'react';

export type EmptyArtName = 'document' | 'inbox' | 'calendar' | 'opportunity';

const S = {
  alone: 'var(--accent-soft)',
  stroke: 'var(--accent-text)',
  faint: 'var(--line-strong)',
  paper: 'var(--card)',
  spot: 'var(--accent)',
} as const;

const SCENES: Record<EmptyArtName, ReactNode> = {
  // Un foglio piegato con la lente: l'archivio aspetta il primo documento.
  document: (
    <g>
      <circle cx="60" cy="45" r="38" fill={S.alone} />
      <path d="M44 18h20l12 12v42a2 2 0 0 1-2 2H44a2 2 0 0 1-2-2V20a2 2 0 0 1 2-2Z"
        fill={S.paper} stroke={S.stroke} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M64 18v12h12" fill="none" stroke={S.stroke} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M50 42h16M50 50h20M50 58h12" stroke={S.faint} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="78" cy="62" r="10" fill={S.paper} stroke={S.stroke} strokeWidth="2.5" />
      <path d="m85 69 7 7" stroke={S.stroke} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="78" cy="62" r="3.5" fill={S.spot} />
    </g>
  ),
  // La cassetta con la busta che arriva: l'inbox aspetta la prima lettera.
  inbox: (
    <g>
      <circle cx="60" cy="45" r="38" fill={S.alone} />
      <rect x="38" y="16" width="36" height="24" rx="3" fill={S.paper} stroke={S.stroke}
        strokeWidth="2.5" transform="rotate(-6 56 28)" />
      <path d="m40 20 17 12 15-13" fill="none" stroke={S.faint} strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" transform="rotate(-6 56 28)" />
      <path d="M28 58l6-16a3 3 0 0 1 2.8-2h34.4a3 3 0 0 1 2.8 2l6 16"
        fill={S.paper} stroke={S.stroke} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M28 58v12a3 3 0 0 0 3 3h58a3 3 0 0 0 3-3V58H76l-3 5H51l-3-5Z"
        fill={S.paper} stroke={S.stroke} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="60" cy="31" r="4" fill={S.spot} />
    </g>
  ),
  // Il mese con un solo giorno segnato: lo scadenzario aspetta il primo termine.
  calendar: (
    <g>
      <circle cx="60" cy="45" r="38" fill={S.alone} />
      <rect x="32" y="24" width="56" height="46" rx="4" fill={S.paper} stroke={S.stroke} strokeWidth="2.5" />
      <path d="M32 36h56" stroke={S.stroke} strokeWidth="2.5" />
      <path d="M44 18v8M76 18v8" stroke={S.stroke} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M42 46h8M56 46h8M70 46h8M42 58h8M70 58h8" stroke={S.faint} strokeWidth="2.5" strokeLinecap="round" />
      <rect x="54" y="53" width="12" height="10" rx="2.5" fill={S.spot} />
    </g>
  ),
  // Il banconota con la stella: le opportunità aspettano il primo progetto.
  opportunity: (
    <g>
      <circle cx="60" cy="45" r="38" fill={S.alone} />
      <rect x="28" y="34" width="64" height="34" rx="4" fill={S.paper} stroke={S.stroke} strokeWidth="2.5" />
      <circle cx="60" cy="51" r="8" fill="none" stroke={S.faint} strokeWidth="2.5" />
      <path d="M38 42v18M82 42v18" stroke={S.faint} strokeWidth="2.5" strokeLinecap="round" />
      <path d="m82 14 2.2 5.3 5.3 2.2-5.3 2.2L82 29l-2.2-5.3-5.3-2.2 5.3-2.2Z" fill={S.spot} />
    </g>
  ),
};

export function EmptyArt({ name }: { name: EmptyArtName }) {
  return (
    <svg className="ec-art" viewBox="0 0 120 90" width="120" height="90" aria-hidden="true" focusable="false">
      {SCENES[name]}
    </svg>
  );
}
