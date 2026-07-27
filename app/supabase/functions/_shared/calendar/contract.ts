// ============================================================================
// Le costanti del calendario e delle notifiche, in un posto solo.
//
// Stanno qui — e non sparse fra worker e componenti — perché sono numeri che la
// UI DICHIARA all'utente e il server APPLICA. Quando le due copie divergono,
// l'interfaccia promette una cosa e il sistema ne fa un'altra: è già successo
// con l'Inbox, dove `INITIAL_SYNC_DAYS` era scritto due volte, e da allora un
// test verifica che le due copie coincidano.
//
// Modulo PORTABILE: nessuna API Deno, importabile dai test Node.
// ============================================================================

/** Fuso predefinito dei promemoria. È un DEFAULT, non una costante di dominio. */
export const DEFAULT_TIMEZONE = 'Europe/Zurich';

/**
 * Prima di quest'ora LOCALE non si genera nessun promemoria.
 *
 * Non è una sveglia puntuale: è un confine. Un job che gira ogni quarto d'ora
 * produce il promemoria alla prima esecuzione dopo le 8 del mattino di chi lo
 * riceve, e non lo produce più per quel giorno perché la chiave di
 * deduplicazione glielo impedisce. Se il job delle 8 salta, quello delle 8:15
 * lo recupera; se salta l'intera mattina, lo recupera il pomeriggio. Un orario
 * esatto («se sono le 8 allora manda») perderebbe il promemoria di chiunque al
 * primo job fallito (§37).
 */
export const REMINDER_LOCAL_HOUR = 8;

/** Le quattro finestre di promemoria, e il loro significato. */
export const REMINDER_KINDS = ['d7', 'd1', 'd0', 'overdue'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** Tipi di notifica. Devono coincidere con l'enum `notification_type` della 0018. */
export const NOTIFICATION_TYPES = [
  'task_assigned',
  'task_due_soon',
  'task_due_today',
  'task_overdue',
  'unassigned_task_due_soon',
  'calendar_sync_failed',
  'calendar_reauth_required',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Priorità oltre la quale un'attività SENZA responsabile diventa un problema di
 * chi guida l'azienda (§32). Non tutte le attività non assegnate: solo quelle
 * che qualcuno ha già giudicato urgenti. Un avviso che arriva sempre non viene
 * più letto.
 */
export const UNASSIGNED_ALERT_PRIORITY = 'high';
/** Entro quanti giorni un'attività urgente non assegnata fa scattare l'avviso. */
export const UNASSIGNED_ALERT_DAYS = 7;

/**
 * Budget di tempo di una Edge Function. Supabase chiude la richiesta a 150
 * secondi e uccide l'isolate: il `finally` non gira. Ogni worker si ferma prima
 * e lascia il resto all'esecuzione successiva — la lezione più cara dell'Inbox.
 */
export const EDGE_TIME_BUDGET_MS = 100_000;

/** Quante attività della coda si trattano per esecuzione. */
export const QUEUE_BATCH = 20;
/** Per quanto una riga della coda resta prenotata. Scade da sé se il worker muore. */
export const QUEUE_LOCK_SECONDS = 120;
/**
 * Dopo quanti tentativi falliti si smette di ritentare e si DICHIARA il
 * fallimento con una notifica (§122). Non zero — un guasto di rete non deve
 * allarmare — e non infinito, che significherebbe non accorgersene mai.
 */
export const QUEUE_MAX_ATTEMPTS = 5;

/** Attesa fra i tentativi della coda, in secondi: esponenziale, con tetto. */
export function queueBackoffSeconds(attempts: number): number {
  const base = Math.min(60 * 2 ** Math.max(0, attempts - 1), 3600);
  return base;
}

/** Quanto spesso una connessione viene riconciliata contro il provider. */
export const RECONCILE_EVERY_HOURS = 24;
/** Quante attività si riconciliano per connessione e per esecuzione. */
export const RECONCILE_BATCH = 50;

/** Tentativi massimi di consegna di un'email prima di dichiararla fallita. */
export const EMAIL_MAX_ATTEMPTS = 4;

/** Attesa fra i tentativi di invio, in secondi: esponenziale con jitter. */
export function emailBackoffSeconds(attempts: number, random = Math.random): number {
  const base = Math.min(120 * 2 ** Math.max(0, attempts - 1), 7200);
  return Math.round(base + random() * base * 0.3);
}

/** Sincronizzazione manuale: non più di una ogni tanti secondi, per connessione (§74). */
export const MANUAL_SYNC_MIN_INTERVAL_SECONDS = 60;

/**
 * Codici che la UI sa tradurre in una frase. Un codice fuori da questo elenco
 * NON viene mostrato grezzo: diventa il messaggio generico, che è la verità.
 */
export const CALENDAR_ERROR_CODES = [
  'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'AUTH_EXPIRED',
  'AUTH_INSUFFICIENT_SCOPE', 'CALENDAR_GONE', 'EVENT_CONFLICT',
  'NOT_FOUND', 'INVALID_RESPONSE', 'CONFIG_MISSING', 'UNKNOWN',
  'PROVIDER_NOT_CONFIGURED', 'SYNC_BUSY', 'SYNC_TOO_SOON', 'FORBIDDEN', 'UNAUTHENTICATED',
] as const;

/**
 * Nome del calendario dedicato. Un solo posto, perché è ciò che l'utente vede
 * accanto ai propri calendari e ciò con cui lo ritroviamo se un giorno servisse
 * cercarlo a mano.
 */
export function dedicatedCalendarName(companyName: string): string {
  const clean = companyName.trim().replace(/\s+/g, ' ');
  // Il trattino è un trattino lungo, come nel resto del prodotto.
  return `AI-Swisse — ${clean}`.slice(0, 200);
}

/** Chiave dei metadati applicativi scritti sull'evento presso il provider. */
export const TASK_METADATA_KEY = 'aiSwisseTaskId';

/**
 * GUID dell'insieme di proprietà estese usato su Microsoft Graph.
 *
 * Graph non ha un equivalente di `extendedProperties.private` di Google: le
 * proprietà applicative si scrivono come MAPI extended properties, e il loro
 * nome comprende un GUID scelto dall'applicazione. Questo è il nostro, generato
 * una volta e da non cambiare mai: cambiarlo renderebbe irreperibili tutti gli
 * eventi già scritti.
 */
export const MS_PROPERTY_SET_GUID = 'a11c9f2e-6d34-4b51-9a2f-0f7e1c5d8b40';
export const MS_TASK_PROPERTY = `String {${MS_PROPERTY_SET_GUID}} Name ${TASK_METADATA_KEY}`;
