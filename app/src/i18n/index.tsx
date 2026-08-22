// ============================================================================
// i18n — italiano · tedesco · francese, le tre lingue in cui una PMI svizzera
// riceve la posta amministrativa.
//
// Nessuna dipendenza esterna: il progetto ne ha cinque in tutto e una libreria
// i18n completa peserebbe più di tutto il resto della UI. Qui servono tre cose —
// dizionari, interpolazione, cambio lingua — e sono ~80 righe.
//
// La garanzia contro le traduzioni incomplete NON è un controllo a runtime ma il
// compilatore: `de.ts` e `fr.ts` sono tipizzati come `Dictionary`, quindi una
// chiave mancante rompe `npm run typecheck`. Non esistono fallback silenziosi
// che mostrerebbero l'italiano dentro un'interfaccia tedesca senza avvisare.
// ============================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { it, type Dictionary } from './locales/it';
import { de } from './locales/de';
import { fr } from './locales/fr';

export const LOCALES = ['it', 'de', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

/** Etichette nella lingua stessa: un utente tedesco cerca «Deutsch», non «Tedesco». */
export const LOCALE_LABEL: Record<Locale, string> = { it: 'Italiano', de: 'Deutsch', fr: 'Français' };

/** Locale BCP-47 per date e valute: la variante svizzera, non quella di IT/DE/FR. */
export const LOCALE_TAG: Record<Locale, string> = { it: 'it-CH', de: 'de-CH', fr: 'fr-CH' };

const DICTS: Record<Locale, Dictionary> = { it, de, fr };
const STORAGE_KEY = 'swissai.locale';

const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** Preferenza salvata → lingua del browser → italiano. */
function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch { /* storage non disponibile */ }
  try {
    for (const lang of navigator.languages ?? [navigator.language]) {
      const base = (lang ?? '').slice(0, 2).toLowerCase();
      if (isLocale(base)) return base;
    }
  } catch { /* navigator non disponibile */ }
  return 'it';
}

/** Percorso con punti dentro il dizionario: 'auth.login.title'. */
type Path<T> = T extends Record<string, unknown>
  ? { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Path<T[K]>}` }[keyof T & string]
  : never;
export type TKey = Path<Dictionary>;

// ---------------------------------------------------------------------------
// LE FORME PLURALI — le sceglie la LINGUA, non un `=== 1` scritto a mano.
//
// ⚠️⚠️ PERCHÉ NON BASTA `n === 1 ? una : molte`. In italiano e in tedesco lo
// zero vuole il plurale («0 termini», «0 Fristen»); in FRANCESE vuole il
// singolare («0 échéance»). Un ternario sul numero è quindi giusto in due
// lingue su tre, e la terza si rompe esattamente nel caso che questa pagina
// mostra più spesso: lo zero. La regola sta nelle tabelle CLDR, che il
// browser e Node hanno già dentro `Intl.PluralRules`, e questo progetto non
// aggiunge una libreria per una cosa che la piattaforma sa fare.
//
// ⚠️ E NON SI INTERPOLA UN NUMERO DENTRO UNA PAROLA GIÀ AL PLURALE: «{t}
// termini» dava «1 termini» a schermo. Ogni conteggio passa da una COPPIA di
// chiavi — `…One` e `…Many` — e il tipo qui sotto ammette solo le basi che
// hanno davvero entrambe: scriverne una sola non compila.
//
// Le categorie CLDR sono più di due (l'italiano e il francese hanno anche
// `many`, dal milione in su); il dizionario ne offre due, quindi tutto ciò che
// non è `one` prende la forma `Many`. È una scelta dichiarata, non una svista.
// ---------------------------------------------------------------------------
export type PluralBase = {
  [K in TKey]: K extends `${infer B}One`
    ? (`${B}Many` extends TKey ? B : never)
    : never;
}[TKey];

const PLURAL_RULES: Partial<Record<Locale, Intl.PluralRules>> = {};
function rules(locale: Locale): Intl.PluralRules {
  return (PLURAL_RULES[locale] ??= new Intl.PluralRules(LOCALE_TAG[locale]));
}

/** La chiave giusta per `n` nella lingua data: `…One` solo dove la lingua vuole
 *  il singolare. Esportata perché il banco di prova la interroga direttamente. */
export function pluralKey(base: PluralBase, n: number, locale: Locale): TKey {
  return `${base}${rules(locale).select(n) === 'one' ? 'One' : 'Many'}` as TKey;
}

function lookup(dict: Dictionary, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else return undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

export type TFunction = (key: TKey, vars?: Record<string, string | number>) => string;

/**
 * Un conteggio tradotto: la forma la sceglie la lingua, e `{n}` è già dentro.
 * `tn('home.tasksAppts', 3)` → «3 appuntamenti» · «3 Termine» · «3 rendez-vous».
 */
export type TPluralFunction = (
  base: PluralBase, n: number, vars?: Record<string, string | number>,
) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunction;
  tn: TPluralFunction;
  /** Tag BCP-47 corrente, per date e valute. */
  localeTag: string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  // L'attributo lang serve a screen reader, sillabazione e traduttori automatici.
  // Si allinea anche il tag usato dalle utility di formattazione fuori da React.
  useEffect(() => {
    document.documentElement.lang = locale;
    setCurrentLocale(locale);
    // Anche il titolo della scheda: fino al 2026-08-13 restava quello statico
    // di index.html — italiano per tutti, in un'app trilingue.
    document.title = translate('common.docTitle');
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* no-op */ }
  }, []);

  const t = useCallback<TFunction>((key, vars) => {
    // Il dizionario è completo per costruzione (typecheck): se una chiave manca
    // qui, è un errore di programmazione — si mostra la chiave, non si finge.
    const raw = lookup(DICTS[locale], key) ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  }, [locale]);

  const tn = useCallback<TPluralFunction>(
    (base, n, vars) => t(pluralKey(base, n, locale), { n, ...vars }),
    [t, locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t, tn, localeTag: LOCALE_TAG[locale] }),
    [locale, setLocale, t, tn],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n deve essere usato dentro <I18nProvider>');
  return ctx;
}

/** Scorciatoia per il caso più frequente: `const t = useT()`. */
export function useT(): TFunction {
  return useI18n().t;
}

/** La scorciatoia dei conteggi: `const tn = useTn()`. Non esiste una versione
 *  fuori da React perché nessun conteggio si formatta fuori da un componente. */
export function useTn(): TPluralFunction {
  return useI18n().tn;
}

/**
 * Lingua corrente FUORI da React. Serve a codice che non è un componente e non
 * può usare hook: le utility di formattazione e, soprattutto, `toUserMessage()`
 * — i messaggi d'errore vanno letti nella lingua dell'utente proprio nei momenti
 * in cui qualcosa è andato storto.
 * Il provider la tiene allineata; il default resta l'italiano.
 */
let currentLocale: Locale = 'it';
let currentTag = LOCALE_TAG.it;

export function setCurrentLocale(l: Locale) {
  currentLocale = l;
  currentTag = LOCALE_TAG[l];
}
export function setCurrentLocaleTag(tag: string) { currentTag = tag; }
export function getCurrentLocaleTag(): string { return currentTag; }

/** Traduzione fuori da React. Stessa regola di t(): chiave mancante → la chiave. */
export function translate(key: TKey, vars?: Record<string, string | number>): string {
  const raw = lookup(DICTS[currentLocale], key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}
