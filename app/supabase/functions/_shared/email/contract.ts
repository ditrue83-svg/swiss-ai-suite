// ============================================================================
// Valori e limiti condivisi fra database, Edge Function, test e interfaccia.
//
// Gli array qui sotto rispecchiano gli enum della migrazione 0013. Sono in un
// modulo solo perché tre punti del sistema devono concordare sugli stessi
// valori — SQL, server, client — e tre copie divergono sempre. Se la 0013
// cambia, cambia qui, e i test lo rilevano.
//
// I limiti sono COSTANTI DICHIARATE (§44): un numero scritto in mezzo a una
// funzione è una decisione nascosta. Chi legge questo file sa esattamente
// quanta posta viene importata al primo collegamento e perché.
// ============================================================================

export const RELEVANCE_VALUES = [
  'likely_actionable', 'possibly_actionable', 'informational', 'clearly_irrelevant',
] as const;
export type EmailRelevanceValue = (typeof RELEVANCE_VALUES)[number];

export const ATTENTION_VALUES = [
  'needs_attention', 'to_verify', 'informational', 'ignored', 'handled',
] as const;
export type EmailAttentionValue = (typeof ATTENTION_VALUES)[number];

export const PROCESSING_VALUES = [
  'pending', 'classifying', 'importing', 'analyzing', 'done', 'failed',
] as const;
export type EmailProcessingValue = (typeof PROCESSING_VALUES)[number];

/**
 * Dove finisce un messaggio in base alla classificazione. È la stessa tabella
 * della funzione SQL `email_attention_for_relevance`: il ripristino di un
 * messaggio «messo via» avviene nel database, l'assegnazione iniziale qui, e le
 * due strade devono portare allo stesso posto.
 */
export function attentionForRelevance(relevance: EmailRelevanceValue | null): EmailAttentionValue {
  switch (relevance) {
    case 'likely_actionable': return 'needs_attention';
    case 'possibly_actionable': return 'to_verify';
    case 'informational': return 'informational';
    case 'clearly_irrelevant': return 'ignored';
    default: return 'to_verify';
  }
}

// ---- Politica di importo iniziale (§44) -------------------------------------

/**
 * Al primo collegamento non si importa la storia di una casella. Si importano
 * gli ultimi 30 giorni, al massimo 80 messaggi, dalla posta in arrivo.
 *
 * Perché 30 giorni: le comunicazioni amministrative svizzere hanno termini che
 * si misurano in settimane (10, 20, 30 giorni). Un mese copre ciò che è ancora
 * azionabile senza risalire ad archeologia.
 * Perché 80 messaggi: è il tetto che tiene la prima classificazione entro un
 * costo prevedibile, e nessuna PMI riceve più di 80 comunicazioni amministrative
 * al mese — se le riceve, la riconciliazione periodica recupera il resto.
 */
export const INITIAL_SYNC_DAYS = 30;
export const INITIAL_SYNC_MAX_MESSAGES = 80;

/** Quanti messaggi al massimo per singola esecuzione incrementale. */
export const INCREMENTAL_MAX_MESSAGES = 50;

/** Finestra della riconciliazione periodica (§45): copre eventuali eventi persi. */
export const RECONCILE_WINDOW_HOURS = 72;
export const RECONCILE_MAX_MESSAGES = 60;

// ---- Allegati ---------------------------------------------------------------

/** Allineato al limite del bucket `company-documents` (migrazione 0009). */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** Oltre questo numero non si importa: una email con 40 allegati non è una pratica. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** Sotto questa soglia un'immagine è quasi sempre un logo di firma, non un documento. */
export const MIN_IMAGE_ATTACHMENT_BYTES = 20 * 1024;

// ---- Lease di sincronizzazione (§125) ---------------------------------------

/**
 * Durata del lock. Scelto più lungo del tempo massimo di una sincronizzazione e
 * più corto della pazienza di un utente davanti al pulsante «Sincronizza»: se
 * il processo muore, la casella si sblocca da sola entro questo tempo.
 */
export const SYNC_LEASE_SECONDS = 300;

/** Intervallo minimo fra due sincronizzazioni manuali della stessa casella (§126). */
export const MANUAL_SYNC_MIN_INTERVAL_SECONDS = 60;

// ---- Rinnovo delle sottoscrizioni push --------------------------------------

/**
 * Gmail richiede di rinnovare il `watch` almeno ogni 7 giorni; Microsoft Graph
 * ammette per la posta un massimo di poco meno di 3 giorni. Si rinnova con
 * abbondante anticipo perché un rinnovo mancato non si nota: le notifiche
 * semplicemente smettono di arrivare, ed è esattamente il guasto silenzioso che
 * la riconciliazione periodica esiste per coprire.
 */
export const WATCH_RENEW_BEFORE_HOURS = 12;
export const GOOGLE_WATCH_RENEW_EVERY_HOURS = 24;
export const MICROSOFT_SUBSCRIPTION_MINUTES = 4200;      // ~70 ore, sotto il massimo consentito

/** Codici di errore applicativi dell'Inbox, mappati in messaggi tradotti lato UI. */
export const INBOX_ERROR_CODES = [
  'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'AUTH_EXPIRED', 'AUTH_INSUFFICIENT_SCOPE',
  'CURSOR_EXPIRED', 'SUBSCRIPTION_GONE', 'NOT_FOUND', 'INVALID_RESPONSE', 'CONFIG_MISSING',
  'SYNC_BUSY', 'QUOTA_EXCEEDED', 'ATTACHMENT_FAILED', 'ANALYSIS_FAILED', 'UNKNOWN',
] as const;
export type InboxErrorCode = (typeof INBOX_ERROR_CODES)[number];
