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

// Fase 2 — quale motore d'analisi usare:
//   'auto'          (default) prova l'AI, ricade sul motore deterministico se non disponibile
//   'ai'            solo AI: se l'Edge Function non risponde, l'analisi fallisce con errore
//   'deterministic' solo motore locale (nessun dato lascia Supabase)
export type AnalysisProviderMode = 'auto' | 'ai' | 'deterministic';
const rawMode = (import.meta.env.VITE_ANALYSIS_PROVIDER ?? 'auto').trim() as AnalysisProviderMode;
export const ANALYSIS_PROVIDER: AnalysisProviderMode =
  rawMode === 'ai' || rawMode === 'deterministic' ? rawMode : 'auto';
