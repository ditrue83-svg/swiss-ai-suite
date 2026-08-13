// Pezzi riusati dalla lista e dal dettaglio della Inbox.
//
// Stanno insieme perché rispondono alla stessa domanda — come si mostra lo
// stato di un messaggio — e perché due copie di questa risposta diventerebbero
// due verità diverse nella stessa schermata.
import { Icon } from '@/components/ui/Icon';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { ProvenanceMark } from '@/components/ui/ProvenanceMark';
import { useT, type TFunction } from '@/i18n';
import type { EmailAttentionStatus, EmailMessageSummary } from '@/types/models';

/** Etichetta del mittente: il nome se c'è, altrimenti l'indirizzo. Mai vuoto. */
export function senderLabel(message: { senderName: string | null; senderEmail: string | null }, t: TFunction): string {
  return message.senderName?.trim() || message.senderEmail || t('inbox.unknownSender');
}

/** §113 — un oggetto assente si dichiara tradotto, non si scrive nel database. */
export function subjectLabel(subject: string | null, t: TFunction): string {
  return subject?.trim() || t('inbox.noSubject');
}

const ATTENTION_KEY: Record<EmailAttentionStatus, `inbox.attention.${EmailAttentionStatus}`> = {
  needs_attention: 'inbox.attention.needs_attention',
  to_verify: 'inbox.attention.to_verify',
  informational: 'inbox.attention.informational',
  ignored: 'inbox.attention.ignored',
  handled: 'inbox.attention.handled',
};

/**
 * Classe della pastiglia. Il colore NON è l'unica informazione (§67): il testo
 * dice già di cosa si tratta, e chi non distingue i colori legge la stessa cosa.
 */
function attentionClass(status: EmailAttentionStatus, urgent: boolean): TagTone {
  if (status === 'needs_attention') return urgent ? 'alert' : 'attention';
  return 'neutral';
}

/**
 * ⚠️ Fino al 2026-08-12 questa pastiglia mescolava DUE assi: il valore
 * EPISTEMICO «da verificare» (un giudizio sulla lettura) e il tono scalato
 * dal livello di scadenza (un'urgenza operativa). Ora «da verificare» è il
 * segno della famiglia provenienza — il filetto puntinato, lo stesso di
 * documenti e analisi — e la pastiglia resta all'attenzione operativa.
 */
export function AttentionBadge({ message }: { message: EmailMessageSummary }) {
  const t = useT();
  if (message.attentionStatus === 'to_verify') return <ProvenanceMark kind="toVerify" />;
  const urgent = message.deadlineLevel === 'scaduta' || message.deadlineLevel === 'urgente';
  return (
    <Tag tone={attentionClass(message.attentionStatus, urgent)}>
      {t(ATTENTION_KEY[message.attentionStatus])}
    </Tag>
  );
}

/**
 * Stato della PIPELINE, distinto dallo stato di attenzione (§8). Si mostra solo
 * quando c'è qualcosa da dire: un'elaborazione in corso o un esame fallito. Un
 * messaggio a posto non ha bisogno di annunciarlo.
 *
 * Un fallimento dell'esame NON nasconde il messaggio e non lo dichiara
 * irrilevante: dice che non è stato esaminato (§102).
 */
export function ProcessingNote({ message }: { message: EmailMessageSummary }) {
  const t = useT();
  if (message.processingStatus === 'done' || message.processingStatus === 'pending') return null;
  const failed = message.processingStatus === 'failed';
  return (
    <span className={`inbox-processing${failed ? ' is-failed' : ''}`}>
      {failed
        ? <Icon name="alert" className="ic-sm" />
        : <span className="spinner" aria-hidden="true" />}
      {t(`inbox.processing.${message.processingStatus}` as const)}
    </span>
  );
}
