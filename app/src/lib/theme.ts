// ============================================================================
// Il tema dell'interfaccia: chiaro, scuro, o quello del sistema.
//
// PERCHÉ IL PREDEFINITO È CHIARO, E NON «QUELLO CHE HA IL COMPUTER».
// L'aspetto predefinito del prodotto è una decisione di prodotto. Una fiduciaria
// che mostra l'app a un cliente, uno screenshot in un'offerta, una demo e un
// foglio stampato devono avere lo stesso aspetto — e dev'essere quello scelto
// qui, non quello che aveva in quel momento il portatile di chi guardava. Fino
// al 2026-08-16 decideva il sistema operativo e l'app non dichiarava nulla.
// «Segui il sistema» resta, perché chi vuole lo scuro ha spesso buone ragioni:
// ma è una scelta, non il predefinito.
//
// DUE ATTRIBUTI, E LA DIFFERENZA CONTA.
//   `data-theme`      il tema RISOLTO: sempre e solo `light` o `dark`. È ciò su
//                     cui il CSS seleziona, ed è il motivo per cui il foglio di
//                     stile ha UN blocco scuro invece di due copie dei 36 token.
//   `data-theme-pref` la PREFERENZA: `chiaro`, `scuro`, `sistema`. È ciò che
//                     l'utente ha scelto, e ciò che si rilegge al ritorno.
// Con «sistema» i due divergono di proposito: la preferenza resta «sistema»
// mentre il tema risolto cambia sotto, quando il computer passa da chiaro a
// scuro. Tenerne uno solo vorrebbe dire non poter più distinguere «ha scelto
// scuro» da «il suo computer è scuro adesso».
//
// ⚠️ §49 — QUESTO STA IN `localStorage`, E PUÒ. La regola vieta i dati
// AZIENDALI nel browser: qui non c'è un dato dell'azienda, c'è come questa
// persona vuole vedere lo schermo di questo computer. È per definizione locale,
// non deve viaggiare, e perderlo non perde niente.
//
// ⚠️⚠️ LA COPIA CHE ESISTE, E PERCHÉ NON SI PUÒ TOGLIERE. La stessa logica sta
// anche in `index.html`, come script in linea: deve girare PRIMA della prima
// pittura, o il tema lampeggia al caricamento. Non c'è modo di eseguire un
// modulo dell'applicazione prima del primo fotogramma. La copia è quindi
// inevitabile, e non è lasciata alla buona volontà: `test:shell-unit` rilegge
// `index.html` come testo e pretende che chiave, valori e predefinito siano gli
// stessi di qui — se divergono, la suite è rossa.
// ============================================================================

/** Le tre preferenze. Il valore è una chiave, mai un'etichetta tradotta. */
export const TEMI = ['chiaro', 'scuro', 'sistema'] as const;
export type Tema = (typeof TEMI)[number];

/** ⚠️ Il predefinito del prodotto. Cambiarlo qui NON basta: vedi `index.html`. */
export const TEMA_PREDEFINITO: Tema = 'chiaro';

/** La chiave nel deposito locale. Prefissata: il dominio non è solo nostro. */
export const CHIAVE_TEMA = 'ai-swisse.tema';

/** Il tema risolto, cioè ciò che il CSS legge. */
export type TemaRisolto = 'light' | 'dark';

export function isTema(v: unknown): v is Tema {
  return typeof v === 'string' && (TEMI as readonly string[]).includes(v);
}

/**
 * La preferenza salvata, o il predefinito.
 *
 * ⚠️ Nessun fallback silenzioso travestito: un valore illeggibile o sconosciuto
 * NON è «scuro» né «sistema», è «non c'è una preferenza» — e senza preferenza
 * vale il predefinito del prodotto. `localStorage` può lanciare (Safari in
 * navigazione privata, cookie di terze parti bloccati in un iframe): anche lì
 * la risposta giusta è il predefinito, non una schermata bianca.
 */
export function leggiTema(): Tema {
  try {
    const v = localStorage.getItem(CHIAVE_TEMA);
    return isTema(v) ? v : TEMA_PREDEFINITO;
  } catch {
    return TEMA_PREDEFINITO;
  }
}

/**
 * Che cosa vede lo schermo, data una preferenza.
 *
 * È QUI che la media query rientra — con `matchMedia` e **solo** quando la
 * preferenza è «sistema». Scriverla invece nel foglio di stile avrebbe voluto
 * dire una seconda copia dei 36 token del tema scuro.
 */
export function risolviTema(pref: Tema): TemaRisolto {
  if (pref === 'chiaro') return 'light';
  if (pref === 'scuro') return 'dark';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Scrive il tema sul documento: i due attributi e il colore della barra del
 * telefono.
 *
 * ⚠️ `theme-color` non è decorazione: è il colore che il sistema dipinge
 * ATTORNO alla pagina. Fino a oggi erano due dichiarazioni legate a
 * `prefers-color-scheme`, e da quando l'app sceglie da sé sarebbero rimaste
 * legate al sistema — la barra del telefono scura sopra un'app chiara.
 */
export function applicaTema(pref: Tema): TemaRisolto {
  const risolto = risolviTema(pref);
  const r = document.documentElement;
  r.setAttribute('data-theme', risolto);
  r.setAttribute('data-theme-pref', pref);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', risolto === 'dark' ? '#1c232c' : '#ffffff');
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', risolto);
  return risolto;
}

// ---------------------------------------------------------------------------
// CHI GUARDA IL TEMA, e perché la preferenza non può stare in uno `useState`.
//
// ⚠️ IL DIFETTO CHE QUESTE VENTI RIGHE CHIUDONO, aperto e dichiarato il
// 2026-08-17. `ThemeSwitcher` teneva la preferenza in uno stato LOCALE, e
// nell'albero autenticato ce n'era più di una copia: colonna laterale e
// cassetto, e da oggi anche il pannello «Preferenze» della finestra delle
// impostazioni. Cambiando aspetto da una, le altre continuavano a mostrare il
// valore vecchio — l'app scura e la tendina che dice «Chiaro». Con la finestra
// le due copie si vedono nella STESSA schermata, quindi non è più un caso di
// bordo: è ciò che si vede.
//
// La preferenza non è uno stato di un componente: è uno stato del DOCUMENTO —
// sta in `localStorage` e negli attributi di `<html>`. Quindi vive qui, e i
// componenti la LEGGONO. `useSyncExternalStore` è la forma che React dà a
// questo, e non richiede un provider: funziona per una copia come per dieci.
type Ascoltatore = () => void;
const ascoltatori = new Set<Ascoltatore>();
let corrente: Tema | null = null;

/** Si iscrive ai cambi di preferenza. Restituisce la funzione per disdire. */
export function sottoscriviTema(cb: Ascoltatore): () => void {
  ascoltatori.add(cb);
  return () => { ascoltatori.delete(cb); };
}

/**
 * La preferenza corrente, STABILE fra un render e l'altro.
 *
 * ⚠️ La stabilità non è un dettaglio: `useSyncExternalStore` richiama questa
 * funzione a ogni render e confronta il risultato con `Object.is`. Restituire
 * ogni volta il valore letto da `localStorage` andrebbe comunque bene (è una
 * stringa), ma leggere il deposito a ogni render di ogni copia è lavoro
 * inutile: la cache si invalida solo quando qualcuno sceglie.
 */
export function temaCorrente(): Tema {
  if (corrente === null) corrente = leggiTema();
  return corrente;
}

/** Salva e applica. Il salvataggio che fallisce non impedisce di vedere il tema. */
export function scegliTema(pref: Tema): void {
  try {
    localStorage.setItem(CHIAVE_TEMA, pref);
  } catch {
    /* Deposito non disponibile: la scelta vale per questa sessione e basta. */
  }
  corrente = pref;
  applicaTema(pref);
  // Si avvisa DOPO aver applicato: chi ascolta deve trovare il documento già
  // nello stato nuovo, non a metà.
  for (const cb of ascoltatori) cb();
}
