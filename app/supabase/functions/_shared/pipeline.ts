// ============================================================================
// Orchestrazione della pipeline di analisi. Modulo portabile con dependency
// injection: il client AI (createMessage) è passato dal runtime, così Edge
// Function e test condividono ESATTAMENTE la stessa logica.
//
//   ESTRAZIONE (già pronta) → salva extraction → chiama modello → parse →
//   validate+evidence → salva analisi (legacy+ricche) → log
// ============================================================================
import { ANALYSIS_MODEL, buildAnalysisRequest, type CompanyContext, type OutputLanguage } from './prompt.ts';
import { PROMPT_VERSION } from './schema.ts';
import { parseModelJson } from './parse.ts';
import { validateAndNormalize, type ExtractionResult, type NormalizedAnalysis } from './validate.ts';
import {
  logAiRequest, finalizeAiRequest, saveAnalysis, saveExtraction,
  type SupabaseLike, type ChiChiude,
} from './persist.ts';

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
  /** §28 — il testo inviato al modello è stato tagliato al limite. */
  truncated?: boolean;
  /** §50 — riga di log già PRENOTATA dalla quota: si completa invece di inserirne una nuova. */
  logId?: string | null;
  /**
   * CON QUALE CLIENT si chiude quella riga, e con quale autorità.
   *
   * ⚠️⚠️ OBBLIGATORI, e non per pedanteria. Questa pipeline riceve il client
   * AMMINISTRATIVO — le serve per scrivere lo snapshot, che dalla 0010 il client
   * dell'utente non può più scrivere — e fino al 2026-08-22 chiudeva il log con
   * quello. Ma `finalize_ai_request` vuole `user_id = auth.uid()`, e con il
   * service role `auth.uid()` è NULL: zero righe toccate, nessun errore, e la
   * riga restava `pending` per sempre. Chi prenota lo slot sa con quale autorità
   * l'ha prenotato, ed è l'unico che può dirlo: perciò lo passa.
   */
  logSb: SupabaseLike;
  logComeChi: ChiChiude;
  /**
   * §28 — l'estrazione ESISTE GIÀ ed è esattamente questa: non si riscrive.
   *
   * ⚠️ Serve al percorso «rianalizza il testo che hai già». `saveExtraction` fa
   * un upsert che ricalcola `page_count`, `char_count` e soprattutto scrive
   * `ocr_confidence: null`: riscrivere una riga con valori identici
   * cancellerebbe comunque il punteggio di una trascrizione OCR. Quando l'id
   * arriva di qui, la riga si lascia dov'è.
   */
  reuseExtractionId?: string | null;
  /** §42 — lingua in cui l'utente legge l'app: i testi generati la seguono. */
  outputLanguage?: OutputLanguage;
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
  //    ⚠️ A meno che non esista già ed sia esattamente quella: vedi
  //    `reuseExtractionId`. Un upsert «innocuo» con gli stessi valori non è
  //    innocuo — riscrive `ocr_confidence` a `null`.
  const extractionId = input.reuseExtractionId
    ?? await saveExtraction(sb, {
      documentId: input.documentId, companyId: input.companyId,
      extraction: input.extraction, durationMs: input.extractionDurationMs, truncated: input.truncated,
    });
  await sb.from('documents').update({ status: 'analyzing' }).eq('id', input.documentId);

  // 2. Chiama il modello (thinking + structured-by-prompt).
  const req = buildAnalysisRequest(input.extraction.fullText, input.companyContext, input.todayIso, input.outputLanguage ?? 'it');
  const msg = await createMessage(req);

  // ⚠️⚠️ PRIMA DI OGNI ALTRO CONTROLLO, E L'ORDINE È LA SOSTANZA.
  // Quando il budget di token finisce, il modello viene tagliato a metà frase:
  // il JSON che ne esce non si parsa, e senza questo ramo il caso finiva in
  // `AI_INVALID_OUTPUT` — «la risposta del modello non è in un formato valido»,
  // cioè accusare il fornitore di un tetto scelto da noi.
  //
  // ⚠️ Va prima ANCHE del controllo sul blocco di testo: se il budget si esaurisce
  // durante il thinking, `content` non contiene alcun blocco `text` e il caso
  // uscirebbe da lì come «nessun blocco testo», che è vero e non spiega niente.
  if (msg.stop_reason === 'max_tokens') {
    const err = new Error('max_tokens') as Error & { code?: string };
    err.code = 'AI_OUTPUT_TRUNCATED';
    throw err;
  }

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
  } catch (e) {
    // ⚠️ IL `catch` NUDO DISTRUGGEVA LA CAUSA. Qui dentro possono fallire due
    // cose diverse — il JSON non si parsa, oppure la validazione rifiuta un
    // campo — e con `} catch {` il registro non conservava nulla di quale delle
    // due fosse: restava solo «output non parsabile», che per metà dei casi è
    // falso. Diagnosticare senza questa riga significa riprodurre a mano.
    //
    // ⚠️ §45 — SI REGISTRA LA CAUSA, MAI IL DOCUMENTO. Il messaggio di un
    // errore di validazione può citare un valore letto dal testo, e il testo è
    // il documento di un cliente: 120 caratteri bastano a distinguere
    // «Unexpected token » da «campo amounts non valido» e non bastano a
    // ricostruire una scadenza, un importo o un nome.
    const cause = e instanceof Error ? e : new Error(String(e));
    console.error(`[pipeline] output non utilizzabile: ${cause.name} · ${cause.message.slice(0, 120)}`);
    const err = new Error('output non parsabile') as Error & { code?: string };
    err.code = 'AI_INVALID_OUTPUT';
    throw err;
  }

  // §28 — se il testo è stato tagliato, il modello non ha visto la parte finale
  // del documento: va detto all'utente, non nascosto. Severità alta perché una
  // scadenza o un importo nell'ultima pagina sarebbero semplicemente spariti.
  if (input.truncated) {
    normalized.uncertainties.push({
      field: 'documento',
      description: 'Il documento supera la lunghezza massima analizzabile: l’analisi copre solo la prima parte del testo. Verifica manualmente le pagine finali.',
      severity: 'high',
    });
  }

  // 4. Persistenza (colonne legacy + ricche).
  const { status } = await saveAnalysis(sb, normalized, {
    documentId: input.documentId, companyId: input.companyId, extractionId,
    provider: input.provider, model: ANALYSIS_MODEL, promptVersion: PROMPT_VERSION,
    processingStartedAt: startedAt, inputTokens, outputTokens,
  });

  // 5. Log tecnico (senza contenuto). Se la quota aveva già prenotato una riga
  // la si COMPLETA: inserirne un'altra falserebbe il conteggio del rate limit.
  const durationMs = Date.now() - new Date(startedAt).getTime();
  const finalized = await finalizeAiRequest(input.logSb, input.logId ?? null, {
    status: 'ok', durationMs, inputTokens, outputTokens, model: ANALYSIS_MODEL,
  }, input.logComeChi);
  if (!finalized) await logAiRequest(sb, {
    companyId: input.companyId, userId: input.userId, documentId: input.documentId,
    kind: 'analysis', provider: input.provider, model: ANALYSIS_MODEL, status: 'ok',
    durationMs, inputTokens, outputTokens,
  });

  return { analysis: normalized, status, inputTokens, outputTokens };
}
