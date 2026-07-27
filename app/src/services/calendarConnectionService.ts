// ============================================================================
// calendarConnectionService — i calendari esterni collegati.
//
// La LETTURA passa dal database (RLS: `user_id = auth.uid()`, quindi si vedono
// solo i propri). Ogni SCRITTURA passa da una Edge Function, e non è una
// scelta di stile: dalla 0018 il client non ha alcun permesso di scrittura su
// `calendar_connections`, perché collegare e scollegare significa maneggiare
// token, e quelli non devono mai avvicinarsi al browser.
// ============================================================================
import { requireSupabase, supabase } from '@/lib/supabase';
import { SUPABASE_URL } from '@/lib/env';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import type { CalendarConnection, CalendarProvider } from '@/types/models';
import type { Database } from '@/types/database';

type ConnectionRow = Database['public']['Tables']['calendar_connections']['Row'];

/**
 * Le colonne concesse dalla 0018 al ruolo `authenticated`.
 * ⚠️ `select('*')` su questa tabella FALLISCE con «permission denied for
 * column»: è voluto, ed è il motivo per cui sono elencate una per una.
 */
const CONNECTION_COLUMNS =
  'id, company_id, user_id, provider, email_address, provider_calendar_id, calendar_name, ' +
  'status, scopes, sync_enabled, initial_sync_completed_at, last_sync_at, ' +
  'last_successful_sync_at, last_error_code, last_error_at, created_at, updated_at';

function toConnection(row: ConnectionRow): CalendarConnection {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    provider: row.provider,
    emailAddress: row.email_address,
    providerCalendarId: row.provider_calendar_id,
    calendarName: row.calendar_name,
    status: row.status,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    syncEnabled: row.sync_enabled,
    initialSyncCompletedAt: row.initial_sync_completed_at,
    lastSyncAt: row.last_sync_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastErrorCode: row.last_error_code,
    lastErrorAt: row.last_error_at,
  };
}

/** Chiamata a una Edge Function con il JWT dell'utente corrente. */
async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const sb = requireSupabase();
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    // La funzione risponde con un CODICE, non con una frase: il testo leggibile
    // lo compone qui la UI, nella lingua dell'utente (§108).
    const context = (error as { context?: Response }).context;
    let code: string | null = null;
    if (context && typeof context.json === 'function') {
      code = await context.json().then((b: { code?: string }) => b?.code ?? null).catch(() => null);
    }
    throw new AppError(calendarErrorMessage(code) ?? toUserMessage(error), error);
  }
  return data as T;
}

/**
 * Da codice tecnico a frase per una persona (§108).
 *
 * Un codice sconosciuto NON viene mostrato grezzo né mascherato da un messaggio
 * che afferma qualcosa di preciso: si dice che c'è stato un problema, che è la
 * verità. `401 invalid_grant` e `Graph 503` non compaiono mai in una schermata.
 */
export function calendarErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'AUTH_EXPIRED':
      return tr('calendar.errors.reauthRequired');
    // Distinto da «da ricollegare»: qui non c'è nulla da rinnovare, manca un
    // permesso che solo l'utente può concedere spuntando una casella.
    case 'SCOPE_NOT_GRANTED':
    case 'AUTH_INSUFFICIENT_SCOPE':
      return tr('calendar.errors.scopeNotGranted');
    case 'PROVIDER_UNAVAILABLE':
      return tr('calendar.errors.providerUnavailable');
    case 'PROVIDER_RATE_LIMITED':
      return tr('calendar.errors.rateLimited');
    case 'CALENDAR_GONE':
      return tr('calendar.errors.calendarGone');
    case 'SYNC_TOO_SOON':
      return tr('calendar.errors.syncTooSoon');
    case 'PROVIDER_NOT_CONFIGURED':
      return tr('calendar.errors.providerNotConfigured');
    case 'CONFIG_MISSING':
      return tr('calendar.errors.notConfigured');
    case 'STATE_INVALID':
      return tr('calendar.errors.stateInvalid');
    case 'FORBIDDEN':
      return tr('errors.forbidden');
    case 'UNAUTHENTICATED':
      return tr('errors.sessionInvalid');
    default:
      return tr('calendar.errors.generic');
  }
}

export interface ProvidersInfo {
  providers: CalendarProvider[];
  /** Gli scope REALMENTE richiesti, letti dagli adapter del server (§53). */
  scopes: Partial<Record<CalendarProvider, string[]>>;
  /**
   * Vero se il server ha un servizio di invio email configurato.
   *
   * Senza questo dato la schermata non potrebbe dire la verità: mostrerebbe un
   * interruttore acceso su un canale spento, oppure lo nasconderebbe per sempre
   * anche dopo che qualcuno lo ha configurato. È un booleano e non la chiave —
   * il client deve sapere SE, non COSA (§79).
   */
  emailConfigured: boolean;
}

export interface DisconnectResult {
  eventsRemoved: number;
  eventsLeft: number;
  /** Falso su Microsoft: Graph non espone una revoca dall'esterno. Si dichiara. */
  revoked: boolean;
  removalFailed: boolean;
}

export const calendarConnectionService = {
  /** I MIEI calendari collegati per questa azienda. La RLS non ne mostra altri. */
  async list(companyId: string): Promise<CalendarConnection[]> {
    const { data, error } = await requireSupabase()
      .from('calendar_connections')
      .select(CONNECTION_COLUMNS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });
    if (error) throw new AppError(toUserMessage(error), error);
    // `select()` con una lista di colonne come stringa non è inferibile dal
    // tipo Database: si passa da `unknown`, che DICHIARA la conversione invece
    // di farla passare per un'inferenza che non c'è.
    return ((data ?? []) as unknown as ConnectionRow[]).map(toConnection);
  },

  /**
   * Quali provider il SERVER può realmente usare, e con quali permessi.
   * La UI non deve offrire un pulsante che porta a un errore di configurazione,
   * né elencare permessi che non chiediamo davvero (§53/§79).
   */
  async providers(): Promise<ProvidersInfo> {
    const result = await callFunction<ProvidersInfo>('calendar-oauth/providers', {});
    return {
      providers: result?.providers ?? [],
      scopes: result?.scopes ?? {},
      // In assenza di risposta si assume NON configurato: è lo stato in cui
      // l'interfaccia non promette niente. L'errore opposto — dare per
      // configurato ciò che non lo è — produrrebbe un interruttore acceso su un
      // canale che non consegna.
      emailConfigured: result?.emailConfigured === true,
    };
  },

  /** Avvia il consenso: il server prepara lo state e dice dove mandare l'utente. */
  async startConnect(input: {
    companyId: string; provider: CalendarProvider; locale: string; returnPath?: string;
  }): Promise<string> {
    const result = await callFunction<{ authorizationUrl: string }>('calendar-oauth/start', {
      companyId: input.companyId,
      provider: input.provider,
      locale: input.locale,
      returnPath: input.returnPath ?? '/calendario/impostazioni',
    });
    if (!result?.authorizationUrl) throw new AppError(tr('calendar.errors.generic'));
    return result.authorizationUrl;
  },

  /** «Sincronizza ora». Server-side e limitata nella frequenza (§74). */
  async syncNow(connectionId: string): Promise<{ status: string; report?: Record<string, number | boolean> }> {
    return await callFunction('calendar-sync', { action: 'sync', connectionId });
  },

  /**
   * Scollega. `removeEvents` è una scelta ESPLICITA dell'utente e non ha un
   * valore predefinito che decida al posto suo: se non viene detto, gli eventi
   * già presenti nel suo calendario restano (§70).
   */
  async disconnect(connectionId: string, removeEvents: boolean): Promise<DisconnectResult> {
    return await callFunction('calendar-disconnect', { connectionId, removeEvents });
  },

  /** Vero se il client è configurato: senza, le Edge Function non sono chiamabili. */
  get available(): boolean {
    return !!supabase && !!SUPABASE_URL;
  },
};
