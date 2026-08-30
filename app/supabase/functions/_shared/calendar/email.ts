// ============================================================================
// NotificationEmailProvider — l'invio di email TRANSAZIONALI dell'applicazione.
//
// PRIMA DI SCRIVERE QUESTO FILE SI È CONTROLLATO SE ESISTESSE GIÀ (§41).
// Non esiste. L'unico SMTP del progetto è quello che Supabase Auth usa per la
// conferma dell'indirizzo e la reimpostazione della password: è configurato nel
// dashboard, appartiene al servizio di autenticazione e non è raggiungibile
// dall'applicazione. Riusarlo avrebbe significato mandare promemoria dal
// meccanismo che manda i link di accesso — cioè legare la posta di prodotto
// alla posta di sicurezza, e non poter più spegnere l'una senza l'altra.
//
// COSA NON SI È FATTO, ED È UNA SCELTA
//   · nessuna dipendenza nuova. Un SDK per mandare una POST con tre campi
//     aggiungerebbe superficie e aggiornamenti da seguire per zero guadagno:
//     la chiamata HTTP passa dallo stesso `providerFetch` di tutto il resto,
//     con lo stesso timeout e la stessa attesa esponenziale;
//   · nessuna casella Gmail personale come motore di invio. Funzionerebbe per
//     dieci email e poi il dominio finirebbe nello spam di tutti;
//   · nessun invio dal browser. La chiave sta in un secret della Edge Function
//     e non compare mai nel bundle.
//
// L'INTERFACCIA È SEPARATA DALL'IMPLEMENTAZIONE perché il provider è una
// decisione commerciale che cambierà. Il resto del codice conosce
// `NotificationEmailProvider`, non Resend.
//
// ⚠️ LO STATO «NON DISPONIBILE» È UNO STATO VERO (§79)
// Se la chiave non è configurata, `resolveEmailProvider()` restituisce `null` e
// la schermata delle impostazioni mostra le email come non disponibili invece
// di offrire un interruttore che non farebbe partire niente. Un interruttore
// acceso su un canale spento è la definizione di funzione simulata.
// ============================================================================
import { providerFetch } from '../email/http.ts';
import { EmailProviderError } from '../email/types.ts';
import { asCalendarError } from './http.ts';
import { CalendarProviderError } from './types.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Corpo in testo semplice. Nessun HTML: vedi il commento in fondo al file. */
  text: string;
  /**
   * Chiave di idempotenza. Il provider la usa per non consegnare due volte lo
   * stesso messaggio quando un ritentativo segue una richiesta il cui esito non
   * è mai arrivato. È l'identificativo della CONSEGNA, non della notifica:
   * due canali della stessa notifica sono due invii diversi.
   */
  idempotencyKey: string;
  /** Allegati scelti esplicitamente nei Documenti; il browser non passa mai byte o percorsi Storage. */
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}

export interface EmailSendResult {
  /** Identificativo presso il provider: è ciò che permette di dire «è partita». */
  providerMessageId: string | null;
}

export interface NotificationEmailProvider {
  readonly id: string;
  /** L'indirizzo mittente configurato. La UI lo mostra: chi riceve deve sapere da dove. */
  readonly from: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface EmailProviderConfig {
  apiKey: string;
  /** `Nome <indirizzo@dominio>` — il dominio dev'essere verificato presso il provider. */
  from: string;
  fetchImpl?: typeof fetch;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Implementazione Resend.
 *
 * Scelta perché espone un endpoint HTTP diretto con un header di idempotenza
 * documentato (`Idempotency-Key`, valido 24 ore, fino a 256 caratteri), che è
 * esattamente ciò che serve a un worker che può essere ritentato. Sostituirla
 * significa scrivere un altro oggetto che rispetta `NotificationEmailProvider`:
 * niente altro nel sistema cambia.
 */
export function createResendProvider(config: EmailProviderConfig): NotificationEmailProvider {
  return {
    id: 'resend',
    from: config.from,

    async send(message: EmailMessage): Promise<EmailSendResult> {
      try {
        const response = await providerFetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            // 256 caratteri è il tetto dichiarato dal provider: si taglia qui
            // invece di scoprire il limite con un 400 in produzione.
            'Idempotency-Key': message.idempotencyKey.slice(0, 256),
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.attachments?.length ? { attachments: message.attachments } : {}),
          }),
          fetchImpl: config.fetchImpl,
          // Due tentativi qui dentro; il terzo e il quarto li fa il worker con
          // la propria attesa, che sopravvive alla morte dell'isolate.
          attempts: 2,
          timeoutMs: 15_000,
        });

        const payload = JSON.parse(response.text || '{}') as { id?: string };
        return { providerMessageId: payload.id ?? null };
      } catch (error) {
        // Un 4xx che non sia 429 è un errore PERMANENTE: indirizzo rifiutato,
        // dominio non verificato, chiave revocata. Ritentarlo per giorni non lo
        // fa diventare valido, e lo si dichiara come definitivo perché il
        // worker smetta invece di insistere (§44).
        const translated = asCalendarError(error);
        if (error instanceof EmailProviderError && error.status && error.status >= 400 && error.status < 500
            && error.status !== 429) {
          throw new CalendarProviderError('INVALID_RESPONSE', translated.message, {
            retryable: false, status: error.status,
          });
        }
        throw translated;
      }
    },
  };
}

/**
 * Il corpo di un promemoria.
 *
 * ⚠️ COSA NON PUÒ ENTRARE QUI (§45): il corpo di un documento, il contenuto di
 * una comunicazione della Inbox, un allegato, un importo, un IBAN, una citazione
 * dell'analisi, un URL firmato verso un file. Un'email esce dal perimetro del
 * prodotto, attraversa server che non sono nostri e resta nella casella di chi
 * la riceve: è il posto meno adatto in cui far arrivare quei dati.
 *
 * Resta: l'azienda, il titolo dell'attività, la scadenza, un collegamento.
 * Chi apre il collegamento è già autenticato e vede il resto lì dentro.
 *
 * TESTO SEMPLICE E NON HTML, per la stessa ragione per cui l'Inbox non conserva
 * l'HTML dei messaggi in arrivo: dove non c'è markup non esiste il difetto
 * «mi sono dimenticato di sanificare», e un titolo di attività scritto da una
 * persona non può diventare markup dentro il client di posta di un'altra.
 */
export function buildReminderEmail(input: {
  subject: string;
  companyName: string;
  taskTitle: string;
  deadlineLine: string;
  actionLabel: string;
  url: string;
  footer: string;
  extraLine?: string | null;
}): { subject: string; text: string } {
  const lines = [
    input.companyName,
    '',
    input.taskTitle,
    input.deadlineLine,
  ];
  if (input.extraLine) lines.push('', input.extraLine);
  lines.push('', `${input.actionLabel}: ${input.url}`, '', '—', input.footer);
  return { subject: input.subject, text: lines.join('\n') };
}
