// ============================================================================
// analysisService — orchestrazione dell'analisi documenti.
// La UI chiama analyzeAndPersist()/getForDocument() SENZA sapere se il
// risultato viene dal motore deterministico o (in futuro) da un LLM: basta
// sostituire `runEngine` con una chiamata a un servizio AI, la forma resta.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { formatCurrency } from '@/lib/format';
import {
  buildReply, deadlineLevel, daysUntil, urgencyFromType,
  LANG_LABEL, DOC_TYPE_LABEL, type EngineAnalysis,
} from '@/features/admin-ai/engine';
import { runAnalysisProvider } from './analysisProviders';
import type {
  ChecklistAction, Confidence, DocumentAnalysis, DocumentRecord, Evidence,
  RequestedDocument, Risk, Urgency,
} from '@/types/models';
import type { Database, Json } from '@/types/database';

type AnalysisRow = Database['public']['Tables']['document_analyses']['Row'];

// ---- Mapping domain <-> DB --------------------------------------------------
function engineToInsert(
  e: EngineAnalysis,
  documentId: string,
  companyId: string,
  engine: string,
): Database['public']['Tables']['document_analyses']['Insert'] {
  return {
    document_id: documentId,
    company_id: companyId,
    analysis_version: 2,
    engine,
    language: e.language,
    sender: e.sender,
    sender_evidence: (e.senderEvidence as unknown as Json) ?? null,
    document_type: e.documentType,
    deadline: e.deadline,
    deadline_evidence: (e.deadlineEvidence as unknown as Json) ?? null,
    amount: e.amount,
    amount_currency: e.amountCurrency,
    amount_evidence: (e.amountEvidence as unknown as Json) ?? null,
    summary: e.summary,
    actions: e.actions as unknown as Json,
    requested_documents: e.requestedDocuments as unknown as Json,
    risks: e.risk as unknown as Json,
    uncertainties: e.uncertainties as unknown as Json,
    confidence: e.confidence,
    reply_draft: e.replyDraft,
    reply_language: e.replyLanguage,
    reply_tone: e.replyTone,
  };
}

function rowToDomain(row: AnalysisRow): DocumentAnalysis {
  const days = daysUntil(row.deadline);
  const docType = row.document_type ?? 'informativa';
  const actions = (Array.isArray(row.actions) ? row.actions : []) as unknown as ChecklistAction[];
  const requested = (Array.isArray(row.requested_documents) ? row.requested_documents : []) as unknown as RequestedDocument[];
  const uncertainties = (Array.isArray(row.uncertainties) ? row.uncertainties : []) as unknown as string[];
  const risk = (row.risks as unknown as Risk) ?? { text: 'Non determinabile dal documento.', level: 'unknown', evidence: null };
  const confidence = (row.confidence as Confidence) ?? 'bassa';
  const urgency: Urgency = urgencyFromType(docType, days);

  return {
    id: row.id,
    documentId: row.document_id,
    companyId: row.company_id,
    analysisVersion: row.analysis_version,
    engine: row.engine,
    language: row.language,
    languageLabel: row.language ? (LANG_LABEL[row.language] ?? row.language) : '—',
    sender: row.sender,
    senderUncertain: !row.sender,
    senderEvidence: (row.sender_evidence as unknown as Evidence) ?? null,
    documentType: row.document_type,
    documentTypeLabel: DOC_TYPE_LABEL[docType] ?? docType,
    urgency,
    deadline: row.deadline,
    deadlineLevel: deadlineLevel(days),
    daysToDeadline: days,
    deadlineEvidence: (row.deadline_evidence as unknown as Evidence) ?? null,
    amount: row.amount,
    amountCurrency: row.amount_currency,
    amountDisplay: formatCurrency(row.amount, row.amount_currency),
    amountEvidence: (row.amount_evidence as unknown as Evidence) ?? null,
    summary: row.summary,
    actions,
    primaryAction: actions[0]?.text ?? null,
    primaryActionSource: actions[0]?.sourceType ?? 'suggested',
    requestedDocuments: requested,
    risk,
    uncertainties,
    confidence,
    replyDraft: row.reply_draft ?? '',
    replyLanguage: row.reply_language ?? (row.language ?? 'it'),
    replyTone: row.reply_tone ?? 'formale',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AnalyzeInput {
  document: DocumentRecord;
  text: string;
  companyName: string | null;
}

export interface AnalyzeOutcome {
  analysis: DocumentAnalysis;
  /** true se era richiesta l'AI ma si è dovuto ricadere sul motore locale. */
  usedFallback: boolean;
}

export const analysisService = {
  /**
   * Esegue l'analisi con il provider configurato (AI o motore locale) e la PERSISTE.
   * La UI non sa quale dei due ha prodotto il risultato: la forma è identica.
   */
  async analyzeAndPersist({ document, text, companyName }: AnalyzeInput): Promise<AnalyzeOutcome> {
    const sb = requireSupabase();
    const { engine, analysis: engineResult, usedFallback } = await runAnalysisProvider({
      documentId: document.id,
      text,
      companyName,
    });

    // Rimpiazza eventuale analisi precedente per lo stesso documento.
    await sb.from('document_analyses').delete().eq('document_id', document.id);

    const { data, error } = await sb
      .from('document_analyses')
      .insert(engineToInsert(engineResult, document.id, document.companyId, engine))
      .select('*')
      .single();
    if (error || !data) throw new AppError(toUserMessage(error), error);

    await sb.from('documents').update({ status: 'analyzed' }).eq('id', document.id);

    const domain = rowToDomain(data);
    domain.originalText = text; // disponibile in sessione per il viewer + highlight
    return { analysis: domain, usedFallback };
  },

  /** Tutte le analisi dell'azienda (per Dashboard/Panoramica). */
  async listForCompany(companyId: string): Promise<DocumentAnalysis[]> {
    const { data, error } = await requireSupabase()
      .from('document_analyses')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw new AppError(toUserMessage(error), error);
    return (data ?? []).map(rowToDomain);
  },

  async getForDocument(documentId: string): Promise<DocumentAnalysis | null> {
    const { data, error } = await requireSupabase()
      .from('document_analyses')
      .select('*')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    return data ? rowToDomain(data) : null;
  },

  /** Persiste lo stato della checklist (done) modificato dall'utente. */
  async updateActions(analysisId: string, actions: ChecklistAction[]): Promise<void> {
    const { error } = await requireSupabase()
      .from('document_analyses')
      .update({ actions: actions as unknown as Json })
      .eq('id', analysisId);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  async updateReplyDraft(
    analysisId: string,
    patch: { draft: string; language: string; tone: string },
  ): Promise<void> {
    const { error } = await requireSupabase()
      .from('document_analyses')
      .update({ reply_draft: patch.draft, reply_language: patch.language, reply_tone: patch.tone })
      .eq('id', analysisId);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  /** Rigenera la bozza dal template (per il pulsante "Ripristina bozza"). */
  regenerateReply(analysis: DocumentAnalysis, language: string, tone: string, companyName: string | null): string {
    return buildReply(language, analysis.documentType ?? 'informativa', analysis.amountDisplay, companyName, tone);
  },
};
