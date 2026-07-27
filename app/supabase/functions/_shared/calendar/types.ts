// ============================================================================
// Modello provider-agnostic del calendario + contratto degli adapter.
//
// Come per la posta (0013), il resto dell'applicazione non conosce Google
// Calendar né Microsoft Graph: conosce `CalendarEventContent`. Qui la
// separazione conta ancora di più, perché i due provider modellano l'evento di
// giornata intera in due modi incompatibili — Google con `start.date`/`end.date`
// e la fine ESCLUSIVA, Microsoft con `isAllDay` e due `dateTime` a mezzanotte
// nello stesso fuso — e nessuno dei due deve filtrare nel dominio.
//
// COSA QUESTO CONTRATTO NON PUÒ FARE, e non per dimenticanza:
//   · non legge il calendario dell'utente. Non c'è un metodo `listEvents` sui
//     calendari personali, non c'è `freeBusy`, non c'è `getCalendarList`. La
//     versione 1 è a senso unico e lo schema delle capacità lo dice;
//   · non invita nessuno. Non esiste un campo `attendees` in
//     `CalendarEventContent`: un evento senza destinatari non può mandare
//     inviti, e l'assenza è il vincolo (§55);
//   · non crea riunioni online. Nessun `conferenceData`, nessun
//     `isOnlineMeeting` (§56).
// Se un domani servisse, andrebbe aggiunto QUI e sarebbe visibile in revisione,
// invece di comparire come una riga in mezzo a una Edge Function.
//
// Modulo PORTABILE: nessuna API Deno, nessuna lettura di ambiente. La
// configurazione arriva per parametro, così gli stessi adapter girano nei test
// con un `fetch` finto e payload sintetici.
// ============================================================================

export type CalendarProviderId = 'google' | 'microsoft';

/** Identità dell'account collegato, letta dal provider dopo il consenso. */
export interface CalendarAccountIdentity {
  /** Identificativo STABILE. Non l'indirizzo, che può essere un alias o cambiare. */
  accountId: string;
  emailAddress: string;
}

export interface CalendarOAuthTokens {
  accessToken: string;
  /** Assente quando il provider non ne emette uno nuovo al refresh: si conserva il precedente. */
  refreshToken: string | null;
  expiresAt: string;               // ISO 8601
  scopes: string[];
}

/**
 * Il contenuto di un evento, nella forma in cui il DOMINIO lo pensa.
 *
 * `date` è un giorno, non un istante: `tasks.due_date` è una DATA e inventare
 * un orario — le 9, le 17, mezzogiorno — significherebbe scrivere nel
 * calendario di una persona un'informazione che nessuno ha mai dato (§8).
 * Quando il dominio avrà un vero `due_at`, questo campo diventerà un istante e
 * il cambiamento sarà visibile qui, in un punto solo.
 */
export interface CalendarEventContent {
  /**
   * Chiave DETERMINISTICA dell'evento, derivata da (task, connessione).
   * Su Google diventa l'identificativo dell'evento — che l'API accetta dal
   * client — e su Microsoft il `transactionId`. In entrambi i casi è ciò che
   * impedisce a un ritentativo dopo un timeout di creare un secondo evento.
   */
  eventKey: string;
  title: string;
  description: string;
  /** Giorno di scadenza, `YYYY-MM-DD`. L'evento è di GIORNATA INTERA. */
  date: string;
  /** Identificativo dell'attività, scritto nei metadati applicativi dell'evento. */
  taskId: string;
}

/** Esito di una scrittura: l'identificativo con cui ritrovare l'evento. */
export interface CalendarEventRef {
  providerEventId: string;
}

/** Configurazione di un provider. Arriva per parametro: mai letta dall'ambiente qui. */
export interface CalendarProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Microsoft: `common`, `organizations` o l'id del tenant. Ignorato da Google. */
  tenant?: string;
  /** Iniettabile per i test: nessuna rete. */
  fetchImpl?: typeof fetch;
}

/**
 * Contratto di un provider di calendario.
 *
 * `upsertEvent` è UNO solo e non una coppia create/update perché i due provider
 * raggiungono l'idempotenza per strade opposte: Google accetta un
 * identificativo scelto da noi, Microsoft no e va interrogato per metadato. Un
 * chiamante che dovesse scegliere fra `create` e `update` finirebbe per
 * riprodurre quella differenza nel worker — cioè fuori dall'adapter, che è
 * esattamente il posto in cui non deve stare (§115).
 */
export interface CalendarProviderAdapter {
  readonly id: CalendarProviderId;
  /** Gli scope realmente richiesti. La schermata del consenso li legge da qui. */
  readonly scopes: string[];

  buildAuthorizationUrl(input: { state: string; codeChallenge: string; loginHint?: string | null }): string;
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<CalendarOAuthTokens>;
  refresh(refreshToken: string): Promise<CalendarOAuthTokens>;

  getAccountIdentity(accessToken: string): Promise<CalendarAccountIdentity>;

  /**
   * Il calendario dedicato: lo ritrova se c'è, lo crea se non c'è.
   *
   * ⚠️ `calendarId` è un PARAMETRO e non qualcosa che l'adapter può cercare per
   * nome: con lo scope a privilegio minimo di Google (`calendar.app.created`)
   * l'applicazione non è autorizzata a elencare i calendari dell'utente. Se
   * l'identificativo salvato non corrisponde più a nulla — l'utente ha
   * cancellato il calendario — se ne crea uno nuovo e lo si dichiara con
   * `created`.
   */
  ensureDedicatedCalendar(input: {
    accessToken: string;
    calendarId: string | null;
    name: string;
  }): Promise<{ calendarId: string; name: string; created: boolean }>;

  /** Crea o aggiorna. Chiamarla cinque volte con lo stesso contenuto lascia UN evento. */
  upsertEvent(input: {
    accessToken: string;
    calendarId: string;
    /** Identificativo noto presso il provider, quando il collegamento esiste già. */
    providerEventId: string | null;
    event: CalendarEventContent;
  }): Promise<CalendarEventRef>;

  /** Cancella. Un evento già assente NON è un errore: l'esito voluto è raggiunto. */
  deleteEvent(input: {
    accessToken: string; calendarId: string; providerEventId: string;
  }): Promise<void>;

  /**
   * L'evento esiste ancora presso il provider? Serve alla riconciliazione, che
   * è l'unica cosa capace di accorgersi di una cancellazione fatta a mano.
   * Un evento «annullato» conta come assente: su Google una cancellazione
   * lascia una riga con `status: cancelled` che non compare in nessun calendario.
   */
  eventExists(input: {
    accessToken: string; calendarId: string; providerEventId: string;
  }): Promise<boolean>;

  /**
   * Ritrova l'evento di un'attività dai METADATI APPLICATIVI, senza conoscerne
   * l'identificativo. È la rete di sicurezza dopo una creazione il cui esito non
   * è arrivato: senza, un timeout dopo la scrittura produrrebbe un secondo
   * evento al ritentativo.
   */
  findEventByTask(input: {
    accessToken: string; calendarId: string; taskId: string;
  }): Promise<string | null>;

  /** Revoca il consenso presso il provider, dove è supportato. */
  revoke(input: { accessToken: string; refreshToken: string | null }): Promise<void>;
}

// ---- Errori tipizzati -------------------------------------------------------
// Un errore deve dire tre cose: se ha senso riprovare, se il consenso è saltato,
// e con quale codice registrarlo. `catch (e)` non distingue «Google è occupato»
// da «l'utente ha revocato l'accesso»: trattarli allo stesso modo significa o
// insistere per sempre o spegnere un calendario che funziona.

export type CalendarErrorCode =
  | 'PROVIDER_UNAVAILABLE'      // 5xx, rete, timeout — transitorio
  | 'PROVIDER_RATE_LIMITED'     // 429 — transitorio, con attesa indicata
  | 'AUTH_EXPIRED'              // token non rinnovabile, consenso revocato
  | 'AUTH_INSUFFICIENT_SCOPE'
  | 'CALENDAR_GONE'             // il calendario dedicato non esiste più
  | 'EVENT_CONFLICT'            // identificativo già in uso presso il provider
  | 'NOT_FOUND'
  | 'INVALID_RESPONSE'
  | 'CONFIG_MISSING'
  | 'UNKNOWN';

export class CalendarProviderError extends Error {
  readonly code: CalendarErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly status: number | null;

  constructor(
    code: CalendarErrorCode,
    message: string,
    options: { retryable?: boolean; retryAfterMs?: number | null; status?: number | null } = {},
  ) {
    super(message);
    this.name = 'CalendarProviderError';
    this.code = code;
    // Il default segue il codice: chi costruisce l'errore non deve ricordarsi
    // che un 5xx è ritentabile e una revoca no.
    this.retryable = options.retryable ?? (code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_RATE_LIMITED');
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.status = options.status ?? null;
  }
}
