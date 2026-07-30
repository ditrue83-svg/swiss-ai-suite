// ============================================================================
// COMPANY ASSISTANT — il ciclo
//
// Qui la domanda diventa risposta. Il modello sceglie quali strumenti chiamare;
// questo file decide QUANDO fermarsi, che cosa eseguire davvero e che cosa
// scartare.
//
// ⚠️ IL MODELLO NON HA IL CONTROLLO DEL CICLO. Ogni giro passa da tre limiti
// che il modello non può alzare: numero di chiamate, righe complessive, tempo.
// Esauriti i giri, non si interrompe con un errore: si toglie ogni strumento
// tranne quello terminale e si chiede una risposta con ciò che c'è. Una
// risposta parziale e dichiarata è migliore di un ciclo che si spegne (§15).
//
// ⚠️ NESSUN AGENTE AUTONOMO (§4). Non ci sono obiettivi, non c'è memoria fra
// una domanda e l'altra oltre ai messaggi già scritti, non c'è alcuna azione.
// Una domanda, un ciclo limitato, una risposta.
//
// Modulo PORTABILE: il client del modello e quello del database arrivano
// iniettati, e i test li sostituiscono entrambi (§179).
// ============================================================================

import {
  type AssistantContext, type AssistantSourceReference, type AssistantStreamEvent,
  type ToolExecutionResult, ASSISTANT_EFFORT, ASSISTANT_LIMITS, ASSISTANT_MODEL,
  ASSISTANT_ERROR_CODES, type AssistantErrorCode, refFor,
} from './contract.ts';
import { type DbLike, type ExecutorDeps, EXECUTORS, sanitizeToolInput } from './executors.ts';
import { ASSISTANT_TOOLS, SUBMIT_ANSWER_TOOL, findTool, toApiTools } from './registry.ts';
import { buildSystemPrompt, buildUserTurn, FINAL_TURN_INSTRUCTION } from './prompt.ts';
import { finalizeAnswer, isHighRisk, validateAnswerShape, type FinalizeOutput } from './answer.ts';
import { todayIn } from './dates.ts';

// ---------------------------------------------------------------------------
// La forma minima della risposta del modello
//
// Dichiarata qui invece di importare i tipi dell'SDK: è la stessa scelta di
// `pipeline.ts`, `finance/process.ts` e `contracts/process.ts`, e serve a far
// girare questo modulo sotto Node senza l'SDK di Deno. Rispetto ai cloni già
// esistenti aggiunge i campi del tool use, che nel prodotto non c'erano.
// ---------------------------------------------------------------------------
export interface AssistantContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AssistantModelMessage {
  content: AssistantContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  stop_reason?: string | null;
}

export type AssistantCreateMessage = (
  request: unknown,
  options?: { signal?: AbortSignal },
) => Promise<AssistantModelMessage>;

// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  seq: number;
  toolKey: string;
  sanitizedInput: Record<string, unknown>;
  resultCount: number | null;
  status: ToolExecutionResult['status'];
  durationMs: number;
  errorCode: string | null;
}

export interface RunOutcome {
  ok: boolean;
  answer: FinalizeOutput | null;
  errorCode: AssistantErrorCode | null;
  toolCalls: ToolCallRecord[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  /** Fonti citate: servono a scrivere `assistant_citations`. */
  citedSources: AssistantSourceReference[];
  durationMs: number;
}

export interface HistoryMessage { role: 'user' | 'assistant'; content: string }

export interface AssistantDeps {
  /** ⚠️ Client dell'UTENTE. Con il ruolo di servizio la RLS sparirebbe. */
  db: DbLike;
  createMessage: AssistantCreateMessage | null;
  ctx: AssistantContext;
  /** Stato progressivo verso il browser (§112). Non riceve mai il ragionamento. */
  emit?: (event: AssistantStreamEvent) => void;
  now?: () => number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------

const err = (code: AssistantErrorCode, calls: ToolCallRecord[], usage: RunOutcome['usage'], ms: number): RunOutcome => ({
  ok: false, answer: null, errorCode: code, toolCalls: calls, usage, citedSources: [], durationMs: ms,
});

/**
 * §142 — il credito esaurito si riconosce dal MESSAGGIO e non dallo stato HTTP.
 * La regola è la stessa di `validate.ts` e di `contracts/process.ts`, ed è
 * riscritta qui perché questo modulo deve restare importabile da Node senza
 * trascinarsi dietro il validatore dell'Admin AI. Il test unitario confronta le
 * due condizioni, come già fatto per i Contratti.
 */
export function classifyProviderFailure(error: unknown): AssistantErrorCode {
  const e = error as { status?: number; name?: string; message?: string } | null;
  const message = (e?.message ?? '').toLowerCase();
  if (/credit balance|insufficient.{0,20}credit|billing|quota exceeded/.test(message)) return 'CREDIT_EXHAUSTED';
  if (e?.status === 429 || /rate.?limit|overloaded/i.test(message)) return 'RATE_LIMITED';
  if (e?.name === 'AbortError') return 'CANCELLED';
  return 'PROVIDER_ERROR';
}

/** Il risultato che il modello legge. Compatto: ogni carattere è contesto pagato. */
function serializeResult(result: ToolExecutionResult): string {
  const payload: Record<string, unknown> = { status: result.status };
  if (result.rows.length) payload.results = result.rows;
  if (typeof result.totalCount === 'number') payload.totalAvailable = result.totalCount;
  if (result.truncated) payload.truncated = true;
  if (result.note) payload.note = result.note;
  if (result.errorCode) payload.error = result.errorCode;
  if (result.status === 'empty' && !result.note) payload.note = 'Nessun risultato.';
  if (result.status === 'denied') {
    payload.note = 'Accesso negato per questa lettura. Non dedurre che il dato non esista.';
  }
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------

export async function answerQuestion(
  question: string,
  history: HistoryMessage[],
  deps: AssistantDeps,
): Promise<RunOutcome> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const toolCalls: ToolCallRecord[] = [];
  const emit = deps.emit ?? (() => undefined);

  if (!deps.createMessage) return err('AI_NOT_CONFIGURED', toolCalls, usage, 0);

  const todayIso = todayIn(deps.ctx.now, deps.ctx.timeZone);

  // Il registro delle fonti di QUESTA domanda. Vive quanto il ciclo: un
  // riferimento non può sopravvivere alla domanda che lo ha prodotto, e quindi
  // non può essere citato da una risposta successiva.
  const registry = new Map<string, AssistantSourceReference>();
  let refCounter = 0;
  const allocRef = () => refFor(++refCounter);

  // La rubrica dei nomi: una lettura sola per tutta la domanda.
  // ⚠️ Senza questa, `assignee_name` sarebbe NULL per chiunque non sia chi
  // chiede — silenziosamente, perché la RLS di `profiles` concede solo la
  // propria riga. Una risposta direbbe «assegnata a —» invece del nome.
  const members = new Map<string, string>();
  try {
    const dir = await deps.db.rpc('company_member_directory', { p_company_id: deps.ctx.companyId });
    if (!dir.error && Array.isArray(dir.data)) {
      for (const m of dir.data as Record<string, unknown>[]) {
        if (typeof m.user_id === 'string' && typeof m.display_name === 'string') {
          members.set(m.user_id, m.display_name);
        }
      }
    }
  } catch { /* la rubrica è un miglioramento, non una condizione */ }

  const execDeps: ExecutorDeps = { db: deps.db, ctx: deps.ctx, allocRef, members };

  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [];
  for (const h of history.slice(-ASSISTANT_LIMITS.maxHistoryMessages)) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: buildUserTurn(question, deps.ctx, todayIso) });

  const system = buildSystemPrompt(deps.ctx.locale);
  const allTools = toApiTools([...ASSISTANT_TOOLS, SUBMIT_ANSWER_TOOL]);
  const onlySubmit = toApiTools([SUBMIT_ANSWER_TOOL]);

  const results: ToolExecutionResult[] = [];
  const degraded: string[] = [];
  const usedToolKeys: string[] = [];
  let rowsUsed = 0;
  let closing = false;

  for (let turn = 0; turn < ASSISTANT_LIMITS.maxTurns; turn++) {
    // ⚠️ IL BUDGET SI CONTROLLA PRIMA di cominciare un giro, mai dopo: Supabase
    // chiude l'isolate a tempo scaduto e il codice dopo la chiamata non gira.
    // È la lezione già scritta in `contracts/process.ts`.
    if (deps.signal?.aborted) return err('CANCELLED', toolCalls, usage, now() - started);
    if (now() - started > ASSISTANT_LIMITS.totalTimeoutMs) {
      if (closing) return err('TIME_BUDGET', toolCalls, usage, now() - started);
      closing = true;
    }

    const request = {
      model: ASSISTANT_MODEL,
      max_tokens: ASSISTANT_LIMITS.maxTokens,
      thinking: { type: 'adaptive' as const },
      output_config: { effort: ASSISTANT_EFFORT },
      // ⚠️ `system` è un ARRAY di blocchi e non una stringa, a differenza degli
      // altri moduli del prodotto. La ragione è il costo: gli strumenti e il
      // prompt di sistema sono identici a ogni domanda e pesano qualche
      // migliaio di token; l'ordine di composizione della richiesta è
      // strumenti → sistema → messaggi, quindi un punto di cache sull'ultimo
      // blocco di sistema tiene in cache anche tutti gli strumenti. È l'unico
      // punto del prodotto in cui la stessa testata si ripete a ogni chiamata.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: closing ? onlySubmit : allTools,
      messages,
    };

    let msg: AssistantModelMessage;
    try {
      msg = await deps.createMessage(request, { signal: deps.signal });
    } catch (error) {
      return err(classifyProviderFailure(error), toolCalls, usage, now() - started);
    }

    usage.inputTokens += msg.usage?.input_tokens ?? 0;
    usage.outputTokens += msg.usage?.output_tokens ?? 0;
    usage.cacheReadTokens += msg.usage?.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += msg.usage?.cache_creation_input_tokens ?? 0;

    // ⚠️⚠️ L'ORDINE DEI CONTROLLI È LA SOSTANZA, ed è quello del resto del
    // prodotto: prima `max_tokens`, poi il rifiuto, poi il contenuto. Se il
    // budget si esaurisce mentre il modello ragiona, non esiste alcun blocco da
    // leggere e un controllo sul contenuto fallirebbe dicendo la cosa sbagliata.
    if (msg.stop_reason === 'max_tokens') {
      if (closing) return err('INVALID_ANSWER', toolCalls, usage, now() - started);
      closing = true;
      // ⚠️ IL TURNO TRONCATO NON SI RIMANDA INDIETRO. Quando il tetto di token
      // scatta mentre il modello sta scrivendo una chiamata a uno strumento, il
      // contenuto contiene un blocco `tool_use` a cui nessun `tool_result`
      // potrà mai corrispondere — e l'API rifiuta la richiesta successiva con
      // «tool_use ids were found without tool_result blocks». Si scarta il
      // frammento e si chiede la risposta con ciò che è già stato raccolto:
      // i risultati degli strumenti sono già nei messaggi precedenti.
      messages.push({ role: 'user', content: FINAL_TURN_INSTRUCTION });
      continue;
    }
    if (msg.stop_reason === 'refusal') return err('PROVIDER_REFUSAL', toolCalls, usage, now() - started);

    const toolUses = msg.content.filter((b) => b.type === 'tool_use' && typeof b.name === 'string');
    const submit = toolUses.find((b) => b.name === SUBMIT_ANSWER_TOOL.key);

    // ---- La risposta ----------------------------------------------------
    if (submit) {
      const shape = validateAnswerShape(submit.input);
      if (!shape.ok || !shape.answer) return err('INVALID_ANSWER', toolCalls, usage, now() - started);
      emit({ type: 'composing' });

      const finalized = finalizeAnswer({
        answer: shape.answer,
        registry,
        results,
        degraded,
        highRisk: isHighRisk(usedToolKeys),
      });
      return {
        ok: true, answer: finalized, errorCode: null, toolCalls, usage,
        citedSources: finalized.citedSources, durationMs: now() - started,
      };
    }

    // ---- Nessuno strumento e nessuna risposta ----------------------------
    if (!toolUses.length) {
      // Il modello ha scritto testo invece di chiamare `submit_answer`. Non si
      // promuove quel testo a risposta: non avrebbe citazioni, e una risposta
      // senza fonti è esattamente ciò che questo modulo esiste per impedire.
      if (closing) return err('INVALID_ANSWER', toolCalls, usage, now() - started);
      closing = true;
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: FINAL_TURN_INSTRUCTION });
      continue;
    }

    // ---- Esecuzione degli strumenti --------------------------------------
    // ⚠️ Si RIMANDA INDIETRO `msg.content` intero e non solo i blocchi di
    // strumento: contiene anche i blocchi di ragionamento, che vanno restituiti
    // invariati perché il turno successivo resti valido.
    messages.push({ role: 'assistant', content: msg.content });

    const toolResults: unknown[] = [];
    for (const use of toolUses) {
      const key = String(use.name);
      const seq = toolCalls.length;

      // Superato il tetto di chiamate o di righe non si esegue più nulla: si
      // risponde allo strumento con un rifiuto esplicito, così il modello sa
      // che deve concludere invece di riprovare.
      const overBudget = toolCalls.length >= ASSISTANT_LIMITS.maxToolCalls
        || rowsUsed >= ASSISTANT_LIMITS.maxRowsPerRun;
      const definition = findTool(key);
      // §109 — il server verifica comunque la chiave: che il modello possa
      // sceglierla non significa che possa inventarne una.
      const unknownTool = !definition || !EXECUTORS[key];

      if (overBudget || unknownTool) {
        toolResults.push({
          type: 'tool_result', tool_use_id: use.id,
          content: JSON.stringify({
            status: 'denied',
            note: unknownTool
              ? 'Strumento non disponibile.'
              : 'Limite di ricerche raggiunto per questa domanda: rispondi ora con ciò che hai.',
          }),
          is_error: true,
        });
        toolCalls.push({
          seq, toolKey: key, sanitizedInput: {}, resultCount: null,
          status: 'denied', durationMs: 0, errorCode: unknownTool ? 'unknown_tool' : 'budget',
        });
        if (overBudget) closing = true;
        continue;
      }

      const input = (use.input && typeof use.input === 'object' ? use.input : {}) as Record<string, unknown>;
      const sanitized = sanitizeToolInput(input);
      emit({ type: 'tool_started', toolKey: key, module: definition.module, seq });

      const t0 = now();
      let result: ToolExecutionResult;
      try {
        result = await withTimeout(
          EXECUTORS[key](input, execDeps),
          definition.timeoutMs,
          () => now(),
        );
      } catch (error) {
        const timedOut = (error as Error)?.message === 'assistant_tool_timeout';
        result = {
          status: timedOut ? 'timeout' : 'error', rows: [], sources: [],
          errorCode: timedOut ? 'timeout' : 'executor_failed',
        };
      }
      const durationMs = now() - t0;

      // Le fonti entrano nel registro SOLO qui: è l'unico punto in cui un
      // riferimento nasce, ed è per questo che non se ne possono inventare.
      for (const s of result.sources) registry.set(s.ref, s);
      rowsUsed += result.rows.length;
      results.push(result);
      usedToolKeys.push(key);
      if (result.status === 'error' || result.status === 'timeout' || result.status === 'denied') {
        degraded.push(key);
      }

      toolCalls.push({
        seq, toolKey: key, sanitizedInput: sanitized,
        resultCount: result.rows.length, status: result.status, durationMs,
        errorCode: result.errorCode ?? null,
      });
      emit({ type: 'tool_finished', toolKey: key, module: definition.module, seq, status: result.status, resultCount: result.rows.length });

      toolResults.push({
        type: 'tool_result', tool_use_id: use.id, content: serializeResult(result),
        ...(result.status === 'error' || result.status === 'timeout' ? { is_error: true } : {}),
      });
    }

    // ⚠️ TUTTI i risultati in UN SOLO messaggio utente. Spezzarli su più
    // messaggi insegna al modello a non chiedere più strumenti in parallelo, e
    // il ciclo diventa più lento a ogni domanda.
    messages.push({ role: 'user', content: toolResults });

    if (closing) {
      messages.push({ role: 'user', content: FINAL_TURN_INSTRUCTION });
    }
  }

  return err('TIME_BUDGET', toolCalls, usage, now() - started);
}

/**
 * Un timeout per singolo strumento (§9).
 *
 * ⚠️ Non annulla la lettura sottostante: PostgREST non offre un modo per
 * ritirarla, e fingerlo sarebbe peggio che dichiararlo. Ciò che garantisce è
 * che il CICLO non resti appeso a una lettura lenta — la risposta arriva
 * comunque, dichiarata parziale.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, _now: () => number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('assistant_tool_timeout'));
    }, ms);
    promise.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } },
    );
  });
}

export { ASSISTANT_ERROR_CODES };
