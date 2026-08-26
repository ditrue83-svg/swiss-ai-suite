/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ANALYSIS_PROVIDER?: 'auto' | 'ai' | 'deterministic';
  readonly VITE_LEGACY_MODULES?: 'on' | 'off';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
