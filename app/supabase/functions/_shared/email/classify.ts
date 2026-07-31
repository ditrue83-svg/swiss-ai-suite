// ============================================================================
// Pre-classificazione deterministica. Pura, offline, senza costi.
//
// A COSA SERVE (e a cosa NON serve)
// Serve a evitare di far leggere a un modello una newsletter di cui si può dire
// con certezza che non è amministrativa, e a dare una priorità di lettura. NON
// serve a decidere cosa è importante: quel giudizio resta al livello successivo.
//
// LA REGOLA CHE ORIENTA OGNI SOGLIA
// Un falso negativo amministrativo — una richiesta dell'AFC nascosta perché
// «sembrava pubblicità» — costa a un'azienda molto più di un falso positivo. Di
// conseguenza `clearly_irrelevant` richiede che TUTTI i segnali concordino, e
// basta un solo indizio amministrativo perché il messaggio prosegua. In dubbio
// si prosegue, sempre.
//
// PERCHÉ NON C'È UN DIZIONARIO DI PAROLE (§30)
// Un elenco di termini invecchia, non copre tre lingue in modo simmetrico e dà
// una falsa impressione di completezza. I segnali qui sotto sono quasi tutti
// STRUTTURALI: la forma del dominio del mittente, la presenza di un allegato
// PDF, la forma di un numero di riferimento o di un importo. La forma non
// dipende dalla lingua in cui è scritta la lettera.
// ============================================================================
import type { NormalizedEmailMessage } from './types.ts';
import { classifyProviderError } from '../validate.ts';

export const CLASSIFIER_VERSION = 'prescreen-1';

// ============================================================================
// PERCHÉ UNA CLASSIFICAZIONE FALLISCE — e perché la differenza conta
//
// Fino al 2026-07-31 ogni guasto della classificazione finiva in un unico
// codice, `CLASSIFY_FAILED`, e l'errore vero veniva buttato via. Il risultato
// misurato: 16 messaggi fermi in produzione con la causa NON RICOSTRUIBILE, e
// due guasti opposti confusi in uno solo. Le durate in `ai_request_log` hanno
// mostrato due popolazioni — 13 fallimenti in 124–551 ms (la chiamata non ha
// mai raggiunto il modello) e 3 in 1835–2791 ms in mezzo a 36 successi (il
// modello ha risposto, ed è caduto ciò che veniva dopo).
//
// La distinzione che serve è una sola: **il guasto è dell'AMBIENTE o del
// risultato?** Un ambiente che rifiuta torna a posto da solo, e il messaggio
// va ripreso; un risultato inutilizzabile no.
//
// ⚠️ La funzione che sa riconoscere il credito esaurito ESISTEVA GIÀ dal
// 2026-07-29 (`classifyProviderError` in `_shared/validate.ts`, con i suoi
// test) e questa strada non la chiamava: la usava solo `analyze-document`.
// Qui non se ne scrive una seconda — si traduce la sua risposta nel
// vocabolario dell'Inbox, che è l'unico che l'interfaccia sa mostrare.
// ============================================================================

/**
 * Il codice Inbox per un guasto dell'AI durante la classificazione.
 * Nessun codice nuovo inventato: sono tutti già in `INBOX_ERROR_CODES`.
 */
export function inboxCodeForAiError(error: unknown): string {
  // ⚠️ Un errore che porta GIÀ un codice esplicito lo conserva. È la stessa
  // precedenza di `analyze-document` (`err.code ?? classifyProviderError(err)`),
  // ed è il modo in cui il livello AI segnala ciò che `classifyProviderError`
  // non può dedurre dal messaggio — per esempio il tetto di token, che non è
  // un errore del fornitore ma una scelta nostra.
  const esplicito = (error as { code?: unknown } | null)?.code;
  if (typeof esplicito === 'string' && esplicito) return esplicito;

  switch (classifyProviderError(error)) {
    case 'AI_CREDIT_EXHAUSTED': return 'AI_CREDIT_EXHAUSTED';
    case 'RATE_LIMITED': return 'PROVIDER_RATE_LIMITED';
    // Il modello non ha risposto in tempo: è il servizio a monte a non esserci
    // stato, non la risposta a essere sbagliata.
    case 'AI_TIMEOUT': return 'PROVIDER_UNAVAILABLE';
    default: return 'CLASSIFY_FAILED';
  }
}

/**
 * I guasti che si RIPRENDONO da soli, e per i quali quindi il messaggio resta
 * in coda invece di essere chiuso come fallito.
 *
 * ⚠️ `CLASSIFY_FAILED` NON è qui, di proposito: è il secchio del «non lo
 * sappiamo», e riprovare all'infinito un guasto ignoto è il modo di bruciare
 * credito in silenzio. Un guasto ignoto resta fermo e visibile. Nemmeno
 * `AI_OUTPUT_TRUNCATED`: il tetto di token non si alza da solo.
 *
 * ⚠️⚠️ `INVALID_RESPONSE` C'È, E LA SCELTA È STATA RIFATTA SU UNA MISURA.
 * Il 2026-08-01 stava qui scritto il contrario — «riprovare la stessa domanda è
 * una scommessa, non un rimedio» — e la misura l'ha smentito: rieseguendo la
 * classificazione degli stessi messaggi, lo stesso identico testo a volte
 * produce un JSON leggibile e a volte no (0/3 in un giro e 1/1 in un altro;
 * 2/3 su un secondo messaggio). La risposta VARIA, quindi un secondo tentativo
 * non è una scommessa a probabilità fissa: è il rimedio normale a un
 * formattatore non deterministico.
 * **Ma una volta sola.** Il conteggio non ha bisogno di una colonna nuova: lo
 * porta il codice stesso, come `INTERRUPTED` fa già in questo modulo. Se il
 * secondo tentativo cade ANCORA per la stessa ragione, il messaggio passa a
 * `CLASSIFY_FAILED` — che è terminale, ha già la sua frase nelle tre lingue, e
 * dice la verità: non si è riusciti a stabilire se richieda attenzione.
 */
export const CLASSIFY_RETRYABLE_CODES = [
  'AI_CREDIT_EXHAUSTED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'INVALID_RESPONSE',
  // `INTERRUPTED` non è un codice nuovo e non è un'eccezione di comodo: in
  // questo repository significa già «l'esecuzione non è arrivata in fondo, e
  // merita un tentativo» — lo scrive `recoverInterrupted` sui messaggi uccisi
  // dal limite dei 150 secondi. Fino a oggi una classificazione interrotta così
  // restava ferma per sempre: nessuno la riprendeva. Ora sì.
  'INTERRUPTED',
] as const;

export function isClassifyRetryable(code: string | null | undefined): boolean {
  return !!code && (CLASSIFY_RETRYABLE_CODES as readonly string[]).includes(code);
}

/**
 * Che codice scrivere quando un RITENTATIVO cade a sua volta.
 *
 * L'unico caso che diventa terminale è la ripetizione IDENTICA: una risposta
 * illeggibile seguita da un'altra risposta illeggibile. Se il secondo
 * tentativo cade per una ragione d'AMBIENTE — credito, limite di frequenza,
 * servizio assente — quel codice resta, e il messaggio resta ripescabile:
 * l'ambiente non è colpa del messaggio, e contarglielo come tentativo bruciato
 * lo condannerebbe per un guasto di qualcun altro.
 */
export function codeAfterRetry(precedente: string | null | undefined, nuovo: string): string {
  return precedente === 'INVALID_RESPONSE' && nuovo === 'INVALID_RESPONSE'
    ? 'CLASSIFY_FAILED'
    : nuovo;
}

export type Prescreen = 'administrative' | 'unclear' | 'bulk_only';

export interface PrescreenSignals {
  /** Il dominio del mittente è quello di un'amministrazione svizzera. */
  senderIsSwissAuthority: boolean;
  /** Mittente da cui questa azienda ha già ricevuto posta amministrativa. */
  senderKnown: boolean;
  /** Almeno un allegato non incorporato e di tipo trattabile. */
  hasDocumentAttachment: boolean;
  hasReferenceNumber: boolean;
  mentionsAmount: boolean;
  mentionsDate: boolean;
  isBulk: boolean;
  isAutoReply: boolean;
}

export interface PrescreenResult {
  prescreen: Prescreen;
  /** true quando il messaggio non deve nemmeno essere sottoposto al modello. */
  skipAi: boolean;
  signals: PrescreenSignals;
  /** Segnali che richiedono cautela dell'utente (§85). Non nascondono nulla: avvisano. */
  cautionSignals: CautionSignal[];
  /** Elenco leggibile dei segnali attivi, per la diagnostica. Non è testo per l'utente. */
  reasons: string[];
}

export type CautionSignal = 'payment_details' | 'credentials' | 'urgency_pressure';

// ---- Segnali strutturali ----------------------------------------------------

/**
 * Domini dell'amministrazione svizzera, riconosciuti per FORMA:
 *   · `*.admin.ch`             Confederazione
 *   · `<qualcosa>.<cantone>.ch` cantoni e comuni (`sv.ti.ch`, `steueramt.zh.ch`)
 * Le sigle cantonali sono 26 e non cambiano: è un fatto istituzionale, non un
 * dizionario che invecchia. Un dominio non riconosciuto non viene penalizzato —
 * il segnale è positivo quando c'è, neutro quando manca.
 */
const CANTONS = 'ag|ai|ar|be|bl|bs|fr|ge|gl|gr|ju|lu|ne|nw|ow|sg|sh|so|sz|tg|ti|ur|vd|vs|zg|zh';
const AUTHORITY_DOMAIN = new RegExp(`(^|\\.)admin\\.ch$|(^|\\.)(${CANTONS})\\.ch$`, 'i');
/** Istituti di previdenza e assicurazioni sociali: dominio di secondo livello dedicato. */
const SOCIAL_INSURANCE_DOMAIN = /(^|\.)(ahv-iv|avs-ai|akbern|svazurich|suva|ausgleichskasse|caisseavs)\.[a-z.]{2,10}$/i;

/** Numero di riferimento: forma tipica delle pratiche amministrative. */
const REFERENCE_RE = /\b(?:CHE-\d{3}\.\d{3}\.\d{3}|[A-Z]{2,5}[-/ ]?\d{4,12}|\d{2}-\d{3,7}-\d)\b/;
/** Importo: la separazione svizzera delle migliaia con apostrofo è distintiva. */
const AMOUNT_RE = /(?:\bCHF\b|\bfr\.|\bEUR\b)\s*\d|(?:\b\d{1,3}(?:['’]\d{3})+(?:[.,]\d{2})?\b)|\b\d+[.,]\d{2}\s*(?:CHF|EUR|fr\.)/i;
const DATE_RE = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;

/** IBAN: due lettere, due cifre di controllo, poi il numero di conto. */
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}[ ]?[A-Z0-9]{1,4}\b/;

/**
 * Formule di cautela nelle tre lingue. Qui un elenco di parole è ammesso perché
 * il suo unico effetto è MOSTRARE UN AVVISO: un falso positivo produce una riga
 * «verifica prima di procedere», mai un messaggio nascosto o un'azione automatica.
 */
const PAYMENT_CHANGE = /\b(nuove? coordinate|nuovo iban|cambio (?:di )?iban|conto (?:bancario )?(?:è )?cambiat|neue kontoverbindung|neue bankverbindung|geänderte kontonummer|nouvelles? coordonnées|nouvel iban|changement de compte)\b/i;
const CREDENTIALS = /\b(password|passwort|mot de passe|credenziali|zugangsdaten|identifiants|codice di accesso|verifica il tuo account|konto verifizieren|vérifiez votre compte)\b/i;
const URGENCY_PRESSURE = /\b(entro 24 ore|entro oggi|immediatamente|sofort|innerhalb von 24 stunden|sous 24 heures|immédiatement|ultimo avviso|letzte mahnung|dernier avis)\b/i;

/** MIME che la pipeline documentale sa davvero trattare (allineato alla 0009). */
const DOCUMENT_MIME = /^(application\/pdf|image\/(png|jpe?g|webp|heic|tiff)|text\/plain)$/i;

function domainOf(email: string | null | undefined): string {
  const at = (email ?? '').lastIndexOf('@');
  return at < 0 ? '' : email!.slice(at + 1).toLowerCase();
}

export interface PrescreenInput {
  message: NormalizedEmailMessage;
  /** Testo già depurato di storico e firma; se assente si usa il corpo intero. */
  cleanBody?: string | null;
  /** L'azienda ha già ricevuto posta amministrativa da questo mittente. */
  senderKnown?: boolean;
  /** Header `Auto-Submitted` del messaggio, quando disponibile. */
  autoSubmitted?: string | null;
}

export function prescreen(input: PrescreenInput): PrescreenResult {
  const { message } = input;
  const domain = domainOf(message.from?.email);
  const haystack = [
    message.subject ?? '',
    input.cleanBody ?? message.textBody ?? '',
  ].join('\n').slice(0, 20_000);          // limite: oltre non cambia l'esito

  const signals: PrescreenSignals = {
    senderIsSwissAuthority: !!domain && (AUTHORITY_DOMAIN.test(domain) || SOCIAL_INSURANCE_DOMAIN.test(domain)),
    senderKnown: !!input.senderKnown,
    hasDocumentAttachment: message.attachments.some(
      (a) => !a.isInline && DOCUMENT_MIME.test(a.declaredMimeType ?? ''),
    ),
    hasReferenceNumber: REFERENCE_RE.test(haystack),
    mentionsAmount: AMOUNT_RE.test(haystack),
    mentionsDate: DATE_RE.test(haystack),
    isBulk: message.isBulk,
    isAutoReply: /auto-replied/i.test(input.autoSubmitted ?? ''),
  };

  const cautionSignals: CautionSignal[] = [];
  if (IBAN_RE.test(haystack) || PAYMENT_CHANGE.test(haystack)) cautionSignals.push('payment_details');
  if (CREDENTIALS.test(haystack)) cautionSignals.push('credentials');
  if (URGENCY_PRESSURE.test(haystack)) cautionSignals.push('urgency_pressure');

  const reasons: string[] = [];
  for (const [name, on] of Object.entries(signals)) if (on) reasons.push(name);

  // Un solo indizio amministrativo basta a proseguire.
  const administrativeHints =
    signals.senderIsSwissAuthority ||
    signals.senderKnown ||
    signals.hasDocumentAttachment ||
    signals.hasReferenceNumber ||
    (signals.mentionsAmount && signals.mentionsDate);

  // Risposta automatica di assenza senza allegati: è informativa per costruzione.
  if (signals.isAutoReply && !signals.hasDocumentAttachment) {
    return { prescreen: 'bulk_only', skipAi: true, signals, cautionSignals, reasons };
  }

  // Posta di massa E nessun indizio amministrativo: qui si può fermare senza
  // spendere. Se anche uno solo degli indizi fosse presente non si fermerebbe.
  if (signals.isBulk && !administrativeHints) {
    return { prescreen: 'bulk_only', skipAi: true, signals, cautionSignals, reasons };
  }

  return {
    prescreen: administrativeHints ? 'administrative' : 'unclear',
    skipAi: false,
    signals,
    cautionSignals,
    reasons,
  };
}

/**
 * Testo che viene sottoposto al modello per la classificazione (§52, minimizzazione).
 * Si mandano oggetto, mittente e l'inizio del corpo depurato: quanto basta per
 * dire se una comunicazione è amministrativa. Non si mandano header tecnici,
 * destinatari, storico citato né allegati — che a questo stadio non servono e
 * sarebbero dati personali trasmessi senza motivo.
 */
export const CLASSIFY_BODY_CHARS = 4000;

export function buildClassifierInput(message: NormalizedEmailMessage, cleanBody: string | null): {
  sender: string; subject: string; body: string; attachments: string[];
} {
  return {
    sender: message.from?.email ?? '',
    subject: message.subject ?? '',
    body: (cleanBody ?? message.textBody ?? '').slice(0, CLASSIFY_BODY_CHARS),
    // Dei allegati si manda il TIPO e il nome, non il contenuto: al
    // classificatore serve sapere che c'è un PDF, non cosa contiene.
    attachments: message.attachments
      .filter((a) => !a.isInline)
      .slice(0, 10)
      .map((a) => `${a.filename ?? 'senza nome'} (${a.declaredMimeType ?? 'tipo ignoto'})`),
  };
}
