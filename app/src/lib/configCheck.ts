// ============================================================================
// Verifica che la configurazione Supabase sia non solo PRESENTE ma ACCETTATA.
//
// Perché esiste. `isSupabaseConfigured` (env.ts) controlla soltanto che le due
// variabili non siano vuote né segnaposto. Non basta: nel deploy del 2026-07-26
// in `VITE_SUPABASE_ANON_KEY` era finito il testo di un comando invece del suo
// risultato. Una stringa qualunque supera quel controllo, quindi l'app si è
// considerata configurata e ha mostrato una schermata di accesso perfettamente
// normale — che però non poteva funzionare. Nessun errore, nessuna spia: il
// guasto somigliava al funzionamento.
//
// Qui si chiede al server se quella chiave la accetta. È l'unica risposta che
// distingue «configurato» da «configurato con un valore che sembra buono».
//
// Ciò che NON facciamo: dedurre un guasto dal silenzio. Se il server non è
// raggiungibile non dichiariamo nulla di sbagliato — non lo sappiamo, e un
// falso allarme «app non configurata» su una rete instabile sarebbe esso stesso
// un'informazione inventata (§60).
// ============================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './env';

export type ConfigStatus =
  /** verifica in corso: l'app procede normalmente */
  | 'checking'
  /** chiave presente e accettata dal server */
  | 'ok'
  /** variabili assenti o ancora ai valori segnaposto */
  | 'missing'
  /** variabili presenti ma il server RIFIUTA la chiave: configurazione errata */
  | 'rejected'
  /** server non raggiungibile: non si può concludere nulla, non si allarma */
  | 'unreachable';

/** Endpoint pubblico e leggero: risponde senza sessione, ma pretende una apikey valida. */
const PROBE_PATH = '/auth/v1/settings';
const TIMEOUT_MS = 8000;

export async function verifySupabaseConfig(): Promise<ConfigStatus> {
  if (!isSupabaseConfigured) return 'missing';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}${PROBE_PATH}`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: controller.signal,
    });
    if (res.ok) return 'ok';
    // 401/403 = la chiave non è valida per questo progetto. È il caso che ci
    // interessa: la configurazione esiste ma è sbagliata.
    if (res.status === 401 || res.status === 403) return 'rejected';
    // Altri codici (5xx, manutenzione…) non dicono nulla sulla configurazione.
    return 'unreachable';
  } catch {
    return 'unreachable';                    // rete assente, timeout, CORS
  } finally {
    clearTimeout(timer);
  }
}
