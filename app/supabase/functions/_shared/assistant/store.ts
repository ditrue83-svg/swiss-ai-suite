// ============================================================================
// COMPANY ASSISTANT — la scrittura
//
// Due client, due ruoli, e la differenza è deliberata.
//
//   sbUser  (chiave anonima + JWT dell'utente) — TUTTE le letture, la creazione
//           della conversazione e la domanda dell'utente. La RLS decide.
//   sbAdmin (ruolo di servizio) — SOLO la risposta dell'assistente, le metriche
//           dell'elaborazione e le citazioni.
//
// ⚠️ PERCHÉ LA RISPOSTA LA SCRIVE IL SERVIZIO. La policy della 0027 consente al
// client di inserire soltanto messaggi con ruolo `user`. Se potesse inserirne
// con ruolo `assistant`, chiunque potrebbe fabbricare una risposta con le sue
// citazioni e farla apparire come prodotta dal sistema: la conversazione
// smetterebbe di essere una prova di che cosa il sistema ha detto.
//
// ⚠️ IL RUOLO DI SERVIZIO SCAVALCA LA RLS, QUINDI NON SI FIDA DEGLI IDENTIFICATIVI
// (§36). Prima di ogni scrittura, la conversazione viene VERIFICATA con il
// client dell'utente: se `verifyThread` non la trova, l'utente non è il suo
// autore o non è membro dell'azienda, e non si scrive nulla. Il `company_id`
// delle righe figlie non viene nemmeno letto dal chiamante: lo impone il
// guardiano `assistant_child_company` a partire dalla conversazione.
// ============================================================================

import {
  type AnswerStatus, type AssistantLocale, type AssistantSourceReference,
  ASSISTANT_CITATION_STRATEGY, ASSISTANT_LIMITS, ASSISTANT_MODEL, ASSISTANT_PROMPT_VERSION,
  ASSISTANT_RETRIEVAL_VERSION, ASSISTANT_TOOL_REGISTRY_VERSION, threadTitleFrom, truncate,
} from './contract.ts';
import type { ToolCallRecord } from './runtime.ts';
import type { FinalizeOutput } from './answer.ts';

// ---------------------------------------------------------------------------
// La forma minima del client. Come in `persist.ts`: si dichiara ciò che serve
// invece di importare i tipi dell'SDK, così il modulo resta provabile.
// ---------------------------------------------------------------------------
export interface StoreResult { data: unknown; error: unknown }

/**
 * ⚠️ Nessun `any` (§175): la catena è tipizzata fino in fondo, e ogni metodo
 * restituisce ancora un costruttore di query che è già una promessa — la stessa
 * forma di PostgREST, dichiarata invece che importata.
 */
export interface StoreQuery extends PromiseLike<StoreResult> {
  select: (columns: string) => StoreQuery;
  eq: (column: string, value: unknown) => StoreQuery;
  order: (column: string, opts?: { ascending?: boolean }) => StoreQuery;
  limit: (n: number) => StoreQuery;
  maybeSingle: () => PromiseLike<StoreResult>;
}

export interface StoreClient {
  from: (table: string) => {
    select: (columns: string) => StoreQuery;
    insert: (values: unknown) => StoreQuery;
    update: (values: unknown) => StoreQuery;
    delete: () => StoreQuery;
  };
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<StoreResult>;
}

export interface ThreadRow {
  id: string;
  companyId: string;
  locale: AssistantLocale;
  title: string;
  status: 'active' | 'archived';
}

const asLocale = (v: unknown): AssistantLocale =>
  v === 'de' || v === 'fr' ? v : 'it';

// ---------------------------------------------------------------------------
// Conversazioni
// ---------------------------------------------------------------------------

/**
 * La conversazione esiste, è di questa persona, in questa azienda ed è aperta?
 *
 * Si legge con il client dell'UTENTE: la risposta «non esiste» copre tre casi
 * diversi — non esiste davvero, è di un altro, è di un'altra azienda — e
 * distinguerli nella risposta direbbe a chi prova che cosa esiste (§35).
 */
export async function verifyThread(
  sbUser: StoreClient, threadId: string, companyId: string,
): Promise<ThreadRow | null> {
  const { data, error } = await sbUser.from('assistant_threads')
    .select('id, company_id, locale, title, status')
    .eq('id', threadId).eq('company_id', companyId).maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    locale: asLocale(r.locale),
    title: typeof r.title === 'string' ? r.title : '',
    status: r.status === 'archived' ? 'archived' : 'active',
  };
}

export async function createThread(
  sbUser: StoreClient,
  input: { companyId: string; userId: string; locale: AssistantLocale; firstQuestion: string },
): Promise<ThreadRow | null> {
  const { data, error } = await sbUser.from('assistant_threads')
    .insert({
      company_id: input.companyId,
      created_by: input.userId,
      // Il titolo è la prima domanda accorciata. Nessuna chiamata al modello:
      // costerebbe quanto la risposta per produrre una riga che la domanda già è.
      title: threadTitleFrom(input.firstQuestion),
      locale: input.locale,
    })
    .select('id, company_id, locale, title, status')
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id), companyId: String(r.company_id), locale: asLocale(r.locale),
    title: typeof r.title === 'string' ? r.title : '', status: 'active',
  };
}

/**
 * I messaggi precedenti che entrano nel contesto.
 *
 * ⚠️ Si prendono gli ULTIMI e poi si rimettono in ordine di lettura. Prendere i
 * primi darebbe al modello l'inizio di una conversazione lunga e non la parte
 * a cui l'utente si sta riferendo adesso.
 */
export async function loadHistory(
  sbUser: StoreClient, threadId: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const { data, error } = await sbUser.from('assistant_messages')
    .select('role, content, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(ASSISTANT_LIMITS.maxHistoryMessages);
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[])
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: typeof m.content === 'string' ? m.content : '',
    }))
    .filter((m) => m.content.length > 0)
    .reverse();
}

/** La domanda la scrive l'utente, con i suoi permessi: è sua. */
export async function writeQuestion(
  sbUser: StoreClient, input: { threadId: string; companyId: string; userId: string; question: string },
): Promise<string | null> {
  const { data, error } = await sbUser.from('assistant_messages')
    .insert({
      thread_id: input.threadId,
      company_id: input.companyId,
      role: 'user',
      content: input.question,
      created_by: input.userId,
    })
    .select('id')
    .maybeSingle();
  if (error || !data) return null;
  return String((data as Record<string, unknown>).id);
}

// ---------------------------------------------------------------------------
// Elaborazioni
// ---------------------------------------------------------------------------

export async function startRun(
  sbAdmin: StoreClient, input: { threadId: string; companyId: string; userId: string },
): Promise<string | null> {
  const { data, error } = await sbAdmin.from('assistant_runs')
    .insert({
      thread_id: input.threadId,
      company_id: input.companyId,
      user_id: input.userId,
      status: 'running',
      model: ASSISTANT_MODEL,
      prompt_version: ASSISTANT_PROMPT_VERSION,
      tool_registry_version: ASSISTANT_TOOL_REGISTRY_VERSION,
      retrieval_version: ASSISTANT_RETRIEVAL_VERSION,
      citation_strategy: ASSISTANT_CITATION_STRATEGY,
    })
    .select('id')
    .maybeSingle();
  if (error || !data) return null;
  return String((data as Record<string, unknown>).id);
}

export async function finishRun(
  sbAdmin: StoreClient,
  runId: string,
  outcome: {
    status: 'succeeded' | 'failed' | 'cancelled';
    durationMs: number;
    toolCallCount: number;
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
    errorCode?: string | null;
  },
): Promise<void> {
  await sbAdmin.from('assistant_runs').update({
    status: outcome.status,
    completed_at: new Date().toISOString(),
    duration_ms: outcome.durationMs,
    tool_call_count: outcome.toolCallCount,
    input_tokens: outcome.usage.inputTokens,
    output_tokens: outcome.usage.outputTokens,
    cache_read_tokens: outcome.usage.cacheReadTokens,
    cache_write_tokens: outcome.usage.cacheWriteTokens,
    error_code: outcome.errorCode ?? null,
  }).eq('id', runId);
}

/**
 * §90 — le chiamate agli strumenti.
 *
 * ⚠️ `sanitizedInput` è già ripulito da `sanitizeToolInput`: restano i filtri,
 * sparisce il testo cercato. Qui non si aggiunge nulla — in particolare non si
 * aggiungono i RISULTATI, che sono dati aziendali e non hanno posto in una
 * tabella di metriche.
 */
export async function writeToolCalls(
  sbAdmin: StoreClient, runId: string, calls: ToolCallRecord[],
): Promise<void> {
  if (!calls.length) return;
  await sbAdmin.from('assistant_tool_calls').insert(calls.map((c) => ({
    run_id: runId,
    seq: c.seq,
    tool_key: c.toolKey,
    sanitized_input: c.sanitizedInput,
    result_count: c.resultCount,
    status: c.status,
    duration_ms: c.durationMs,
    error_code: c.errorCode,
  })));
}

// ---------------------------------------------------------------------------
// La risposta e le sue fonti
// ---------------------------------------------------------------------------

export interface WrittenAnswer { messageId: string }

export async function writeAnswer(
  sbAdmin: StoreClient,
  input: {
    threadId: string;
    companyId: string;
    runId: string | null;
    answer: FinalizeOutput;
    citedSources: AssistantSourceReference[];
  },
): Promise<WrittenAnswer | null> {
  const { answer } = input;
  const { data, error } = await sbAdmin.from('assistant_messages')
    .insert({
      thread_id: input.threadId,
      company_id: input.companyId,
      role: 'assistant',
      content: answer.text,
      answer_status: answer.status satisfies AnswerStatus,
      uncertainty: answer.uncertainty,
      follow_ups: answer.followUps.slice(0, ASSISTANT_LIMITS.maxFollowUps),
      model: ASSISTANT_MODEL,
      prompt_version: ASSISTANT_PROMPT_VERSION,
      run_id: input.runId,
    })
    .select('id')
    .maybeSingle();
  if (error || !data) return null;
  const messageId = String((data as Record<string, unknown>).id);

  if (answer.citations.length) {
    // L'indice, la rotta e il testo citato li scrive il SERVER a partire dalle
    // fonti che gli strumenti hanno prodotto. Il modello non tocca nessuna di
    // queste colonne (§60, §62).
    const rows = answer.citations.map((c, i) => {
      const src = input.citedSources[i];
      return {
        message_id: messageId,
        citation_index: i,
        source_type: c.sourceType,
        source_id: c.groupSize == null ? c.sourceId : null,
        source_ids: c.groupSize == null ? null : (src?.sourceIds ?? []),
        group_size: c.groupSize,
        route: c.route,
        title: truncate(c.title, 160),
        subtitle: c.subtitle,
        evidence_id: src?.evidenceId ?? null,
        page_number: c.pageNumber,
        field_name: c.fieldName,
        cited_text: c.citedText,
        value_snapshot: c.valueSnapshot,
        source_version: src?.sourceVersion ?? null,
      };
    });
    await sbAdmin.from('assistant_citations').insert(rows);
  }

  // La conversazione risale in cima all'elenco: `updated_at` è l'ordinamento
  // della colonna di sinistra, e senza questo tocco resterebbe la data di
  // creazione.
  await sbAdmin.from('assistant_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.threadId);

  return { messageId };
}
