// ============================================================================
// Persistenza dell'analisi. Modulo portabile: prende un client Supabase (Deno o
// Node — stessa API a runtime) e scrive su document_analyses/extractions/log.
//
// Scrive SIA le nuove colonne ricche (§23/§24) SIA quelle legacy, così la UI
// attuale mostra subito dati AI reali senza modifiche.
// ============================================================================
import type { Evidence, NormalizedAnalysis, ExtractionResult, NormAction } from './validate.ts';
import { SCHEMA_VERSION } from './schema.ts';

// Il client Supabase ha la stessa API a runtime in Deno e Node; tipizzazione minima.
export type SupabaseLike = { from: (table: string) => any };

// Evidence legacy attesa dalla UI attuale: solo citazioni VERIFICATE, con offset.
function legacyEvidence(e: Evidence | null): { quote: string; start: number; end: number } | null {
  if (!e || !e.verified || e.start == null || e.end == null) return null;
  return { quote: e.quote, start: e.start, end: e.end };
}

function confidenceLabel(n: number): 'alta' | 'media' | 'bassa' {
  return n >= 0.75 ? 'alta' : n >= 0.5 ? 'media' : 'bassa';
}

// §12 — l'importo "principale" è quello DOVUTO. Se il documento non ne contiene
// uno, si ripiega sul più rilevante ma se ne conserva il TIPO, perché una multa
// o una tassa non vanno mai presentate come "da versare" (la UI lo etichetta).
function pickDueAmount(a: NormalizedAnalysis) {
  if (!a.amounts.length) return null;
  const due = a.amounts.filter((m) => m.type === 'due').sort((x, y) => y.confidence - x.confidence);
  return (due[0] ?? a.amounts[0]);
}

// §25 — needs_review se poca fiducia o incertezza grave; altrimenti completed.
export function reviewStatus(a: NormalizedAnalysis): 'completed' | 'needs_review' {
  const highUnc = a.uncertainties.some((u) => u.severity === 'high');
  return a.overallConfidence < 0.45 || highUnc ? 'needs_review' : 'completed';
}

// Azioni ordinate con la primaryAction (§14) in testa: così la UI legacy, che
// usa actions[0], mostra l'azione giusta nel callout "Cosa devi fare adesso".
function orderedLegacyActions(a: NormalizedAnalysis) {
  const ordered: NormAction[] = a.primaryAction
    ? [a.primaryAction, ...a.actions.filter((x) => x.id !== a.primaryAction!.id)]
    : a.actions;
  return ordered.map((c, i) => ({
    id: i,
    text: c.title,
    done: false,
    sourceType: c.sourceType,
    evidence: c.sourceType === 'extracted' ? legacyEvidence(c.evidence) : null,
  }));
}

export interface SaveContext {
  documentId: string;
  companyId: string;
  extractionId: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  processingStartedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Costruisce la riga document_analyses (colonne ricche + legacy). */
export function buildAnalysisRow(a: NormalizedAnalysis, ctx: SaveContext) {
  const due = pickDueAmount(a);

  // §16 — TUTTI i rischi vengono salvati, non solo il primo, con gli espliciti
  // (dichiarati dal documento) davanti agli inferiti: la UI legge il primo come
  // principale e non deve mai mostrare una supposizione al posto di un fatto.
  const risksOrdered = [...a.risks].sort((x, y) =>
    (x.sourceType === 'explicit' ? 0 : 1) - (y.sourceType === 'explicit' ? 0 : 1));
  const legacyRisks = risksOrdered.length
    ? risksOrdered.map((r) => ({
        text: r.text,
        level: r.sourceType === 'explicit' ? 'explicit' : 'possible',
        evidence: legacyEvidence(r.evidence),
      }))
    : [{ text: 'Non determinabile dal documento.', level: 'unknown', evidence: null }];

  const legacyActions = orderedLegacyActions(a);

  return {
    document_id: ctx.documentId,
    company_id: ctx.companyId,
    extraction_id: ctx.extractionId,
    analysis_version: 2,
    schema_version: SCHEMA_VERSION,
    engine: ctx.model,
    provider: ctx.provider,
    model: ctx.model,
    prompt_version: ctx.promptVersion,
    analysis_status: reviewStatus(a),
    processing_started_at: ctx.processingStartedAt,
    processing_completed_at: new Date().toISOString(),
    input_tokens: ctx.inputTokens,
    output_tokens: ctx.outputTokens,

    // ---- colonne legacy (consumate dalla UI attuale) ----
    language: a.language,
    sender: a.sender.name,
    sender_evidence: legacyEvidence(a.sender.evidence),
    document_type: a.documentType.value,
    deadline: a.deadline.date,
    deadline_evidence: legacyEvidence(a.deadline.evidence),
    amount: due ? due.amount : null,
    amount_currency: due ? due.currency : null,
    amount_type: due ? due.type : null,   // §12 — due | fine | fee | contribution | other
    amount_evidence: due ? legacyEvidence(due.evidence) : null,
    summary: a.summary,
    actions: legacyActions,
    requested_documents: a.requestedDocuments.map((d) => ({ label: d.name, evidence: legacyEvidence(d.evidence) })),
    risks: legacyRisks,
    // §17 — l'incertezza conserva campo e gravità: una "high" che ha causato
    // needs_review non deve essere indistinguibile da una "low".
    uncertainties: a.uncertainties.map((u) => ({ field: u.field, description: u.description, severity: u.severity })),
    confidence: confidenceLabel(a.overallConfidence),
    // 0010 — reply_draft/reply_language/reply_tone sono deprecate: la bozza sta
    // in document_replies, la scrive `generate-reply` su richiesta (§35).

    // ---- colonne ricche (§23) ----
    overall_confidence: a.overallConfidence,
    document_type_confidence: a.documentType.confidence,
    sender_authority_type: a.sender.authorityType,
    sender_confidence: a.sender.confidence,
    recipient: a.recipient,
    subject: a.subject,
    document_date: a.documentDate,
    reply_needed: a.replyNeeded,
    deadline_type: a.deadline.type,
    deadline_source_text: a.deadline.sourceText,
    deadline_confidence: a.deadline.confidence,
    deadline_requires_verification: a.deadline.requiresVerification,
    amounts: a.amounts,
    reference_numbers: a.referenceNumbers,
    legal_references: a.legalReferences,
    sender_evidence_list: a.sender.evidence ? [a.sender.evidence] : [],
  };
}

/** Salva (rimpiazzando) l'analisi del documento. Ritorna la riga inserita. */
export async function saveAnalysis(sb: SupabaseLike, a: NormalizedAnalysis, ctx: SaveContext) {
  await sb.from('document_analyses').delete().eq('document_id', ctx.documentId);
  const row = buildAnalysisRow(a, ctx);
  const { data, error } = await sb.from('document_analyses').insert(row).select('*').single();
  if (error) throw new Error(`saveAnalysis: ${error.message}`);
  const status = reviewStatus(a);
  await sb.from('documents').update({ status }).eq('id', ctx.documentId);
  return { row: data, status };
}

/** Salva (upsert) l'estrazione testo. Ritorna l'id. */
export async function saveExtraction(
  sb: SupabaseLike,
  input: { documentId: string; companyId: string; extraction: ExtractionResult; durationMs: number | null; truncated?: boolean },
): Promise<string> {
  const { extraction } = input;
  const row = {
    document_id: input.documentId,
    company_id: input.companyId,
    extraction_method: extraction.extractionMethod,
    full_text: extraction.fullText,
    pages: extraction.pages,
    page_count: extraction.pages.length,
    char_count: extraction.fullText.length,
    ocr_confidence: null,
    truncated: !!input.truncated,   // §28 — testo tagliato al limite
    duration_ms: input.durationMs,
  };
  const { data, error } = await sb.from('document_extractions')
    .upsert(row, { onConflict: 'document_id' }).select('id').single();
  if (error) throw new Error(`saveExtraction: ${error.message}`);
  await sb.from('documents').update({ page_count: extraction.pages.length }).eq('id', input.documentId);
  return data.id as string;
}

/** Log tecnico (§45): mai contenuto del documento. */
/**
 * §50 — Prenota uno slot di quota AI in modo ATOMICO (migrazione 0009).
 *
 * Il vecchio schema "conta poi lavora" lasciava passare tutte le richieste
 * concorrenti, perché leggevano lo stesso conteggio prima che qualcuna scrivesse.
 * `try_consume_ai_quota` serializza per azienda e prenota la riga di log.
 *
 * Ritorna:
 *   { allowed: true,  logId }  → procedere (logId da completare a fine lavoro)
 *   { allowed: false }         → rispondere 429
 *
 * Se la funzione SQL non esiste ancora (0009 non applicata) si ricade sul
 * conteggio classico: il limite resta attivo, senza la garanzia di atomicità.
 */
export async function reserveAiSlot(
  sb: SupabaseLike & { rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  entry: { companyId: string; kind: string; limitPerMinute: number; documentId?: string | null; provider?: string | null; model?: string | null },
): Promise<{ allowed: boolean; logId: string | null; atomic: boolean }> {
  if (typeof sb.rpc === 'function') {
    const { data, error } = await sb.rpc('try_consume_ai_quota', {
      p_company_id: entry.companyId,
      p_kind: entry.kind,
      p_limit: entry.limitPerMinute,
      p_document_id: entry.documentId ?? null,
      p_provider: entry.provider ?? null,
      p_model: entry.model ?? null,
    });
    if (!error) {
      return { allowed: data != null, logId: (data as string | null) ?? null, atomic: true };
    }
    // Funzione assente (0009 non ancora applicata) → fallback qui sotto.
  }

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await sb.from('ai_request_log')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', entry.companyId).gte('created_at', since);
  return { allowed: (count ?? 0) < entry.limitPerMinute, logId: null, atomic: false };
}

/** Completa la riga prenotata da reserveAiSlot con l'esito reale. */
export async function finalizeAiRequest(
  sb: SupabaseLike & { rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  logId: string | null,
  outcome: { status: 'ok' | 'error'; durationMs?: number | null; inputTokens?: number | null; outputTokens?: number | null; errorCode?: string | null; model?: string | null },
): Promise<boolean> {
  if (!logId || typeof sb.rpc !== 'function') return false;
  const { error } = await sb.rpc('finalize_ai_request', {
    p_id: logId,
    p_status: outcome.status,
    p_duration_ms: outcome.durationMs ?? null,
    p_input_tokens: outcome.inputTokens ?? null,
    p_output_tokens: outcome.outputTokens ?? null,
    p_error_code: outcome.errorCode ?? null,
    p_model: outcome.model ?? null,
  });
  return !error;
}

export async function logAiRequest(
  sb: SupabaseLike,
  entry: {
    companyId: string; userId: string | null; documentId: string | null; kind: string;
    provider: string | null; model: string | null; status: 'ok' | 'error'; errorCode?: string | null;
    durationMs?: number | null; inputTokens?: number | null; outputTokens?: number | null;
  },
) {
  try {
    await sb.from('ai_request_log').insert({
      company_id: entry.companyId, user_id: entry.userId, document_id: entry.documentId,
      kind: entry.kind, provider: entry.provider, model: entry.model, status: entry.status,
      error_code: entry.errorCode ?? null, duration_ms: entry.durationMs ?? null,
      input_tokens: entry.inputTokens ?? null, output_tokens: entry.outputTokens ?? null,
    });
  } catch { /* il logging non deve mai far fallire la richiesta */ }
}

/** Rate limit (§50): quante richieste AI ok/errore nell'ultima finestra. */
export async function recentRequestCount(sb: SupabaseLike, companyId: string, windowSeconds: number): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await sb.from('ai_request_log')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).gte('created_at', since);
  return typeof count === 'number' ? count : 0;
}
