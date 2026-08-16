// ============================================================================
// inboxService — lettura della Inbox.
//
// Due regole di forma che valgono per tutto il file:
//   · la lista NON scarica la posta. Ogni pagina è di 30 righe, la ricerca è un
//     `ilike` che usa l'indice trigram della 0013, e il corpo dei messaggi non
//     compare mai in una query di lista (§104/§105).
//   · la paginazione è a CURSORE su `(received_at, id)`. Con `offset`, la
//     pagina 40 di una casella attiva salta o ripete righe ogni volta che ne
//     arriva una nuova — e in una Inbox amministrativa una riga saltata è una
//     comunicazione che non è mai stata vista.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { etichettaDaRigaDocumento } from '@/lib/documentTitle';
import { AppError, toUserMessage } from '@/lib/errors';
import { daysUntil } from '@/lib/format';
import { deadlineLevel } from '@/features/admin-ai/engine';
import { QUERY_COMPRESSI, QUERY_IN_EVIDENZA } from '@/features/inbox/emphasis';
import type {
  EmailAttachment, EmailLink, EmailLinkedDocument, EmailMessageDetail, EmailMessageSummary,
  EmailRecipient, InboxFilter, InboxPage,
} from '@/types/models';
import type { Database } from '@/types/database';

type MessageRow = Database['public']['Tables']['email_messages']['Row'];

export const INBOX_PAGE_SIZE = 30;
/** «Urgenti»: scadenza già passata o entro questo numero di giorni. */
export const URGENT_WITHIN_DAYS = 30;

/** Colonne della LISTA: niente corpo, niente collegamenti, niente destinatari. */
const SUMMARY_COLUMNS =
  'id, company_id, connection_id, provider_thread_id, subject, sender_name, sender_email, ' +
  'received_at, body_preview, has_attachments, attachment_count, processing_status, ' +
  // `relevance_confidence` sta qui e non nel solo dettaglio perché la LISTA
  // decide con essa che peso dare a una riga (§emphasis): senza, «nel dubbio si
  // mostra» sarebbe una regola che il disegno dell'elenco non può applicare.
  'attention_status, relevance, relevance_confidence, seen_at, handled_at, error_code, analysis_deadline';

function toSummary(row: Partial<MessageRow> & { id: string }): EmailMessageSummary {
  const deadline = (row.analysis_deadline as string | null) ?? null;
  const days = daysUntil(deadline);
  return {
    id: row.id,
    companyId: row.company_id as string,
    connectionId: row.connection_id as string,
    threadId: row.provider_thread_id ?? null,
    subject: row.subject ?? null,
    senderName: row.sender_name ?? null,
    senderEmail: row.sender_email ?? null,
    receivedAt: row.received_at as string,
    preview: row.body_preview ?? null,
    hasAttachments: !!row.has_attachments,
    attachmentCount: row.attachment_count ?? 0,
    processingStatus: row.processing_status as EmailMessageSummary['processingStatus'],
    attentionStatus: row.attention_status as EmailMessageSummary['attentionStatus'],
    relevance: row.relevance ?? null,
    relevanceConfidence: row.relevance_confidence ?? null,
    seenAt: row.seen_at ?? null,
    handledAt: row.handled_at ?? null,
    errorCode: row.error_code ?? null,
    deadline,
    deadlineLevel: deadlineLevel(days),
    daysToDeadline: days,
  };
}

function parseRecipients(value: unknown): EmailRecipient[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((r) => r as { name?: unknown; email?: unknown })
    .filter((r) => typeof r.email === 'string' && r.email)
    .map((r) => ({ name: typeof r.name === 'string' ? r.name : null, email: r.email as string }));
}

function parseLinks(value: unknown): EmailLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((l) => l as { url?: unknown; label?: unknown; host?: unknown })
    .filter((l) => typeof l.url === 'string' && typeof l.host === 'string')
    .map((l) => ({
      url: l.url as string,
      label: typeof l.label === 'string' && l.label ? l.label : (l.host as string),
      host: l.host as string,
    }));
}

/** Cursore opaco per il client: la sua forma è un dettaglio di questo file. */
function encodeCursor(row: { receivedAt: string; id: string }): string {
  return `${row.receivedAt}|${row.id}`;
}
function decodeCursor(cursor: string | null): { receivedAt: string; id: string } | null {
  if (!cursor) return null;
  const sep = cursor.lastIndexOf('|');
  if (sep <= 0) return null;
  const receivedAt = cursor.slice(0, sep);
  const id = cursor.slice(sep + 1);
  if (!receivedAt || !id) return null;
  return { receivedAt, id };
}

export interface InboxQuery {
  companyId: string;
  filter: InboxFilter;
  /**
   * Quale metà di «Tutte» si vuole: ciò che sta in evidenza o ciò che è
   * compresso in fondo. Assente = le due insieme, com'era prima della
   * divisione — ed è ancora la risposta giusta per gli altri filtri, che sono
   * una domanda esplicita dell'utente e non vanno riscritte da una regola di
   * presentazione.
   *
   * ⚠️ Le due metà sono un COMPLEMENTO, non due filtri indipendenti: insieme
   * danno esattamente l'elenco intero. Le espressioni stanno in
   * `features/inbox/emphasis.ts`, non qui, perché la stessa regola serve anche
   * al browser per decidere il peso di una riga.
   */
  emphasis?: 'in_evidence' | 'collapsed';
  /** Testo cercato su oggetto, mittente e anteprima. */
  search?: string | null;
  connectionId?: string | null;
  withAttachments?: boolean;
  /** Data ISO minima di ricezione. */
  since?: string | null;
  cursor?: string | null;
  pageSize?: number;
}

/**
 * Le sole operazioni che servono a comporre l'ambito di una query di Inbox.
 *
 * Esiste perché lista e conteggio devono restringere ESATTAMENTE allo stesso
 * modo: se la riga compressa dicesse «72» e l'elenco che si apre ne mostrasse
 * 68, il numero non descriverebbe più l'insieme che promette. Un solo posto
 * che decide, due query che lo usano.
 */
interface AmbitoQuery {
  eq(column: string, value: unknown): AmbitoQuery;
  neq(column: string, value: unknown): AmbitoQuery;
  not(column: string, operator: string, value: unknown): AmbitoQuery;
  lte(column: string, value: unknown): AmbitoQuery;
  gte(column: string, value: unknown): AmbitoQuery;
  ilike(column: string, pattern: string): AmbitoQuery;
  or(filters: string): AmbitoQuery;
}

function applicaAmbito<Q>(builder: Q, query: InboxQuery): Q {
  let q = builder as unknown as AmbitoQuery;

  switch (query.filter) {
    case 'to_handle':
      q = q.eq('attention_status', 'needs_attention');
      break;
    case 'to_verify':
      q = q.eq('attention_status', 'to_verify');
      break;
    case 'urgent': {
      // «Urgente» qui significa una cosa sola e verificabile: l'analisi ha
      // trovato una scadenza, ed è passata o è vicina. Non è un punteggio.
      const limit = new Date(Date.now() + URGENT_WITHIN_DAYS * 86_400_000).toISOString().slice(0, 10);
      q = q.not('analysis_deadline', 'is', null).lte('analysis_deadline', limit).neq('attention_status', 'handled');
      break;
    }
    case 'handled':
      q = q.eq('attention_status', 'handled');
      break;
    case 'all':
    default:
      // «Tutti» è la vista operativa: contiene tutto ciò che non è stato
      // messo via, comprese le comunicazioni giudicate non amministrative —
      // che restano visibili, perché un errore di classificazione non deve
      // essere irreversibile.
      q = q.neq('attention_status', 'handled');
      if (query.emphasis === 'collapsed') {
        q = q.eq('attention_status', QUERY_COMPRESSI.eq.attention_status).or(QUERY_COMPRESSI.or);
      } else if (query.emphasis === 'in_evidence') {
        q = q.or(QUERY_IN_EVIDENZA.or);
      }
      break;
  }

  if (query.connectionId) q = q.eq('connection_id', query.connectionId);
  if (query.withAttachments) q = q.eq('has_attachments', true);
  if (query.since) q = q.gte('received_at', query.since);

  const search = (query.search ?? '').trim();
  if (search) {
    // `search_text` è la colonna generata dalla 0013, con indice trigram.
    // I caratteri jolly di LIKE vengono neutralizzati: `%` digitato da un
    // utente deve cercare un per cento, non «qualsiasi cosa».
    const escaped = search.replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 100);
    q = q.ilike('search_text', `%${escaped.toLowerCase()}%`);
  }

  return q as unknown as Q;
}

export const inboxService = {
  async list(query: InboxQuery): Promise<InboxPage> {
    const size = query.pageSize ?? INBOX_PAGE_SIZE;
    let q = applicaAmbito(
      requireSupabase()
        .from('email_messages')
        .select(SUMMARY_COLUMNS)
        .eq('company_id', query.companyId),
      query,
    );

    const cursor = decodeCursor(query.cursor ?? null);
    if (cursor) {
      q = q.or(`received_at.lt.${cursor.receivedAt},and(received_at.eq.${cursor.receivedAt},id.lt.${cursor.id})`);
    }

    // Ordinamento STABILE: la data da sola non basta, due messaggi arrivati
    // nello stesso istante si scambierebbero di posto fra una pagina e l'altra.
    const { data, error } = await q
      .order('received_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(size + 1);
    if (error) throw new AppError(toUserMessage(error), error);

    const rows = (data ?? []) as unknown as (Partial<MessageRow> & { id: string })[];
    const hasMore = rows.length > size;
    const items = rows.slice(0, size).map(toSummary);
    return {
      items,
      nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null,
    };
  },

  /**
   * Quante righe ha l'insieme che questa query descrive.
   *
   * ⚠️ NON si contano le righe caricate. La lista è paginata a 30: «30
   * comunicazioni in evidenza» quando ce ne sono 76, o «30 non amministrative»
   * quando ce ne sono 72, sono due conteggi che descrivono la memoria del
   * browser spacciandola per l'insieme. È il difetto dei «19 documenti» contro
   * «2 di 2», e la regola che ne è uscita vale anche qui: ogni numero dichiara
   * l'insieme che conta.
   *
   * Prende la stessa `InboxQuery` della lista — emphasis compreso — perché
   * ricerca e casella devono restringere anche il conteggio: cercando
   * «Nespresso», «72 non amministrative» sarebbe falso.
   *
   * Query di sola testata: non scarica alcuna riga.
   */
  async count(query: Omit<InboxQuery, 'cursor' | 'pageSize'>): Promise<number> {
    const q = applicaAmbito(
      requireSupabase()
        .from('email_messages')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', query.companyId),
      query,
    );
    const { count, error } = await q;
    if (error) throw new AppError(toUserMessage(error), error);
    return count ?? 0;
  },

  /** Conteggi per i filtri. Query di sola testata: non scarica alcuna riga. */
  async counts(companyId: string): Promise<{ toHandle: number; toVerify: number; urgent: number }> {
    const sb = requireSupabase();
    const urgentLimit = new Date(Date.now() + URGENT_WITHIN_DAYS * 86_400_000).toISOString().slice(0, 10);
    const [toHandle, toVerify, urgent] = await Promise.all([
      sb.from('email_messages').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('attention_status', 'needs_attention'),
      sb.from('email_messages').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('attention_status', 'to_verify'),
      sb.from('email_messages').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).neq('attention_status', 'handled')
        .not('analysis_deadline', 'is', null).lte('analysis_deadline', urgentLimit),
    ]);
    return {
      toHandle: toHandle.count ?? 0,
      toVerify: toVerify.count ?? 0,
      urgent: urgent.count ?? 0,
    };
  },

  async get(messageId: string): Promise<EmailMessageDetail | null> {
    const sb = requireSupabase();
    const { data, error } = await sb.from('email_messages').select('*').eq('id', messageId).maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    if (!data) return null;
    const row = data as MessageRow;

    // Tre letture mirate invece di un'unica query con join annidati: ognuna usa
    // un indice, e insieme restano tre andate e ritorno su UN messaggio aperto.
    const [attachments, links, thread, connection] = await Promise.all([
      sb.from('email_attachments')
        .select('id, provider_attachment_id, filename, mime_type, declared_mime_type, size_bytes, is_inline, storage_path, import_status, skip_reason')
        .eq('email_message_id', messageId).order('created_at', { ascending: true }),
      sb.from('email_message_documents')
        // ⚠️ Anche il titolo del documento passa dalla regola del §6: qui si
        // legge quel che serve a comporlo — nome del file e ultima analisi —
        // perché «2.5» era un titolo vero, mostrato anche in questa lista.
        .select('document_id, relation, attachment_id, '
          + 'documents(title, original_filename, status, document_analyses(sender, document_type, confidence, analysis_status, created_at))')
        .eq('email_message_id', messageId),
      row.provider_thread_id
        ? sb.from('email_messages').select('id', { count: 'exact', head: true })
            .eq('company_id', row.company_id).eq('provider_thread_id', row.provider_thread_id)
        : Promise.resolve({ count: 1 }),
      sb.from('email_connections').select('email_address, provider').eq('id', row.connection_id).maybeSingle(),
    ]);

    const documentByAttachment = new Map<string, string>();
    const documents: EmailLinkedDocument[] = ((links.data ?? []) as unknown as {
      document_id: string; relation: 'body' | 'attachment'; attachment_id: string | null;
      documents: Record<string, unknown> | null;
    }[]).map((l) => {
      if (l.attachment_id) documentByAttachment.set(l.attachment_id, l.document_id);
      return {
        documentId: l.document_id,
        relation: l.relation,
        attachmentId: l.attachment_id,
        title: (l.documents?.title as string | null) ?? '',
        label: etichettaDaRigaDocumento(l.documents),
        status: (l.documents?.status ?? 'uploaded') as EmailLinkedDocument['status'],
      };
    });

    const attachmentList: EmailAttachment[] = ((attachments.data ?? []) as Record<string, unknown>[]).map((a) => ({
      id: a.id as string,
      emailMessageId: messageId,
      providerAttachmentId: a.provider_attachment_id as string,
      filename: (a.filename as string) ?? null,
      mimeType: (a.mime_type as string) ?? null,
      declaredMimeType: (a.declared_mime_type as string) ?? null,
      sizeBytes: (a.size_bytes as number) ?? null,
      isInline: !!a.is_inline,
      storagePath: (a.storage_path as string) ?? null,
      importStatus: a.import_status as EmailAttachment['importStatus'],
      skipReason: (a.skip_reason as string) ?? null,
      documentId: documentByAttachment.get(a.id as string) ?? null,
    }));

    const days = daysUntil(row.analysis_deadline);

    return {
      ...toSummary(row),
      deadline: row.analysis_deadline,
      deadlineLevel: deadlineLevel(days),
      daysToDeadline: days,
      toRecipients: parseRecipients(row.to_recipients),
      ccRecipients: parseRecipients(row.cc_recipients),
      sentAt: row.sent_at,
      bodyText: row.body_text,
      bodyLinks: parseLinks(row.body_links),
      isBulk: row.is_bulk,
      importance: row.importance,
      // `relevanceConfidence` arriva da `toSummary`: da quando la lista ne ha
      // bisogno per decidere il peso di una riga, la fiducia è un campo del
      // riassunto e ripeterla qui sarebbe una seconda scrittura dello stesso dato.
      relevanceReason: row.relevance_reason,
      errorMessageSafe: row.error_message_safe,
      attachments: attachmentList,
      documents,
      connection: connection.data
        ? {
            emailAddress: connection.data.email_address as string,
            provider: connection.data.provider as 'google' | 'microsoft',
          }
        : null,
      threadCount: Math.max(1, (thread as { count?: number }).count ?? 1),
    };
  },

  /**
   * «Visto»: stato LOCALE di AI-Swisse. Non tocca il letto/non letto del
   * provider, e in versione 1 non potrebbe farlo nemmeno volendo — il token
   * concede la sola lettura (§36).
   */
  async markSeen(messageId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('email_messages')
      .update({ seen_at: new Date().toISOString() })
      .eq('id', messageId)
      .is('seen_at', null);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  /**
   * «Metti via» / «Rimetti in lista». Toglie dalla vista operativa di
   * AI-Swisse: NON archivia su Gmail o Outlook (§37). Al ripristino è il
   * database a ricalcolare lo stato dalla classificazione, quindi il valore
   * inviato qui è solo l'intenzione.
   */
  async setHandled(messageId: string, handled: boolean): Promise<void> {
    const { error } = await requireSupabase()
      .from('email_messages')
      .update({ attention_status: handled ? 'handled' : 'to_verify' })
      .eq('id', messageId);
    if (error) throw new AppError(toUserMessage(error), error);
  },
};
