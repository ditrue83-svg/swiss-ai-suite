// Gestione errori leggibile: mai stack trace tecnici all'utente (requisito #21).
//
// I messaggi sono tradotti con `translate()` e non con l'hook: qui non siamo in
// un componente. Un errore va letto nella lingua dell'utente proprio nei momenti
// in cui qualcosa è andato storto.
import { translate as tr } from '@/i18n';

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
export function toUserMessage(err: unknown, fallback = tr('errors.generic')): string {
  if (err instanceof AppError) return err.message;

  const e = asRecord(err);
  const rawMessage = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const msg = rawMessage.toLowerCase();

  // Autenticazione
  if (msg.includes('invalid login credentials')) return tr('errors.badCredentials');
  if (msg.includes('email not confirmed')) return tr('errors.emailNotConfirmed');
  if (msg.includes('user already registered') || code === 'user_already_exists')
    return tr('errors.userExists');
  if (msg.includes('password should be at least') || code === 'weak_password')
    return tr('errors.weakPassword');
  if ((msg.includes('email address') && msg.includes('invalid')) || msg.includes('unable to validate email') || code === 'email_address_invalid')
    return tr('errors.invalidEmail');
  if (msg.includes('for security purposes') || status === 429 || code === 'over_email_send_rate_limit')
    return tr('errors.tooManyAttempts');
  if (msg.includes('token has expired') || msg.includes('jwt expired') || code === 'session_expired')
    return tr('errors.sessionExpired');

  // Autorizzazione / RLS (PostgREST)
  if (code === 'PGRST301' || status === 401) return tr('errors.sessionInvalid');
  if (code === '42501' || status === 403 || msg.includes('row-level security') || msg.includes('permission denied'))
    return tr('errors.forbidden');
  if (code === 'PGRST116') return tr('errors.notFound');
  if (code === '23505') return tr('errors.duplicate');
  // Tabella o colonna che il database non conosce: succede quando il codice è
  // più avanti dello schema, cioè quando una migrazione non è ancora stata
  // applicata. È un problema di messa in opera, non dell'utente, e il nome
  // della tabella mancante non gli dice nulla di utile (§108).
  if (code === 'PGRST205' || code === 'PGRST204' || code === '42P01' || code === '42703'
      || msg.includes('schema cache')) {
    return tr('errors.schemaOutdated');
  }

  // Rete / Storage
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed'))
    return tr('errors.network');
  if (msg.includes('bucket') && msg.includes('not found')) return tr('errors.storageUnavailable');
  if (msg.includes('exceeded the maximum allowed size') || code === '413')
    return tr('errors.fileTooLarge');

  // Invio email fallito lato server (SMTP non raggiungibile, credenziali del
  // mittente rifiutate, casella bloccata…). Va distinto dagli altri errori:
  // l'utente non ha sbagliato nulla e riprovare subito non serve a niente.
  if (msg.includes('error sending') || msg.includes('smtp') || code === 'unexpected_failure')
    return tr('errors.emailNotSent');

  // Un errore DEVE restare leggibile. Certi errori arrivano con un `message`
  // che è la serializzazione di un oggetto vuoto ("{}", "[object Object]"):
  // mostrarlo tale e quale, come è successo il 2026-07-26 nella schermata di
  // reimpostazione password, equivale a non dire nulla — e lascia l'utente
  // davanti a un guasto senza sapere se ha sbagliato lui.
  return isReadable(rawMessage) ? rawMessage : fallback;
}

/** Un messaggio è utile solo se dice qualcosa: scarta i residui di serializzazione. */
function isReadable(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  if (m === '{}' || m === '[]' || m === 'null' || m === 'undefined') return false;
  if (m === '[object Object]') return false;
  // Un oggetto JSON serializzato non è un messaggio per una persona.
  if ((m.startsWith('{') && m.endsWith('}')) || (m.startsWith('[') && m.endsWith(']'))) return false;
  return true;
}
