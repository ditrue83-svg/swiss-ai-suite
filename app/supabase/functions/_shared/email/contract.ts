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
  // ⚠️ `ignored` è il giudizio della MACCHINA («non amministrativa»);
  // `dismissed` è la decisione di una PERSONA («non ci riguarda»), nata con la
  // 0044. Sono due affermazioni diverse e non si sovrascrivono a vicenda.
  'needs_attention', 'to_verify', 'informational', 'ignored', 'dismissed', 'handled',
] as const;
export type EmailAttentionValue = (typeof ATTENTION_VALUES)[number];

export const PROCESSING_VALUES = [
  'pending', 'classifying', 'importing', 'awaiting_analysis', 'analyzing', 'done', 'failed',
] as const;
export type EmailProcessingValue = (typeof PROCESSING_VALUES)[number];

/**
 * Dove finisce un messaggio in base alla classificazione. È la stessa tabella
 * della funzione SQL `email_attention_for_relevance`: il ripristino di un
 * messaggio «messo via» avviene nel database, l'assegnazione iniziale qui, e le
 * due strade devono portare allo stesso posto.
 *
 * ⚠️⚠️ DAL 2026-08-23 NON PRODUCE PIÙ `needs_attention` (D-13, migrazione 0043).
 * `likely_actionable` portava a «Da gestire», e sulla casella vera quello stato
 * conteneva 22 messaggi: 15 da `stripe.com` e 7 da `mail.anthropic.com`, cioè
 * 22 su 22 fatture del titolare. Un classificatore può dire «questa sembra
 * azionabile»; non può dire «la tua azienda deve occuparsene», perché non sa di
 * chi sia il documento né se riguardi l'azienda — è la stessa distinzione che
 * `analysisTrust.ts` fa fra confidenza di lettura e attendibilità.
 *
 * «Da gestire» resta nell'enum e resta raggiungibile: lo produce una PERSONA
 * promuovendo un messaggio a documento. Lo stato di attenzione lo decide chi
 * amministra, non la macchina.
 */
export function attentionForRelevance(relevance: EmailRelevanceValue | null): EmailAttentionValue {
  switch (relevance) {
    case 'likely_actionable': return 'to_verify';
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

/**
 * Quante analisi documentali smaltire per esecuzione dalla coda.
 *
 * Deliberatamente basso e inferiore al limite di quota: la coda esiste proprio
 * per distribuire nel tempo un lavoro che tutto insieme non passerebbe. Meglio
 * dieci esecuzioni da cinque che una da cinquanta che fallisce a metà.
 */
export const ANALYSIS_DRAIN_BATCH = 5;

/**
 * Sotto questa lunghezza il corpo di un messaggio non contiene una pratica.
 * «Ok, grazie» non si analizza: si dichiara che non c'era niente da analizzare.
 */
export const MIN_BODY_CHARS_FOR_ANALYSIS = 40;

/**
 * Quanto può durare UNA esecuzione prima di consegnare il lavoro alla
 * successiva.
 *
 * Supabase chiude una richiesta che non risponde entro **150 secondi**
 * (`IDLE_TIMEOUT`), e l'isolate viene ucciso: il `finally` non gira e restano
 * stati appesi. Misurato sul campo il 2026-07-27, sulla casella reale: la
 * manutenzione ha impiegato 133 secondi per cinque analisi ed è stata uccisa
 * mentre iniziava la sesta.
 *
 * Il lavoro dell'Inbox è a lotti per costruzione — la coda esiste proprio per
 * distribuirlo nel tempo — quindi fermarsi in tempo e lasciare il resto alla
 * prossima esecuzione non toglie niente a nessuno, mentre farsi uccidere sì.
 */
export const EDGE_TIME_BUDGET_MS = 100_000;

/**
 * Spazio da lasciare libero prima di iniziare un'ALTRA analisi documentale.
 *
 * Un'analisi (estrazione, modello, validazione, persistenza) ha impiegato fra i
 * 22 e i 30 secondi sui documenti reali di questa casella. Quaranta secondi
 * danno margine al caso lento: se non ci stanno, non si comincia. Controllare
 * solo «il budget non è ancora finito» non basterebbe — si comincerebbe
 * un'analisi con dieci secondi davanti, e la si perderebbe a metà.
 */
export const ANALYSIS_SLOT_MS = 40_000;

/**
 * Dopo quanto un messaggio o una sincronizzazione «in lavorazione» è, con
 * certezza, un lavoro interrotto e non un lavoro lento.
 *
 * Un'Edge Function non vive più di qualche minuto e il lease di sincronizzazione
 * dura {@link SYNC_LEASE_SECONDS}: mezz'ora è molto oltre qualunque esecuzione
 * viva, quindi non c'è modo di dichiarare interrotto qualcosa che sta ancora
 * lavorando. Serve perché un isolate ucciso a metà non esegue il proprio
 * `finally`: lo stato resta appeso, e uno stato appeso è indistinguibile da un
 * lavoro in corso — cioè è un guasto che si presenta come normalità.
 */
export const STALE_PROCESSING_MINUTES = 30;

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
  'SYNC_BUSY', 'QUOTA_EXCEEDED', 'ATTACHMENT_FAILED', 'ANALYSIS_FAILED', 'INTERRUPTED',
  'TIME_BUDGET', 'UNKNOWN',
  // Dal 2026-07-31: la classificazione dice PERCHÉ è caduta, invece di un
  // unico codice opaco. `AI_CREDIT_EXHAUSTED` e `INVALID_RESPONSE` sono i due
  // guasti opposti che prima finivano insieme in `CLASSIFY_FAILED` — il primo
  // si riprende da solo, il secondo no.
  'AI_CREDIT_EXHAUSTED', 'CLASSIFY_FAILED',
  // ⚠️ Dal 2026-08-01. NON è «risposta non valida»: il modello stava
  // rispondendo bene ed è stato tagliato dal tetto di token che abbiamo scelto
  // NOI. Chiamarlo in un altro modo manda a cercare il guasto dove non è.
  'AI_OUTPUT_TRUNCATED',
  // ⚠️ Dal 2026-08-24 (D-13, PARTE B). Un messaggio senza corpo non produce un
  // documento vuoto: «non c'è niente da aggiungere» è un fatto e si dice. Un
  // documento di zero byte in archivio avrebbe l'aria di lavoro fatto.
  'EMPTY_BODY',
] as const;
export type InboxErrorCode = (typeof INBOX_ERROR_CODES)[number];
