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
import { translate as tr, type TKey } from '@/i18n';
import {
  analyzeText, buildReply, deadlineLevel, daysUntil, urgencyFromType,
  LANG_LABEL, DOC_TYPE_LABEL, type EngineAnalysis,
} from '@/features/admin-ai/engine';
import { invokeAnalyze, DETERMINISTIC_ENGINE } from './analysisProviders';
import { documentService } from './documentService';
import type { ClientExtraction } from '@/features/admin-ai/pdf';
import type {
  AnalysisAmount, AnalysisStatus, AnalysisUncertainty, ChecklistAction, Confidence, DocumentAnalysis,
  DocumentRecord, Evidence, LegalReference, ReferenceNumber, RequestedDocument, Risk, Urgency,
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
    // 0010 — reply_draft/reply_language/reply_tone sono deprecate e non si
    // scrivono più: la bozza vive in document_replies (vedi replyService).
  };
}

function rowToDomain(row: AnalysisRow): DocumentAnalysis {
  const days = daysUntil(row.deadline);
  const docType = row.document_type ?? 'informativa';
  const actions = (Array.isArray(row.actions) ? row.actions : []) as unknown as ChecklistAction[];
  const requested = (Array.isArray(row.requested_documents) ? row.requested_documents : []) as unknown as RequestedDocument[];
  // §17 — le incertezze possono essere righe testuali (dati storici) oppure
  // oggetti con gravità (formato attuale): si accettano entrambi.
  const rawUnc = (Array.isArray(row.uncertainties) ? row.uncertainties : []) as unknown[];
  const uncertaintyItems: AnalysisUncertainty[] = rawUnc.map((u) => {
    if (typeof u === 'string') return { field: 'generale', description: u, severity: 'medium' as const };
    const o = u as { field?: unknown; description?: unknown; severity?: unknown };
    const sev = o?.severity === 'high' || o?.severity === 'low' ? o.severity : 'medium';
    return {
      field: typeof o?.field === 'string' ? o.field : 'generale',
      description: typeof o?.description === 'string' ? o.description : '',
      severity: sev as AnalysisUncertainty['severity'],
    };
  }).filter((u) => u.description);
  const uncertainties = uncertaintyItems.map((u) => u.description);

  // §16 — `risks` può essere un oggetto singolo (dati storici) o un array (attuale).
  const NO_RISK: Risk = { text: tr('errors.notDeterminable'), level: 'unknown', evidence: null };
  const rawRisks = row.risks as unknown;
  const risks: Risk[] = Array.isArray(rawRisks)
    ? (rawRisks as unknown as Risk[]).filter((r) => r && typeof r.text === 'string' && r.text)
    : (rawRisks ? [rawRisks as unknown as Risk] : []);
  const risk = risks[0] ?? NO_RISK;
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
    // §42 — come per il tipo di documento, l'etichetta della lingua segue la
    // lingua scelta: LANG_LABEL è italiano fisso («Tedesco», «Italiano») e
    // finiva così nell'archivio e nella dashboard anche in de e fr.
    languageLabel: (() => {
      if (!row.language) return '—';
      const k = `labels.languages.${row.language}` as TKey;
      const out = tr(k);
      return out === k ? (LANG_LABEL[row.language] ?? row.language) : out;
    })(),
    sender: row.sender,
    senderUncertain: !row.sender,
    senderEvidence: (row.sender_evidence as unknown as Evidence) ?? null,
    documentType: row.document_type,
    // §42 — l'etichetta segue la lingua scelta; se il tipo non è previsto si
    // mostra il valore grezzo invece di inventarne uno.
    documentTypeLabel: (() => {
      const k = `labels.docTypes.${docType}` as TKey;
      const out = tr(k);
      return out === k ? (DOC_TYPE_LABEL[docType] ?? docType) : out;
    })(),
    urgency,
    deadline: row.deadline,
    deadlineLevel: deadlineLevel(days),
    daysToDeadline: days,
    deadlineEvidence: (row.deadline_evidence as unknown as Evidence) ?? null,
    amount: row.amount,
    amountCurrency: row.amount_currency,
    amountDisplay: formatCurrency(row.amount, row.amount_currency),
    amountType: row.amount_type ?? null,
    amountEvidence: (row.amount_evidence as unknown as Evidence) ?? null,
    summary: row.summary,
    actions,
    primaryAction: actions[0]?.text ?? null,
    primaryActionSource: actions[0]?.sourceType ?? 'suggested',
    requestedDocuments: requested,
    risk,
    risks,
    uncertainties,
    uncertaintyItems,
    confidence,
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
    // §25/§46 — l'esito tecnico arriva fino alla UI: un'analisi fallita non
    // deve mai essere resa come un risultato valido.
    analysisStatus: (row.analysis_status as AnalysisStatus | null) ?? 'completed',
    errorCode: row.error_code ?? null,
    errorMessageSafe: row.error_message_safe ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AnalyzeInput {
  document: DocumentRecord;
  /** §42 — lingua dell'interfaccia: i testi generati dall'AI la seguono. */
  outputLanguage?: string;
  /** testo estratto lato client; null → il server fa l'OCR (solo modalità AI). */
  extraction: ClientExtraction | null;
  companyName: string | null;
  /** §25 — avanzamento leggibile per la UI (stati reali, nessuna percentuale finta). */
  onProgress?: (step: string) => void;
}

/**
 * §25 — etichette degli stati del documento durante l'elaborazione.
 *
 * È una FUNZIONE e non una mappa di costanti: come mappa, `tr()` veniva
 * eseguito all'import del modulo, cioè prima che il provider avesse impostato
 * la lingua, e i passaggi restavano nella lingua iniziale per tutta la sessione
 * anche dopo il cambio. Qui la traduzione avviene quando serve.
 */
const STATUS_KEY: Record<string, TKey> = {
  uploaded: 'adminAi.progressPreparing',
  extracting: 'adminAi.extracting',
  processing: 'adminAi.extracting',
  analyzing: 'adminAi.progressAnalyzing',
};
function stepLabel(status: string | null): string {
  const key = STATUS_KEY[status ?? ''];
  return key ? tr(key) : tr('adminAi.progressGeneric');
}

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
      throw new AppError(an?.error_message_safe ?? tr('errors.analysisFailed'));
    }
    if (status === 'completed' || status === 'needs_review' || status === 'analyzed') {
      return status === 'needs_review' ? 'needs_review' : 'completed';
    }

    const step = stepLabel(status);
    if (step !== lastStep) { lastStep = step; onProgress?.(step); }

    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new AppError(tr('errors.analysisTooLong'));
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
  async analyzeAndPersist({ document, extraction, companyName, onProgress, outputLanguage }: AnalyzeInput): Promise<AnalyzeOutcome> {
    const sb = requireSupabase();

    if (ANALYSIS_PROVIDER === 'deterministic') {
      if (!extraction) {
        throw new AppError(tr('errors.deterministicNoImages'));
      }
      const engineResult = analyzeText(extraction.fullText, { companyName });
      // 0010 — niente delete: il client non può più cancellare un'analisi.
      // Le rianalisi si accumulano e vince la più recente (getForDocument ordina
      // per created_at, listForCompany tiene solo l'ultima per documento).
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
    const invoked = await invokeAnalyze(document.id, extraction, { async: true, outputLanguage });
    const status = invoked.status === 'processing'
      ? await waitForCompletion(document.id, onProgress)
      : invoked.status;

    const analysis = await analysisService.getForDocument(document.id);
    if (!analysis) throw new AppError(tr('errors.analysisUnavailable'));
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

  /**
   * Analisi dell'azienda (per Dashboard/Panoramica): UNA per documento, la più
   * recente. Dalla 0010 il client non può più cancellare le analisi precedenti,
   * quindi un documento rianalizzato ha più righe: senza questo filtro lo stesso
   * documento comparirebbe più volte nella panoramica e nei conteggi.
   */
  async listForCompany(companyId: string): Promise<DocumentAnalysis[]> {
    const { data, error } = await requireSupabase()
      .from('document_analyses')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw new AppError(toUserMessage(error), error);
    const latestPerDocument = new Map<string, AnalysisRow>();
    for (const row of data ?? []) {                       // già ordinate dalla più recente
      if (!latestPerDocument.has(row.document_id)) latestPerDocument.set(row.document_id, row);
    }
    return [...latestPerDocument.values()].map(rowToDomain);
  },

  /**
   * Analisi del documento. Se l'ULTIMO tentativo è fallito ma esiste un'analisi
   * valida precedente, restituisce quella valida marcando `lastAttemptFailed`:
   * un fallimento non deve né essere spacciato per risultato né far sparire
   * un'analisi buona già ottenuta (§27/§53).
   */
  async getForDocument(documentId: string): Promise<DocumentAnalysis | null> {
    const { data, error } = await requireSupabase()
      .from('document_analyses')
      .select('*')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw new AppError(toUserMessage(error), error);
    const rows = data ?? [];
    if (!rows.length) return null;

    const latest = rowToDomain(rows[0]);
    if (latest.analysisStatus !== 'failed') return latest;

    const goodRow = rows.find((r) => r.analysis_status !== 'failed');
    if (!goodRow) return latest;                    // nessun risultato valido: si mostra il fallimento

    const good = rowToDomain(goodRow);
    good.lastAttemptFailed = true;
    good.lastAttemptError = latest.errorMessageSafe;
    return good;
  },

  // 0010 — updateActions() e updateReplyDraft() sono state RIMOSSE, non
  // sostituite altrove con lo stesso effetto: scrivevano su document_analyses e
  // per esistere richiedevano il permesso di update sull'intera riga, cioè anche
  // su scadenza, mittente e importi. Ora:
  //   · spunte della checklist → actionProgressService.setDone()
  //   · bozza di risposta       → replyService.saveLocalDraft() / saveEdit()

  /** Rigenera la bozza dal template (per il pulsante "Ripristina bozza"). */
  regenerateReply(analysis: DocumentAnalysis, language: string, tone: string, companyName: string | null): string {
    return buildReply(language, analysis.documentType ?? 'informativa', analysis.amountDisplay, companyName, tone);
  },
};
