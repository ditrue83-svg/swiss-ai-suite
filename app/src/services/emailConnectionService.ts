// ============================================================================
// emailConnectionService — le caselle collegate.
//
// La lettura passa dal database (RLS); ogni SCRITTURA passa da una Edge
// Function. Non è una scelta di stile: dalla 0013 il client non ha alcun
// permesso di scrittura su `email_connections`, perché collegare e scollegare
// significa maneggiare token, e quelli non devono mai avvicinarsi al browser.
// ============================================================================
import { requireSupabase, supabase } from '@/lib/supabase';
import { SUPABASE_URL } from '@/lib/env';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import type { EmailConnection, EmailProvider } from '@/types/models';
import type { Database } from '@/types/database';

type ConnectionRow = Database['public']['Tables']['email_connections']['Row'];

/** Colonne concesse dalla 0013 al ruolo authenticated. `select('*')` chiederebbe di più. */
const CONNECTION_COLUMNS =
  'id, company_id, connected_by, provider, provider_account_id, email_address, display_name, ' +
  'status, scopes, sync_enabled, initial_sync_completed_at, last_sync_at, last_successful_sync_at, ' +
  'last_error_code, last_error_at, watch_expires_at, sync_lease_until, created_at, updated_at';

function toConnection(row: ConnectionRow): EmailConnection {
  return {
    id: row.id,
    companyId: row.company_id,
    connectedBy: row.connected_by,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    emailAddress: row.email_address,
    displayName: row.display_name,
    status: row.status,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    syncEnabled: row.sync_enabled,
    initialSyncCompletedAt: row.initial_sync_completed_at,
    lastSyncAt: row.last_sync_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastErrorCode: row.last_error_code,
    lastErrorAt: row.last_error_at,
    watchExpiresAt: row.watch_expires_at,
    syncLeaseUntil: row.sync_lease_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    throw new AppError(inboxErrorMessage(code) ?? toUserMessage(error), error);
  }
  return data as T;
}

/**
 * Da codice tecnico a frase per una persona (§108). Un codice sconosciuto NON
 * viene mostrato grezzo né mascherato da un messaggio generico che afferma
 * qualcosa di preciso: si dice che c'è stato un problema, che è la verità.
 */
export function inboxErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'AUTH_EXPIRED':
      return tr('inbox.errors.reauthRequired');
    // Distinto da «connessione da rinnovare»: qui non c'è nulla da rinnovare,
    // manca un permesso che solo l'utente può concedere. Confonderli manda a
    // ricollegare una casella che è collegata benissimo.
    case 'SCOPE_NOT_GRANTED':
    case 'AUTH_INSUFFICIENT_SCOPE':
      return tr('inbox.errors.scopeNotGranted');
    case 'PROVIDER_UNAVAILABLE':
      return tr('inbox.errors.providerUnavailable');
    case 'PROVIDER_RATE_LIMITED':
      return tr('inbox.errors.rateLimited');
    case 'SYNC_BUSY':
      return tr('inbox.errors.syncBusy');
    case 'SYNC_TOO_SOON':
      return tr('inbox.errors.syncTooSoon');
    case 'CURSOR_EXPIRED':
      return tr('inbox.errors.cursorExpired');
    case 'SUBSCRIPTION_GONE':
      return tr('inbox.errors.subscriptionGone');
    case 'PROVIDER_NOT_CONFIGURED':
      return tr('inbox.errors.providerNotConfigured');
    case 'CONFIG_MISSING':
      return tr('inbox.errors.notConfigured');
    // Non è un guasto: è la risposta a «aggiungi questo ai documenti» quando
    // non c'è niente da aggiungere. Dirlo evita di far cercare un problema.
    case 'EMPTY_BODY':
      return tr('inbox.errors.emptyBody');
    case 'AI_NOT_CONFIGURED':
      return tr('inbox.errors.aiNotConfigured');
    case 'ANALYSIS_FAILED':
    case 'ANALYSIS_SKIPPED':
      return tr('inbox.errors.analysisFailed');
    // ⚠️ Non invita a riprovare, e dice a CHI tocca rimediare: aspettare non
    // risolve un credito esaurito. È la stessa regola già applicata ad Admin AI.
    case 'AI_CREDIT_EXHAUSTED':
      return tr('inbox.errors.aiCreditExhausted');
    // Il modello ha risposto qualcosa che non si riesce a usare: è un guasto
    // diverso da «il servizio non c'era», e porta a un'azione diversa.
    case 'INVALID_RESPONSE':
    case 'CLASSIFY_FAILED':
      return tr('inbox.errors.classifyFailed');
    // ⚠️ Dice che il limite è NOSTRO e che tocca a chi amministra, non a chi
    // legge la posta: «la risposta non è valida» accuserebbe il fornitore di un
    // tetto scelto da noi, e manderebbe a cercare il guasto dove non è.
    case 'AI_OUTPUT_TRUNCATED':
      return tr('inbox.errors.aiOutputTruncated');
    // Distinto da un'analisi fallita: qui l'elaborazione non è arrivata in
    // fondo. Dirlo com'è cambia cosa può fare la persona — riprovare ha senso.
    case 'INTERRUPTED':
      return tr('inbox.errors.interrupted');
    // Non è un guasto: è un lotto che finisce. Chiamarlo errore manderebbe la
    // persona a riprovare una cosa che sta già proseguendo da sola.
    case 'TIME_BUDGET':
      return tr('inbox.errors.timeBudget');
    case 'ATTACHMENT_FAILED':
      return tr('inbox.errors.attachmentFailed');
    case 'SOURCE_CHANGED':
      return tr('inbox.errors.sourceChanged');
    case 'FORBIDDEN':
      return tr('errors.forbidden');
    case 'UNAUTHENTICATED':
      return tr('errors.sessionInvalid');
    default:
      return tr('inbox.errors.generic');
  }
}

export interface SyncCounters {
  messagesSeen: number;
  messagesNew: number;
  messagesUpdated: number;
  attachmentsImported: number;
  documentsCreated: number;
  analysesStarted: number;
}

export const emailConnectionService = {
  async list(companyId: string): Promise<EmailConnection[]> {
    const { data, error } = await requireSupabase()
      .from('email_connections')
      .select(CONNECTION_COLUMNS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });
    if (error) throw new AppError(toUserMessage(error), error);
    // `select()` con una lista di colonne come stringa non è inferibile dal
    // tipo Database: si passa da `unknown`, che dichiara la conversione invece
    // di farla passare per un'inferenza che non c'è.
    return ((data ?? []) as unknown as ConnectionRow[]).map(toConnection);
  },

  /**
   * Quali provider il SERVER può realmente usare. La UI non deve offrire un
   * pulsante che porta a un errore di configurazione: se Microsoft non è
   * configurato, non si mostra come se lo fosse (§140).
   */
  async availableProviders(): Promise<EmailProvider[]> {
    const result = await callFunction<{ providers: EmailProvider[] }>('email-oauth/providers', {});
    return result.providers ?? [];
  },

  /** Avvia il consenso: il server prepara lo state e restituisce dove mandare l'utente. */
  async startConnect(input: { companyId: string; provider: EmailProvider; returnPath?: string }): Promise<string> {
    const result = await callFunction<{ authorizationUrl: string }>('email-oauth/start', {
      companyId: input.companyId,
      provider: input.provider,
      returnPath: input.returnPath ?? '/inbox',
    });
    if (!result?.authorizationUrl) throw new AppError(tr('inbox.errors.generic'));
    return result.authorizationUrl;
  },

  async sync(connectionId: string, outputLanguage: string): Promise<{ status: string; counters: SyncCounters; code: string | null }> {
    return await callFunction('email-sync', { action: 'sync', connectionId, outputLanguage });
  },

  /**
   * Analisi su richiesta di una comunicazione che la classificazione non aveva
   * promosso. È l'utente a decidere: si importa e si analizza, senza
   * riclassificare — il giudizio della persona non va rimesso in discussione
   * dalla macchina.
   */
  async analyze(messageId: string, outputLanguage: string): Promise<{ status: string }> {
    return await callFunction('email-sync', { action: 'analyze', messageId, outputLanguage });
  },

  /**
   * «Aggiungi ai documenti» — il gesto di promozione (D-13, PARTE B).
   *
   * ⚠️⚠️ È IL PUNTO IN CUI LA POSTA DIVENTA UN DATO AZIENDALE, ed è l'UNICA
   * strada: nessun componente crea documenti da un messaggio, e nessuna
   * pipeline lo fa più da sola. Prima di D-13 i documenti nascevano dalla
   * sincronizzazione, senza che nessuno avesse chiesto niente — 18 su 20 dei
   * documenti in produzione sono nati così, e 14 erano fatture del titolare.
   *
   * ⚠️ NON SPENDE CREDITO. Il documento nasce `uploaded`: è entrato, non è
   * stato letto. Analizzarlo è un'altra decisione, con un altro pulsante.
   *
   * ⚠️ `created: false` NON è un errore: è la seconda pressione. Si torna lo
   * STESSO identificativo, e chi chiama porta al documento che c'è già invece
   * di crearne un altro (B3). L'idempotenza non è un `if` qui: è l'indice unico
   * `uq_email_msg_doc_body` della 0013.
   */
  async promote(messageId: string): Promise<{ documentId: string; created: boolean }> {
    const esito = await callFunction<{ documentId: string; created: boolean }>(
      'email-sync', { action: 'promote', messageId },
    );
    return { documentId: esito.documentId, created: !!esito.created };
  },

  async disconnect(connectionId: string): Promise<{ status: string; watchStopped: boolean; revoked: boolean }> {
    return await callFunction('email-disconnect', { connectionId });
  },

  /** Vero se il client è configurato: senza, le Edge Function non sono chiamabili. */
  get available(): boolean {
    return !!supabase && !!SUPABASE_URL;
  },
};
