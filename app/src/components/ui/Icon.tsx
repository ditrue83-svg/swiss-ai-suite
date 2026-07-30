// Icone SVG line (currentColor) — portate dal prototipo + alcune per la parte SaaS.
const ICONS = {
  logo: '<path d="M12 5v14M5 12h14"/>',
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.6V20h13V9.6"/>',
  dashboard: '<rect x="3" y="3" width="7.5" height="8" rx="1.2"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.2"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.2"/><rect x="3" y="14" width="7.5" height="7" rx="1.2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  document: '<path d="M6.5 3h6.5l5 5v12.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V3.5a.5.5 0 0 1 .5-.5Z"/><path d="M13 3v5h5"/>',
  banknote: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  archive: '<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5"/><path d="M10 12h4"/>',
  // Finanze (0021). Scartata `banknote`, che è già di Subsidy AI: due moduli
  // con la stessa icona nel menu si confondono a colpo d'occhio. Scartata anche
  // una moneta o un simbolo di valuta — il modulo NON muove denaro, e un'icona
  // che promette pagamenti è la prima cosa che una persona legge (§41).
  // Resta il documento con il bordo dentellato: una fattura, cioè un foglio.
  receipt: '<path d="M6 3.5h12v16.2l-2.4-1.4-2.4 1.4-2.4-1.4-2.4 1.4L6 19.7Z"/><path d="M9 8h6M9 11.5h6M9 15h3"/>',
  tag: '<path d="M3.6 11 11 3.6a2 2 0 0 1 1.4-.6H19a2 2 0 0 1 2 2v6.6a2 2 0 0 1-.6 1.4L13 20.4a2 2 0 0 1-2.8 0l-6.6-6.6a2 2 0 0 1 0-2.8Z"/><circle cx="16" cy="8" r="1.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12 2.5 2.5 4.7-5.2"/>',
  fileSearch: '<path d="M6.5 3h6l5 5v3.2"/><path d="M12.5 3v5h5"/><path d="M6.5 3A.5.5 0 0 0 6 3.5V21a.5.5 0 0 0 .5.5H12"/><circle cx="16.5" cy="16.5" r="2.7"/><path d="m18.6 18.6 1.9 1.9"/>',
  star: '<path d="m12 4 2.35 4.76 5.25.76-3.8 3.7.9 5.23L12 16.9l-4.7 2.47.9-5.23-3.8-3.7 5.25-.76z"/>',
  alert: '<path d="M12 4.8 20.5 19.5a1 1 0 0 1-.87 1.5H4.37a1 1 0 0 1-.87-1.5Z"/><path d="M12 10v4.2M12 17.5h.01"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6 6.5 7 20a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9l1-13.5M10 10v7M14 10v7"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  arrowRight: '<path d="M5 12h13M12.5 6.5 19 12l-6.5 5.5"/>',
  arrowLeft: '<path d="M19 12H6M11.5 6.5 5 12l6.5 5.5"/>',
  arrowUp: '<path d="M12 19V6M6.5 12.5 12 6l5.5 6.5"/>',
  arrowDown: '<path d="M12 5v13M6.5 11.5 12 18l5.5-6.5"/>',
  building: '<rect x="5" y="3.5" width="14" height="17" rx="1.2"/><path d="M9 7.5h.01M15 7.5h.01M9 11h.01M15 11h.01M9 14.5h.01M15 14.5h.01M10 20.5v-3h4v3"/>',
  inbox: '<path d="M4 13.5 6 5.5a1.5 1.5 0 0 1 1.45-1.1h9.1A1.5 1.5 0 0 1 18 5.5l2 8"/><path d="M4 13.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5.5h-5l-1.2 2H9.2L8 13.5Z"/>',
  logout: '<path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3"/><path d="M10 8 6 12l4 4M6 12h11"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  // Contratti (0024): un foglio con una riga di firma. ⚠️ NON un martelletto da
  // giudice né una bilancia: il modulo legge contratti, non amministra
  // giustizia, e l'icona non deve promettere una competenza che non c'è.
  fileSignature: '<path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z"/><path d="M14 3v4.5h4.5"/><path d="M8.5 16.5c1.2-1.6 2-2.4 2.6-2.4.8 0 .5 1.9 1.3 1.9.6 0 1-1 1.7-1 .6 0 .8.7 1.4.7"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  external: '<path d="M14 5h5v5"/><path d="M19 5 11 13"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 13.5-5.8L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.5 5.8L4 16"/><path d="M4 20v-4h4"/>',
  bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 3.2.7 4.9 1.6 6.1a.6.6 0 0 1-.5 1H4.9a.6.6 0 0 1-.5-1C5.3 14.4 6 12.7 6 9.5Z"/><path d="M9.8 19.5a2.4 2.4 0 0 0 4.4 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M4.9 7.8l1.7 1M17.4 15.2l1.7 1M4.9 16.2l1.7-1M17.4 8.8l1.7-1"/>',
  // Chiedi ad AI-Swisse (0027): un fumetto con un punto interrogativo.
  // ⚠️ NON una scintilla, una bacchetta magica o una testa di robot: quelle
  // icone promettono un'intelligenza che decide, e questo modulo non decide —
  // risponde a una domanda con le fonti accanto. ⚠️ Nemmeno una lente: `fileSearch`
  // ce l'ha già, e due voci di menu con la stessa forma si confondono a colpo
  // d'occhio (la regola che ha dato `receipt` a Finanze e `user` a Clienti).
  askAi: '<path d="M20.5 12.2a7.6 7.6 0 0 1-7.7 7.5 8.3 8.3 0 0 1-3.2-.6L4.5 20.5l1.4-4.4a7.3 7.3 0 0 1-1.4-4.3A7.6 7.6 0 0 1 12.4 4a7.7 7.7 0 0 1 8.1 8.2Z"/><path d="M10.3 9.6a2.2 2.2 0 0 1 4.2.7c0 1.5-2.1 1.9-2.1 3.1M12.4 16h.01"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`ic ${className ?? ''}`.trim()}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }}
    />
  );
}
