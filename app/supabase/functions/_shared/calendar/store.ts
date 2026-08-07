// ============================================================================
// Persistenza del calendario e delle notifiche. Tutto ciò che tocca il database.
//
// Gira SEMPRE con service role, perché scrive tabelle che il client non può
// scrivere. Il bypass della RLS è legittimo solo se l'autorizzazione è già
// avvenuta a monte — è la stessa disciplina di `analyze-document` (0010) e
// dell'Inbox (0013) — e per non dipendere dalla memoria di chi scriverà il
// prossimo chiamante, ogni query qui filtra ESPLICITAMENTE per l'azienda o per
// la connessione. La RLS non è un secondo controllo disponibile: qui non c'è.
// ============================================================================
import { open as openSealed, seal, type Sealed } from '../email/crypto.ts';
import { CalendarProviderError, type CalendarOAuthTokens, type CalendarProviderAdapter } from './types.ts';
import type { NotificationType } from './contract.ts';
import { DEFAULT_TIMEZONE } from './contract.ts';
import type { ServerLocale } from './i18n.ts';
import { asServerLocale } from './i18n.ts';

/** Forma minima del client Supabase usata qui. Identica in Deno e Node. */
export interface ServerClient {
  from: (table: string) => any;
  // ⚠️ `PromiseLike`, NON `Promise`: `sb.rpc(…)` torna un `PostgrestFilterBuilder`,
  // che ha `then` e NON ha `catch` né `finally`. Dichiararlo `Promise` rendeva il
  // client vero non assegnabile a questa interfaccia, e ha coperto un `.catch()`
  // che a runtime sollevava. Vedi `persist.ts` → `SupabaseWithRpc`.
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

// ---- Connessioni ------------------------------------------------------------

export interface CalendarConnectionRow {
  id: string;
  company_id: string;
  user_id: string;
  provider: 'google' | 'microsoft';
  provider_account_id: string;
  email_address: string;
  provider_calendar_id: string | null;
  calendar_name: string | null;
  status: 'active' | 'reauth_required' | 'error' | 'disconnected';
  sync_enabled: boolean;
  initial_sync_completed_at: string | null;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  sync_lease_id: string | null;
  sync_lease_until: string | null;
}

const CONNECTION_COLUMNS =
  'id, company_id, user_id, provider, provider_account_id, email_address, provider_calendar_id, ' +
  'calendar_name, status, sync_enabled, initial_sync_completed_at, last_sync_at, ' +
  'last_successful_sync_at, sync_lease_id, sync_lease_until';

export async function getConnection(sb: ServerClient, id: string): Promise<CalendarConnectionRow | null> {
  const { data } = await sb.from('calendar_connections').select(CONNECTION_COLUMNS).eq('id', id).maybeSingle();
  return (data as CalendarConnectionRow) ?? null;
}

/** Le connessioni ATTIVE di un'azienda: quelle che possono ricevere eventi. */
export async function activeConnections(sb: ServerClient, companyId: string): Promise<CalendarConnectionRow[]> {
  const { data } = await sb.from('calendar_connections').select(CONNECTION_COLUMNS)
    .eq('company_id', companyId).eq('sync_enabled', true).eq('status', 'active');
  return (data ?? []) as CalendarConnectionRow[];
}

export async function findConnectionByAccount(
  sb: ServerClient, companyId: string, userId: string, provider: string,
): Promise<CalendarConnectionRow | null> {
  const { data } = await sb.from('calendar_connections').select(CONNECTION_COLUMNS)
    .eq('company_id', companyId).eq('user_id', userId).eq('provider', provider).maybeSingle();
  return (data as CalendarConnectionRow) ?? null;
}

/**
 * Registra un guasto sulla connessione.
 *
 * `reauth_required` e `error` sono stati DIVERSI e la distinzione conta: il
 * primo richiede un gesto dell'utente e ha un pulsante, il secondo è un guasto
 * che passerà da solo e per cui non c'è niente da fare. Confonderli manda a
 * ricollegare un calendario che funziona benissimo — è l'errore che l'Inbox ha
 * già commesso una volta con lo scope non concesso.
 */
export async function markConnectionError(
  sb: ServerClient, connectionId: string, code: string, fatal: boolean,
): Promise<void> {
  await sb.from('calendar_connections').update({
    status: fatal ? 'reauth_required' : 'error',
    last_error_code: code,
    last_error_at: new Date().toISOString(),
  }).eq('id', connectionId);
}

export async function markConnectionOk(sb: ServerClient, connectionId: string): Promise<void> {
  await sb.from('calendar_connections').update({
    status: 'active',
    last_successful_sync_at: new Date().toISOString(),
    last_error_code: null,
    last_error_at: null,
  }).eq('id', connectionId);
}

// ---- Segreti ----------------------------------------------------------------

/** I byte cifrati viaggiano come `\x…` da PostgREST: qui tornano byte veri. */
function hexToBytes(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  const s = String(value);
  const hex = s.startsWith('\\x') ? s.slice(2) : s;
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '\\x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export interface CalendarSecrets {
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshToken: string | null;
}

/**
 * Legge e decifra. L'AAD è l'id della connessione: un ciphertext copiato su
 * un'altra riga non si decifra, quindi chi potesse scrivere nel database non
 * potrebbe assegnarsi il calendario di un'altra persona.
 */
export async function readSecrets(
  sb: ServerClient, key: CryptoKey, connectionId: string,
): Promise<CalendarSecrets> {
  const { data } = await sb.from('calendar_connection_secrets')
    .select('access_token_ct, access_token_iv, access_token_expires_at, refresh_token_ct, refresh_token_iv')
    .eq('connection_id', connectionId).maybeSingle();
  if (!data) return { accessToken: null, accessTokenExpiresAt: null, refreshToken: null };

  const decrypt = async (ct: unknown, iv: unknown): Promise<string | null> => {
    const c = hexToBytes(ct);
    const i = hexToBytes(iv);
    if (!c || !i || !c.length || !i.length) return null;
    try {
      return await openSealed(key, { ciphertext: c, iv: i }, connectionId);
    } catch {
      // Decifratura fallita = chiave ruotata o dato manomesso. Non è un caso in
      // cui «ripiegare»: si dichiara assente, e il chiamante chiederà di
      // ricollegare. Un token che non si decifra non è un token.
      return null;
    }
  };

  return {
    accessToken: await decrypt(data.access_token_ct, data.access_token_iv),
    accessTokenExpiresAt: (data.access_token_expires_at as string | null) ?? null,
    refreshToken: await decrypt(data.refresh_token_ct, data.refresh_token_iv),
  };
}

export async function writeSecrets(
  sb: ServerClient,
  key: CryptoKey,
  input: {
    connectionId: string; companyId: string;
    accessToken?: string | null; accessTokenExpiresAt?: string | null; refreshToken?: string | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {
    connection_id: input.connectionId,
    company_id: input.companyId,
    key_version: 1,
  };
  const put = async (field: string, value: string | null | undefined) => {
    if (value === undefined) return;                    // non toccare
    if (value === null) { row[`${field}_ct`] = null; row[`${field}_iv`] = null; return; }
    const sealed: Sealed = await seal(key, value, input.connectionId);
    row[`${field}_ct`] = bytesToHex(sealed.ciphertext);
    row[`${field}_iv`] = bytesToHex(sealed.iv);
  };
  await put('access_token', input.accessToken);
  await put('refresh_token', input.refreshToken);
  if (input.accessTokenExpiresAt !== undefined) row.access_token_expires_at = input.accessTokenExpiresAt;

  const { error } = await sb.from('calendar_connection_secrets').upsert(row, { onConflict: 'connection_id' });
  if (error) throw new CalendarProviderError('UNKNOWN', 'salvataggio dei segreti fallito');
}

export async function deleteSecrets(sb: ServerClient, connectionId: string): Promise<void> {
  await sb.from('calendar_connection_secrets').delete().eq('connection_id', connectionId);
}

/**
 * Un access token utilizzabile, rinnovandolo se serve.
 *
 * Il rinnovo fallito NON è un errore transitorio: significa che il consenso non
 * c'è più. Si porta la connessione a `reauth_required` e si dichiara, invece di
 * ritentare per giorni contro un token che non tornerà valido.
 */
export async function getValidAccessToken(
  sb: ServerClient,
  key: CryptoKey,
  connection: CalendarConnectionRow,
  adapter: CalendarProviderAdapter,
): Promise<string> {
  const secrets = await readSecrets(sb, key, connection.id);

  const stillValid = secrets.accessToken
    && secrets.accessTokenExpiresAt
    && new Date(secrets.accessTokenExpiresAt).getTime() > Date.now() + 60_000;
  if (stillValid) return secrets.accessToken as string;

  if (!secrets.refreshToken) {
    await markConnectionError(sb, connection.id, 'AUTH_EXPIRED', true);
    throw new CalendarProviderError('AUTH_EXPIRED', 'nessun refresh token disponibile');
  }

  let tokens: CalendarOAuthTokens;
  try {
    tokens = await adapter.refresh(secrets.refreshToken);
  } catch (error) {
    const code = error instanceof CalendarProviderError ? error.code : 'UNKNOWN';
    // Un provider momentaneamente irraggiungibile NON è un consenso revocato:
    // la connessione resta buona e si riproverà. Dichiararla da ricollegare
    // manderebbe l'utente a rifare un consenso che non serve.
    const fatal = code === 'AUTH_EXPIRED' || code === 'AUTH_INSUFFICIENT_SCOPE';
    await markConnectionError(sb, connection.id, code, fatal);
    throw error;
  }

  await writeSecrets(sb, key, {
    connectionId: connection.id,
    companyId: connection.company_id,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
    // Google non riemette il refresh token a ogni rinnovo: se non arriva, si
    // conserva quello che c'è. Scrivere `null` spegnerebbe il collegamento.
    refreshToken: tokens.refreshToken ?? undefined,
  });

  return tokens.accessToken;
}

// ---- Collegamenti evento ----------------------------------------------------

export interface EventLinkRow {
  id: string;
  company_id: string;
  user_id: string;
  connection_id: string;
  task_id: string;
  provider_event_id: string;
  provider_calendar_id: string;
  sync_status: 'pending' | 'synced' | 'failed';
  content_hash: string | null;
}

const LINK_COLUMNS =
  'id, company_id, user_id, connection_id, task_id, provider_event_id, provider_calendar_id, sync_status, content_hash';

export async function linksForTask(sb: ServerClient, taskId: string): Promise<EventLinkRow[]> {
  const { data } = await sb.from('calendar_event_links').select(LINK_COLUMNS).eq('task_id', taskId);
  return (data ?? []) as EventLinkRow[];
}

export async function upsertLink(sb: ServerClient, row: {
  companyId: string; userId: string; connectionId: string; taskId: string;
  providerEventId: string; providerCalendarId: string; contentHash: string;
}): Promise<void> {
  const { error } = await sb.from('calendar_event_links').upsert({
    company_id: row.companyId,
    user_id: row.userId,
    connection_id: row.connectionId,
    task_id: row.taskId,
    provider_event_id: row.providerEventId,
    provider_calendar_id: row.providerCalendarId,
    sync_status: 'synced',
    content_hash: row.contentHash,
    last_synced_at: new Date().toISOString(),
    error_code: null,
  }, { onConflict: 'connection_id,task_id' });
  if (error) throw new CalendarProviderError('UNKNOWN', 'salvataggio del collegamento fallito');
}

export async function markLinkFailed(sb: ServerClient, linkId: string, code: string): Promise<void> {
  await sb.from('calendar_event_links')
    .update({ sync_status: 'failed', error_code: code })
    .eq('id', linkId);
}

/**
 * Cancella il collegamento DOPO che l'evento è sparito presso il provider.
 *
 * L'ordine conta, ed è lo stesso ragionamento della cancellazione dei documenti
 * (0017): se si togliesse prima la riga e poi la chiamata fallisse, resterebbe
 * un evento nel calendario di una persona che nessuno sa più di aver creato e
 * che nessuno aggiornerà mai. Un collegamento verso un evento già sparito, al
 * contrario, si ripara da sé al giro dopo.
 */
export async function deleteLink(sb: ServerClient, linkId: string): Promise<void> {
  await sb.from('calendar_event_links').delete().eq('id', linkId);
}

// ---- Coda -------------------------------------------------------------------

export interface QueueItem {
  task_id: string;
  company_id: string;
  attempts: number;
  lock_id: string;
}

export async function claimQueue(
  sb: ServerClient, limit: number, lockSeconds: number, taskIds: string[] | null = null,
): Promise<QueueItem[]> {
  const { data, error } = await sb.rpc('calendar_queue_claim', {
    p_limit: limit, p_lock_seconds: lockSeconds, p_task_ids: taskIds,
  });
  if (error) throw new CalendarProviderError('UNKNOWN', 'prenotazione della coda fallita');
  return (data ?? []) as QueueItem[];
}

/**
 * Prende il diritto di CREARE il calendario dedicato.
 *
 * ⚠️ Serve a una gara vera, non teorica: due esecuzioni sovrapposte — lo
 * scheduler e un «Sincronizza ora» premuto nello stesso momento — leggono
 * entrambe `provider_calendar_id` a NULL e creano entrambe un calendario. Ne
 * resterebbero due con lo stesso nome nel calendario di una persona, e su Google
 * non potremmo nemmeno accorgercene: lo scope a privilegio minimo non permette
 * di elencare i calendari.
 *
 * Il lease è a SCADENZA e non un booleano: un processo ucciso a metà non blocca
 * la creazione per sempre. Sono le colonne che la 0013 aveva introdotto per la
 * posta, qui usate per la stessa ragione.
 */
export async function claimCalendarCreation(
  sb: ServerClient, connectionId: string, leaseSeconds = 60,
): Promise<string | null> {
  const leaseId = crypto.randomUUID();
  const now = new Date().toISOString();
  const until = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const { data } = await sb.from('calendar_connections')
    .update({ sync_lease_id: leaseId, sync_lease_until: until })
    .eq('id', connectionId)
    .or(`sync_lease_until.is.null,sync_lease_until.lt.${now}`)
    .select('id');
  return Array.isArray(data) && data.length ? leaseId : null;
}

export async function releaseCalendarCreation(
  sb: ServerClient, connectionId: string, leaseId: string,
): Promise<void> {
  await sb.from('calendar_connections')
    .update({ sync_lease_id: null, sync_lease_until: null })
    .eq('id', connectionId).eq('sync_lease_id', leaseId);
}

/** Lavoro concluso: la riga esce dalla coda. */
export async function queueDone(sb: ServerClient, taskId: string, lockId: string): Promise<void> {
  await sb.from('calendar_sync_queue').delete().eq('task_id', taskId).eq('lock_id', lockId);
}

/**
 * Lavoro fallito: si riprogramma con attesa crescente.
 *
 * Il confronto su `lock_id` non è una precauzione teorica: se il worker ha
 * superato il proprio lease e un'altra esecuzione ha già preso la riga,
 * riprogrammarla qui significherebbe spostare in avanti il lavoro di qualcun
 * altro. Con il confronto, l'update non tocca niente e il lavoro prosegue dove
 * è già in corso.
 */
export async function queueRetry(
  sb: ServerClient, taskId: string, lockId: string, attempts: number, delaySeconds: number, error: string,
): Promise<void> {
  await sb.from('calendar_sync_queue').update({
    attempts: attempts + 1,
    next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    locked_until: null,
    lock_id: null,
    last_error: error.slice(0, 200),
  }).eq('task_id', taskId).eq('lock_id', lockId);
}

/** Rimette una task in coda: la usano la sincronizzazione iniziale e la riconciliazione. */
export async function enqueueTasks(sb: ServerClient, rows: { taskId: string; companyId: string }[]): Promise<void> {
  if (!rows.length) return;
  await sb.from('calendar_sync_queue').upsert(
    rows.map((r) => ({
      task_id: r.taskId, company_id: r.companyId,
      requested_at: new Date().toISOString(), attempts: 0,
      next_attempt_at: new Date().toISOString(), locked_until: null, lock_id: null, last_error: null,
    })),
    { onConflict: 'task_id' },
  );
}

// ---- Registro delle esecuzioni ----------------------------------------------

export async function startRun(sb: ServerClient, input: {
  companyId: string | null; connectionId: string | null;
  provider: string | null; trigger: string;
}): Promise<string | null> {
  const { data } = await sb.from('calendar_sync_runs').insert({
    company_id: input.companyId, connection_id: input.connectionId,
    provider: input.provider, trigger: input.trigger, status: 'running',
  }).select('id').maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

export async function finishRun(sb: ServerClient, runId: string | null, input: {
  status: string; upserted: number; deleted: number; failures: number;
  startedAtMs: number; errorCode?: string | null;
}): Promise<void> {
  if (!runId) return;
  await sb.from('calendar_sync_runs').update({
    status: input.status,
    upserted: input.upserted,
    deleted: input.deleted,
    failures: input.failures,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - input.startedAtMs,
    error_code: input.errorCode ?? null,
  }).eq('id', runId);
}

// ---- Preferenze -------------------------------------------------------------

export interface PreferencesRow {
  company_id: string;
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  remind_7_days: boolean;
  remind_1_day: boolean;
  remind_due_day: boolean;
  remind_overdue: boolean;
  timezone: string;
  locale: ServerLocale;
  show_task_title: boolean;
}

/**
 * Le preferenze di una persona per un'azienda, oppure i DEFAULT.
 *
 * La riga può legittimamente non esistere: nessuno è obbligato ad aprire le
 * impostazioni prima di ricevere il primo promemoria. I default sono gli stessi
 * dichiarati nella 0018 — in-app acceso, email spenta — e sono scritti in
 * entrambi i posti di proposito: qui perché il worker deve poter decidere senza
 * una riga, là perché il database non deve dipendere da chi lo interroga.
 */
export function defaultPreferences(companyId: string, userId: string): PreferencesRow {
  return {
    company_id: companyId, user_id: userId,
    in_app_enabled: true, email_enabled: false,
    remind_7_days: true, remind_1_day: true, remind_due_day: true, remind_overdue: true,
    timezone: DEFAULT_TIMEZONE, locale: 'it', show_task_title: true,
  };
}

export async function preferencesFor(
  sb: ServerClient, companyId: string, userIds: string[],
): Promise<Map<string, PreferencesRow>> {
  const out = new Map<string, PreferencesRow>();
  for (const id of userIds) out.set(id, defaultPreferences(companyId, id));
  if (!userIds.length) return out;

  const { data } = await sb.from('notification_preferences')
    .select('company_id, user_id, in_app_enabled, email_enabled, remind_7_days, remind_1_day, remind_due_day, remind_overdue, timezone, locale, show_task_title')
    .eq('company_id', companyId).in('user_id', userIds);

  for (const row of (data ?? []) as PreferencesRow[]) {
    out.set(row.user_id, { ...row, locale: asServerLocale(row.locale) });
  }
  return out;
}

// ---- Notifiche --------------------------------------------------------------

export interface NewNotification {
  companyId: string;
  userId: string;
  type: NotificationType;
  entityType: 'task' | 'calendar_connection';
  entityId: string;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
}

/**
 * Crea una notifica, se non esiste già.
 *
 * Restituisce l'identificativo quando la riga è NUOVA e `null` quando era già
 * presente. La distinzione è ciò che rende idempotente anche la CONSEGNA: se il
 * worker gira tre volte, due volte non c'è niente di nuovo e nessuna email
 * viene accodata. Il duplicato lo respinge il vincolo unico del database, non
 * un controllo scritto qui — un controllo «leggi poi scrivi» avrebbe una
 * finestra in mezzo, e due esecuzioni contemporanee ci passerebbero entrambe.
 */
export async function insertNotification(
  sb: ServerClient, n: NewNotification,
): Promise<string | null> {
  const { data, error } = await sb.from('notifications').insert({
    company_id: n.companyId,
    user_id: n.userId,
    type: n.type,
    entity_type: n.entityType,
    entity_id: n.entityId,
    payload: n.payload,
    dedupe_key: n.dedupeKey,
  }).select('id').maybeSingle();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') return null;                  // già esistente: è l'esito voluto
    throw new CalendarProviderError('UNKNOWN', 'inserimento della notifica fallito');
  }
  return (data as { id?: string } | null)?.id ?? null;
}

/** Accoda una consegna email. Il vincolo unico impedisce la seconda. */
export async function enqueueEmailDelivery(sb: ServerClient, notificationId: string): Promise<void> {
  await sb.from('notification_deliveries').upsert({
    notification_id: notificationId,
    channel: 'email',
    status: 'pending',
    next_attempt_at: new Date().toISOString(),
  }, { onConflict: 'notification_id,channel', ignoreDuplicates: true });
}
