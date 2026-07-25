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

  // Rete / Storage
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed'))
    return tr('errors.network');
  if (msg.includes('bucket') && msg.includes('not found')) return tr('errors.storageUnavailable');
  if (msg.includes('exceeded the maximum allowed size') || code === '413')
    return tr('errors.fileTooLarge');

  return rawMessage || fallback;
}
