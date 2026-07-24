// ============================================================================
// Orchestrazione della pipeline di analisi. Modulo portabile con dependency
// injection: il client AI (createMessage) è passato dal runtime, così Edge
// Function e test condividono ESATTAMENTE la stessa logica.
//
//   ESTRAZIONE (già pronta) → salva extraction → chiama modello → parse →
//   validate+evidence → salva analisi (legacy+ricche) → log
// ============================================================================
import { ANALYSIS_MODEL, buildAnalysisRequest, type CompanyContext } from './prompt.ts';
import { PROMPT_VERSION } from './schema.ts';
import { parseModelJson } from './parse.ts';
import { validateAndNormalize, type ExtractionResult, type NormalizedAnalysis } from './validate.ts';
import { logAiRequest, saveAnalysis, saveExtraction, type SupabaseLike } from './persist.ts';

// Forma minima della risposta del modello (comune a SDK Deno e Node).
export interface ModelMessage {
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}
export type CreateMessage = (req: ReturnType<typeof buildAnalysisRequest>) => Promise<ModelMessage>;

export interface PipelineInput {
  documentId: string;
  companyId: string;
  userId: string | null;
  extraction: ExtractionResult;
  extractionDurationMs: number | null;
  companyContext: CompanyContext;
  todayIso: string;
  provider: string;
}

export interface PipelineResult {
  analysis: NormalizedAnalysis;
  status: 'completed' | 'needs_review';
  inputTokens: number | null;
  outputTokens: number | null;
}

export async function runAnalysisPipeline(
  sb: SupabaseLike,
  createMessage: CreateMessage,
  input: PipelineInput,
): Promise<PipelineResult> {
  const startedAt = new Date().toISOString();

  // 1. Salva l'estrazione (separata dall'originale, §5) e passa in "analyzing".
  const extractionId = await saveExtraction(sb, {
    documentId: input.documentId, companyId: input.companyId,
    extraction: input.extraction, durationMs: input.extractionDurationMs,
  });
  await sb.from('documents').update({ status: 'analyzing' }).eq('id', input.documentId);

  // 2. Chiama il modello (thinking + structured-by-prompt).
  const req = buildAnalysisRequest(input.extraction.fullText, input.companyContext, input.todayIso);
  const msg = await createMessage(req);

  if (msg.stop_reason === 'refusal') {
    const err = new Error('refusal') as Error & { code?: string };
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
  const inputTokens = msg.usage?.input_tokens ?? null;
  const outputTokens = msg.usage?.output_tokens ?? null;

  const block = msg.content.find((b) => b.type === 'text' && typeof b.text === 'string');
  if (!block?.text) {
    const err = new Error('nessun blocco testo') as Error & { code?: string };
    err.code = 'AI_INVALID_OUTPUT';
    throw err;
  }

  // 3. Parse + validazione + verifica evidence (§19/§20).
  let normalized: NormalizedAnalysis;
  try {
    const ai = parseModelJson(block.text) as Parameters<typeof validateAndNormalize>[0];
    normalized = validateAndNormalize(ai, input.extraction);
  } catch {
    const err = new Error('output non parsabile') as Error & { code?: string };
    err.code = 'AI_INVALID_OUTPUT';
    throw err;
  }

  // 4. Persistenza (colonne legacy + ricche).
  const { status } = await saveAnalysis(sb, normalized, {
    documentId: input.documentId, companyId: input.companyId, extractionId,
    provider: input.provider, model: ANALYSIS_MODEL, promptVersion: PROMPT_VERSION,
    processingStartedAt: startedAt, inputTokens, outputTokens,
  });

  // 5. Log tecnico (senza contenuto).
  await logAiRequest(sb, {
    companyId: input.companyId, userId: input.userId, documentId: input.documentId,
    kind: 'analysis', provider: input.provider, model: ANALYSIS_MODEL, status: 'ok',
    durationMs: Date.now() - new Date(startedAt).getTime(), inputTokens, outputTokens,
  });

  return { analysis: normalized, status, inputTokens, outputTokens };
}
