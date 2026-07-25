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

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunction;
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
    setCurrentLocaleTag(LOCALE_TAG[locale]);
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

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t, localeTag: LOCALE_TAG[locale] }),
    [locale, setLocale, t],
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

/**
 * Locale corrente FUORI da React (utility di formattazione, servizi).
 * Tenuto allineato dal provider; il default resta it-CH.
 */
let currentTag = LOCALE_TAG.it;
export function setCurrentLocaleTag(tag: string) { currentTag = tag; }
export function getCurrentLocaleTag(): string { return currentTag; }
