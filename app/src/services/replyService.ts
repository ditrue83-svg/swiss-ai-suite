// ============================================================================
// replyService — bozze di risposta generate SU RICHIESTA (§35), server-side.
// La generazione avviene nella Edge Function `generate-reply` (Claude), che
// salva in document_replies e NON invia nulla (§39). Qui: genera, rilegge,
// salva le modifiche umane. Nessun testo del documento passa dal client.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { DETERMINISTIC_ENGINE } from './analysisProviders';
import type { Database } from '@/types/database';
import type { DocumentReply } from '@/types/models';
import { translate as tr } from '@/i18n';

type ReplyRow = Database['public']['Tables']['document_replies']['Row'];

function toReply(row: ReplyRow): DocumentReply {
  return {
    id: row.id,
    documentId: row.document_id,
    companyId: row.company_id,
    analysisId: row.analysis_id,
    language: row.language,
    tone: row.tone,
    content: row.content,
    provider: row.provider,
    model: row.model,
    isEdited: row.is_edited,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface GenReplyResponse { reply?: ReplyRow; error?: string; code?: string }

async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).json()) as GenReplyResponse;
      if (body?.error) return body.error;
    } catch { /* corpo non JSON */ }
  }
  return fallback;
}

export interface GenerateReplyInput {
  documentId: string;
  language: string;
  tone: string;
  userNotes?: string | null;
}

export const replyService = {
  /** Ultima bozza salvata per il documento (per riaprirla senza rigenerare). */
  async getLatest(documentId: string): Promise<DocumentReply | null> {
    const { data, error } = await requireSupabase()
      .from('document_replies')
      .select('*')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    return data ? toReply(data) : null;
  },

  /** Genera una nuova bozza con l'AI (§35). La funzione la persiste in document_replies. */
  async generate(input: GenerateReplyInput): Promise<DocumentReply> {
    const { data, error } = await requireSupabase().functions.invoke<GenReplyResponse>('generate-reply', {
      body: { documentId: input.documentId, language: input.language, tone: input.tone, userNotes: input.userNotes ?? null },
    });
    if (error) throw new AppError(await readFunctionError(error, tr('errors.replyFailed')), error);
    if (!data?.reply) throw new AppError(data?.error ?? tr('errors.replyNotGenerated'));
    return toReply(data.reply);
  },

  /** Salva la versione modificata dall'utente (§34: la modifica umana è tracciata). */
  async saveEdit(replyId: string, content: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('document_replies')
      .update({ content, is_edited: true })
      .eq('id', replyId);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  /**
   * Bozza del MOTORE LOCALE (§60), prodotta da un template deterministico nel
   * browser e non dall'AI.
   *
   * Prima della 0010 finiva in document_analyses.reply_draft, e per scriverla
   * serviva il permesso di update sull'intera analisi. Ora vive qui come tutte
   * le altre bozze: `provider` dichiara che l'ha generata il motore locale, così
   * una bozza template non viene mai scambiata per una prodotta dal modello.
   */
  async saveLocalDraft(input: {
    /** id della bozza già esistente per questo documento; assente = prima bozza */
    replyId?: string | null;
    documentId: string;
    companyId: string;
    analysisId: string;
    userId: string;
    language: string;
    tone: string;
    content: string;
    /** true = testo ritoccato a mano, false = template rigenerato tale e quale */
    isEdited: boolean;
  }): Promise<DocumentReply> {
    const sb = requireSupabase();

    if (input.replyId) {
      const { data, error } = await sb
        .from('document_replies')
        .update({ content: input.content, language: input.language, tone: input.tone, is_edited: input.isEdited })
        .eq('id', input.replyId)
        .select('*')
        .single();
      if (error || !data) throw new AppError(toUserMessage(error), error);
      return toReply(data);
    }

    const { data, error } = await sb
      .from('document_replies')
      .insert({
        document_id: input.documentId,
        company_id: input.companyId,
        analysis_id: input.analysisId,
        created_by: input.userId,          // richiesto dalla policy replies_insert_member
        language: input.language,
        tone: input.tone,
        content: input.content,
        provider: DETERMINISTIC_ENGINE,
        is_edited: input.isEdited,
      })
      .select('*')
      .single();
    if (error || !data) throw new AppError(toUserMessage(error), error);
    return toReply(data);
  },
};
