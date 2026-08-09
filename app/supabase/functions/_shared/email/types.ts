// ============================================================================
// Modello provider-agnostic della posta + contratto degli adapter.
//
// Il resto dell'applicazione non conosce Gmail né Microsoft Graph: conosce
// `NormalizedEmailMessage`. È la stessa scelta già fatta per l'analisi, dove la
// UI non sa se dietro c'è il modello o il motore locale — e vale doppio qui,
// perché i due provider descrivono la stessa realtà con due vocabolari diversi
// (`payload.headers` contro `from.emailAddress.address`) e nessuno dei due deve
// filtrare nelle schermate.
//
// Modulo PORTABILE: nessuna API Deno, nessuna lettura di ambiente. La
// configurazione arriva per parametro, così gli stessi adapter girano nei test
// con un `fetch` finto e payload sintetici.
// ============================================================================

export type EmailProviderId = 'google' | 'microsoft';

export interface NormalizedRecipient {
  name: string | null;
  email: string;
}

export interface NormalizedLink {
  url: string;
  label: string;
  host: string;
}

export interface NormalizedAttachment {
  /** Identificativo dell'allegato PRESSO IL PROVIDER: stabile, usato per l'idempotenza. */
  externalId: string;
  filename: string | null;
  /** MIME DICHIARATO dal provider. Non è una garanzia: va validato (§15). */
  declaredMimeType: string | null;
  sizeBytes: number | null;
  contentId: string | null;
  isInline: boolean;
}

export interface NormalizedEmailMessage {
  externalId: string;
  threadId: string | null;
  /** Message-ID RFC 5322, quando il provider lo espone. Utile a riconoscere lo stesso messaggio su caselle diverse. */
  internetMessageId: string | null;
  subject: string | null;
  from: NormalizedRecipient | null;
  to: NormalizedRecipient[];
  cc: NormalizedRecipient[];
  receivedAt: string;              // ISO 8601
  sentAt: string | null;
  /** Corpo ridotto a testo. L'HTML del provider non viene mai conservato (§11/§54). */
  textBody: string;
  /** Anteprima breve per la lista. */
  preview: string;
  /** Collegamenti estratti dal corpo, con destinazione reale. */
  links: NormalizedLink[];
  attachments: NormalizedAttachment[];
  /** Posta di massa secondo gli header (List-Unsubscribe, Precedence). Fatto, non giudizio. */
  isBulk: boolean;
  importance: string | null;
}

/** Identità dell'account collegato, letta dal provider dopo il consenso. */
export interface ProviderAccountIdentity {
  /** Identificativo STABILE (§127). Non l'indirizzo, che può cambiare o essere un alias. */
  accountId: string;
  emailAddress: string;
  displayName: string | null;
}

export interface OAuthTokens {
  accessToken: string;
  /** Assente quando il provider non ne emette uno nuovo al refresh: si conserva il precedente. */
  refreshToken: string | null;
  expiresAt: string;               // ISO 8601
  scopes: string[];
}

/** Riferimento a un messaggio da scaricare, con il cursore aggiornato. */
export interface SyncListResult {
  /** Identificativi provider dei messaggi nuovi o modificati. */
  messageIds: string[];
  /** Cursore da salvare per il prossimo giro. */
  cursor: string | null;
  /**
   * true quando il cursore non è più utilizzabile e serve una riconciliazione
   * completa (Gmail: `historyId` troppo vecchio; Graph: delta token scaduto).
   * Dichiararlo è l'unico modo per non perdere silenziosamente dei messaggi.
   */
  cursorExpired: boolean;
  /** Il provider ha altre pagine: il chiamante decide se proseguire ora o dopo. */
  hasMore: boolean;
}

export interface WatchResult {
  /** Identificativo della sottoscrizione presso il provider. */
  resourceId: string | null;
  expiresAt: string | null;
  /** Segreto condiviso che il provider rimanderà nelle notifiche (Microsoft `clientState`). */
  clientState?: string | null;
}

/**
 * Contratto di un provider di posta. Sola LETTURA (§2.3): non esiste un metodo
 * per cancellare, spostare, etichettare o inviare — l'assenza è il vincolo. Se
 * un domani servisse, andrebbe aggiunto qui e sarebbe visibile in revisione,
 * invece di comparire come una riga in mezzo a una Edge Function.
 */
export interface EmailProviderAdapter {
  readonly id: EmailProviderId;

  /** URL a cui mandare l'utente per il consenso, con PKCE e state opaco. */
  buildAuthorizationUrl(input: { state: string; codeChallenge: string; loginHint?: string | null }): string;

  exchangeCode(input: { code: string; codeVerifier: string }): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;

  getAccountIdentity(accessToken: string): Promise<ProviderAccountIdentity>;

  /** Primo popolamento: finestra limitata e numero massimo di messaggi (§44). */
  listInitial(input: { accessToken: string; since: string; max: number }): Promise<SyncListResult>;

  /** Nuovi eventi a partire dal cursore. `cursorExpired` quando non è più valido. */
  listIncremental(input: { accessToken: string; cursor: string | null; max: number }): Promise<SyncListResult>;

  /** Riconciliazione: rilettura per finestra temporale, indipendente dal cursore (§45). */
  listWindow(input: { accessToken: string; since: string; max: number }): Promise<SyncListResult>;

  getMessage(input: { accessToken: string; messageId: string }): Promise<NormalizedEmailMessage>;

  getAttachment(input: { accessToken: string; messageId: string; attachmentId: string }): Promise<Uint8Array>;

  /** Cursore attuale, per iniziare da un punto noto dopo l'import iniziale. */
  getCurrentCursor(accessToken: string): Promise<string | null>;

  createWatch(input: { accessToken: string; notificationUrl: string; clientState: string }): Promise<WatchResult>;
  /**
   * ⚠️ `resourceId` PUÒ ESSERE NULL, e fino al 2026-08-04 questa riga diceva di
   * no mentre le due implementazioni dicevano di sì. `email-maintenance`
   * seleziona di proposito anche le connessioni senza scadenza nota («una
   * sottoscrizione di cui non si conosce la scadenza è indistinguibile da una
   * che non c'è»), quindi passa `watch_resource_id` null; Microsoft ci ramifica
   * sopra (`if (!resourceId) return createWatch(…)`) e Gmail lo ignora, perché
   * là rinnovare è ricreare. Il tipo contraddiceva il proprio codice, e non si
   * vedeva perché il CHIAMANTE non era compilato da nessuno.
   * `stopWatch` qui sotto lo dichiarava già correttamente.
   */
  renewWatch(input: { accessToken: string; resourceId: string | null; notificationUrl: string; clientState: string }): Promise<WatchResult>;
  stopWatch(input: { accessToken: string; resourceId: string | null }): Promise<void>;

  /** Revoca il consenso presso il provider, dove è supportato (§40). */
  revoke(input: { accessToken: string; refreshToken: string | null }): Promise<void>;
}

// ---- Errori tipizzati -------------------------------------------------------
// Un errore del provider deve dire tre cose: se ha senso riprovare, se il
// consenso è saltato, e con quale codice tecnico registrarlo. Un `catch (e)`
// generico non sa distinguere «Google è momentaneamente occupato» da «l'utente
// ha revocato l'accesso», e trattarli allo stesso modo significa o insistere
// inutilmente o spegnere una casella che funziona.

export type EmailErrorCode =
  | 'PROVIDER_UNAVAILABLE'      // 5xx, rete, timeout — transitorio
  | 'PROVIDER_RATE_LIMITED'     // 429 — transitorio, con attesa indicata
  | 'AUTH_EXPIRED'              // token non rinnovabile, consenso revocato
  | 'AUTH_INSUFFICIENT_SCOPE'
  | 'CURSOR_EXPIRED'            // serve riconciliazione, non è un guasto
  | 'SUBSCRIPTION_GONE'         // watch/subscription rimossa dal provider
  | 'NOT_FOUND'
  | 'INVALID_RESPONSE'
  | 'CONFIG_MISSING'
  | 'UNKNOWN';

export class EmailProviderError extends Error {
  readonly code: EmailErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly status: number | null;

  constructor(
    code: EmailErrorCode,
    message: string,
    options: { retryable?: boolean; retryAfterMs?: number | null; status?: number | null } = {},
  ) {
    super(message);
    this.name = 'EmailProviderError';
    this.code = code;
    // Il default segue il codice: chi costruisce l'errore non deve ricordarsi
    // di dire che un 5xx è ritentabile e una revoca no.
    this.retryable = options.retryable ?? (code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_RATE_LIMITED');
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.status = options.status ?? null;
  }
}

/** Configurazione di un provider. Arriva per parametro: mai letta dall'ambiente qui. */
export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Microsoft: `common`, `organizations` o l'id del tenant. Ignorato da Google. */
  tenant?: string;
  /** Google: topic Pub/Sub completo `projects/<id>/topics/<topic>`. */
  pubsubTopic?: string;
  /** Iniettabile per i test: nessuna rete. */
  fetchImpl?: typeof fetch;
}
