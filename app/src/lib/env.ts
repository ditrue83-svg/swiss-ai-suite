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
