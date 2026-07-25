// ============================================================================
// analysisService — orchestrazione dell'analisi documenti.
// La UI chiama analyzeAndPersist()/getForDocument() SENZA sapere se il
// risultato viene dal motore deterministico o (in futuro) da un LLM: basta
// sostituire `runEngine` con una chiamata a un servizio AI, la forma resta.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { formatCurrency } from '@/lib/format';
import { ANALYSIS_PROVIDER } from '@/lib/env';
import {
  analyzeText, buildReply, deadlineLevel, daysUntil, urgencyFromType,
  LANG_LABEL, DOC_TYPE_LABEL, type EngineAnalysis,
} from '@/features/admin-ai/engine';
import { invokeAnalyze, DETERMINISTIC_ENGINE } from './analysisProviders';
import { documentService } from './documentService';
import type { ClientExtraction } from '@/features/admin-ai/pdf';
import type {
  AnalysisAmount, ChecklistAction, Confidence, DocumentAnalysis, DocumentRecord, Evidence,
  LegalReference, ReferenceNumber, RequestedDocument, Risk, Urgency,
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

  // §20/§31 — usa una citazione ricca solo se VERIFICATA (offset validi); altrimenti niente evidenza.
  const richEvidence = (e: unknown): Evidence | null => {
    const ev = e as { quote?: unknown; verified?: unknown; start?: unknown; end?: unknown; pageNumber?: unknown } | null;
    if (!ev || typeof ev.quote !== 'string' || ev.verified === false) return null;
    if (typeof ev.start !== 'number' || typeof ev.end !== 'number') return null;
    return { quote: ev.quote, start: ev.start, end: ev.end, pageNumber: typeof ev.pageNumber === 'number' ? ev.pageNumber : null };
  };
  const amounts: AnalysisAmount[] = (Array.isArray(row.amounts) ? row.amounts : [])
    .map((a) => a as { amount?: unknown; currency?: unknown; type?: unknown; description?: unknown; evidence?: unknown })
    .filter((a) => typeof a.amount === 'number' && Number.isFinite(a.amount))
    .map((a) => {
      const cur = typeof a.currency === 'string' ? a.currency : 'CHF';
      return {
        amount: a.amount as number, currency: cur,
        type: typeof a.type === 'string' ? a.type : 'other',
        description: typeof a.description === 'string' ? a.description : '',
        display: formatCurrency(a.amount as number, cur) ?? '',
        evidence: richEvidence(a.evidence),
      };
    });
  const referenceNumbers: ReferenceNumber[] = (Array.isArray(row.reference_numbers) ? row.reference_numbers : [])
    .map((r) => r as { label?: unknown; value?: unknown; evidence?: unknown })
    .filter((r) => typeof r.value === 'string' && r.value)
    .map((r) => ({ label: typeof r.label === 'string' ? r.label : '', value: r.value as string, evidence: richEvidence(r.evidence) }));
  const legalReferences: LegalReference[] = (Array.isArray(row.legal_references) ? row.legal_references : [])
    .map((l) => l as { text?: unknown; evidence?: unknown })
    .filter((l) => typeof l.text === 'string' && l.text)
    .map((l) => ({ text: l.text as string, evidence: richEvidence(l.evidence) }));

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
    recipient: row.recipient ?? null,
    subject: row.subject ?? null,
    documentDate: row.document_date ?? null,
    senderAuthorityType: row.sender_authority_type ?? null,
    amounts,
    referenceNumbers,
    legalReferences,
    deadlineType: row.deadline_type ?? null,
    deadlineRequiresVerification: row.deadline_requires_verification ?? false,
    deadlineSourceText: row.deadline_source_text ?? null,
    overallConfidence: row.overall_confidence ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AnalyzeInput {
  document: DocumentRecord;
  /** testo estratto lato client; null → il server fa l'OCR (solo modalità AI). */
  extraction: ClientExtraction | null;
  companyName: string | null;
  /** §25 — avanzamento leggibile per la UI (stati reali, nessuna percentuale finta). */
  onProgress?: (step: string) => void;
}

/** §25 — etichette degli stati del documento durante l'elaborazione. */
const STATUS_STEP: Record<string, string> = {
  uploaded: 'Documento caricato…',
  extracting: 'Estrazione del testo…',
  processing: 'Estrazione del testo…',
  analyzing: 'Analisi amministrativa…',
};

/** §26 — attende il completamento dell'elaborazione server-side osservando il DB. */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

async function waitForCompletion(documentId: string, onProgress?: (s: string) => void): Promise<string> {
  const sb = requireSupabase();
  const started = Date.now();
  let lastStep = '';
  for (;;) {
    const { data } = await sb.from('documents').select('status').eq('id', documentId).maybeSingle();
    const status = data?.status ?? null;

    if (status === 'failed') {
      const { data: an } = await sb.from('document_analyses')
        .select('error_message_safe').eq('document_id', documentId).maybeSingle();
      throw new AppError(an?.error_message_safe ?? 'Analisi non riuscita. Riprova.');
    }
    if (status === 'completed' || status === 'needs_review' || status === 'analyzed') {
      return status === 'needs_review' ? 'needs_review' : 'completed';
    }

    const step = STATUS_STEP[status ?? ''] ?? 'Elaborazione in corso…';
    if (step !== lastStep) { lastStep = step; onProgress?.(step); }

    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new AppError("L'analisi sta impiegando più del previsto. Riapri il documento dall'archivio tra poco.");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export interface AnalyzeOutcome {
  analysis: DocumentAnalysis;
  /** stato risultante dell'analisi: 'completed' | 'needs_review' (§25). */
  status: string;
}

export const analysisService = {
  /**
   * Analizza e PERSISTE. In modalità 'ai' l'estrazione/analisi/persistenza avvengono
   * server-side (Edge Function) e qui si RILEGGE dal DB (fonte di verità). In modalità
   * 'deterministic' (§60, motore locale esplicito) si esegue e persiste qui. La forma
   * del risultato è identica: la UI non deve distinguere i due percorsi.
   */
  async analyzeAndPersist({ document, extraction, companyName, onProgress }: AnalyzeInput): Promise<AnalyzeOutcome> {
    const sb = requireSupabase();

    if (ANALYSIS_PROVIDER === 'deterministic') {
      if (!extraction) {
        throw new AppError('Il motore locale non legge immagini o scansioni: incolla il testo oppure usa la modalità AI.');
      }
      const engineResult = analyzeText(extraction.fullText, { companyName });
      await sb.from('document_analyses').delete().eq('document_id', document.id);
      const { data, error } = await sb
        .from('document_analyses')
        .insert(engineToInsert(engineResult, document.id, document.companyId, DETERMINISTIC_ENGINE))
        .select('*')
        .single();
      if (error || !data) throw new AppError(toUserMessage(error), error);
      await sb.from('documents').update({ status: 'analyzed' }).eq('id', document.id);
      const domain = rowToDomain(data);
      domain.originalText = extraction.fullText;
      return { analysis: domain, status: 'completed' };
    }

    // Percorso AI: la Edge Function estrae (o fa OCR), analizza e persiste.
    // §26 — richiesta asincrona: auth/autorizzazione/validazione restano sincrone
    // (401/403/422/429 arrivano subito), poi si osserva lo stato reale sul DB.
    // Se il runtime non supporta il background, il server risponde già completo.
    const invoked = await invokeAnalyze(document.id, extraction, { async: true });
    const status = invoked.status === 'processing'
      ? await waitForCompletion(document.id, onProgress)
      : invoked.status;

    const analysis = await analysisService.getForDocument(document.id);
    if (!analysis) throw new AppError("Analisi non disponibile dopo l'elaborazione.");
    // Testo + pagine per il viewer (§31): l'estrazione client se presente, altrimenti quella salvata (OCR).
    if (extraction) {
      analysis.originalText = extraction.fullText;
      analysis.pages = extraction.pages;
    } else {
      const ext = await documentService.getExtraction(document.id);
      analysis.originalText = ext?.fullText ?? null;
      analysis.pages = ext?.pages ?? null;
    }
    return { analysis, status };
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
