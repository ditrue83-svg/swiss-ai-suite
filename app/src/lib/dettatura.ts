// ============================================================================
// Dettatura vocale (Fase 3.1, 2026-09-10) — Web Speech API, feature-detected.
//
// COSA FA: trascrive il parlato in una casella di testo MODIFICABILE. Non
// registra file, non invia niente da sola: il testo resta davanti alla
// persona finché non decide lei. «L'AI la struttura» è un gesto successivo
// (il pulsante «Struttura con AI» della nota rapida), non una conseguenza.
//
// COSA COPRE: Chrome/Edge/Android e Safari recenti (`webkitSpeechRecognition`).
// Firefox non ha l'API: lì il pulsante microfono NON COMPARE — la tastiera
// resta sempre la strada, la voce è una scorciatoia, mai l'unica via.
//
// ⚠️ Funziona solo se `Permissions-Policy` lo permette: `public/_headers`
// dichiara `microphone=(self)` dal 2026-09-10 — prima il microfono era negato
// a livello di header e NESSUN codice avrebbe potuto chiederlo.
// ============================================================================
import type { Locale } from '@/i18n';

/** Il pezzo dell'API che usiamo, dichiarato noi: i tipi DOM di TypeScript non
 *  conoscono `webkitSpeechRecognition`, e un `any` qui farebbe sparire il
 *  contratto proprio dove la disponibilità cambia da browser a browser. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((evento: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: ((evento: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Il costruttore, se il browser ne ha uno. NULL è una risposta, non un guasto. */
export function speechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null;
}

/** La lingua della dettatura è la lingua DELL'INTERFACCIA: chi detta parla la
 *  lingua in cui sta lavorando. Varianti svizzere, come LOCALE_TAG. */
export function linguaDettatura(locale: Locale): string {
  return { it: 'it-CH', de: 'de-CH', fr: 'fr-CH' }[locale];
}
