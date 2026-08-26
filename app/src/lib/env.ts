// Variabili d'ambiente del frontend. Solo la chiave ANON pubblica: la sicurezza
// reale è nelle policy RLS del database.
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;

// True solo se entrambe presenti e non ancora ai valori placeholder di .env.example.
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('YOUR-PROJECT') && !anonKey.startsWith('your-'),
);

// Fase 2 — quale motore d'analisi usare. NB (§60): nessun fallback nascosto.
// Se l'AI non è disponibile in modalità 'ai', l'analisi FALLISCE in modo esplicito;
// non produciamo mai un risultato deterministico spacciandolo per AI.
//   'ai'            (default) solo AI reale, server-side. Fallimento → stato di errore.
//   'deterministic' scelta ESPLICITA: motore locale, nessun dato lascia Supabase.
//                   Chiaramente etichettato "Motore locale", non è un fallback.
export type AnalysisProviderMode = 'ai' | 'deterministic';
const rawMode = (import.meta.env.VITE_ANALYSIS_PROVIDER ?? 'ai').trim();
export const ANALYSIS_PROVIDER: AnalysisProviderMode = rawMode === 'deterministic' ? 'deterministic' : 'ai';

// ---------------------------------------------------------------------------
// Blocco C / decisione D-10: Contratti, Clienti e Finanze (e i due modelli di
// automazione sulle trattative) sono FUORI dal perimetro dichiarato — restano
// nel codice ma non ricevono più sviluppo. Il flag li tiene nascosti senza
// cancellarli: le rotte restano registrate (una rotta nascosta non è un
// permesso — il cancello vero è la RLS), spariscono solo le porte in UI.
// Default: nascosti. `VITE_LEGACY_MODULES=on` li riaccende per lavorarci.
export const LEGACY_MODULES_ENABLED = (import.meta.env.VITE_LEGACY_MODULES ?? '').trim() === 'on';

// ---------------------------------------------------------------------------
// URL pubblico CANONICO dell'applicazione, usato per costruire i link inviati
// per email (conferma registrazione, reimposta password).
//
// Perché non basta `window.location.origin`: l'origine da cui l'utente apre
// l'app può non essere quella canonica (www vs senza www, un dominio di preview,
// un IP in rete locale). Supabase accetta il redirect solo se l'origine è
// nell'allowlist del progetto: se non lo è, il link nell'email punta al Site URL
// e l'utente finisce altrove. Fissando l'URL canonico i link sono deterministici.
//
// In sviluppo si lascia vuoto: si usa l'origine corrente (localhost:5174).
const rawSite = (import.meta.env.VITE_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '');
export const PUBLIC_SITE_URL = rawSite && !rawSite.includes('YOUR-') ? rawSite : null;

/** Base per i link nelle email: URL canonico se configurato, altrimenti origine corrente. */
export function publicUrl(path: string): string {
  const base = PUBLIC_SITE_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
