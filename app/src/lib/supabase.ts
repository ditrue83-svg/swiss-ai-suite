import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './env';
import { AppError } from './errors';

export type DbClient = SupabaseClient<Database>;

// Il client è creato solo se le env sono configurate: così l'app può comunque
// avviarsi e mostrare una schermata di configurazione invece di crashare.
export const supabase: DbClient | null = isSupabaseConfigured
  ? createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** Ritorna il client o lancia un AppError leggibile se le env mancano. */
export function requireSupabase(): DbClient {
  if (!supabase) {
    throw new AppError(
      'Configurazione mancante: imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nel file .env.',
    );
  }
  return supabase;
}
