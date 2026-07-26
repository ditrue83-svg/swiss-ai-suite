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

export const CLASSIFIER_VERSION = 'prescreen-1';

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
