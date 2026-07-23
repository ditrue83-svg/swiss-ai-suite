// Gestione errori leggibile: mai stack trace tecnici all'utente (requisito #21).

export class AppError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.cause = cause;
  }
}

function asRecord(err: unknown): Record<string, unknown> {
  return (err && typeof err === 'object' ? (err as Record<string, unknown>) : {});
}

/** Traduce un errore (Supabase/Postgres/rete) in un messaggio italiano comprensibile. */
export function toUserMessage(err: unknown, fallback = 'Si è verificato un errore. Riprova.'): string {
  if (err instanceof AppError) return err.message;

  const e = asRecord(err);
  const rawMessage = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const msg = rawMessage.toLowerCase();

  // Autenticazione
  if (msg.includes('invalid login credentials')) return 'Email o password non corretti.';
  if (msg.includes('email not confirmed')) return 'Devi confermare la tua email prima di accedere. Controlla la posta.';
  if (msg.includes('user already registered') || code === 'user_already_exists')
    return 'Esiste già un account con questa email. Prova ad accedere.';
  if (msg.includes('password should be at least') || code === 'weak_password')
    return 'La password è troppo debole: usa almeno 8 caratteri.';
  if ((msg.includes('email address') && msg.includes('invalid')) || msg.includes('unable to validate email') || code === 'email_address_invalid')
    return 'Indirizzo email non valido o non accettato dal provider.';
  if (msg.includes('for security purposes') || status === 429 || code === 'over_email_send_rate_limit')
    return 'Troppi tentativi ravvicinati. Attendi qualche istante e riprova.';
  if (msg.includes('token has expired') || msg.includes('jwt expired') || code === 'session_expired')
    return 'La sessione è scaduta. Effettua di nuovo l’accesso.';

  // Autorizzazione / RLS (PostgREST)
  if (code === 'PGRST301' || status === 401) return 'Sessione non valida o scaduta. Effettua di nuovo l’accesso.';
  if (code === '42501' || status === 403 || msg.includes('row-level security') || msg.includes('permission denied'))
    return 'Non hai i permessi per accedere a questa risorsa.';
  if (code === 'PGRST116') return 'Elemento non trovato.';
  if (code === '23505') return 'Elemento già presente (duplicato).';

  // Rete / Storage
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed'))
    return 'Impossibile contattare il server. Controlla la connessione e riprova.';
  if (msg.includes('bucket') && msg.includes('not found')) return 'Archivio file non disponibile. Riprova più tardi.';
  if (msg.includes('exceeded the maximum allowed size') || code === '413')
    return 'Il file supera la dimensione massima consentita.';

  return rawMessage || fallback;
}
