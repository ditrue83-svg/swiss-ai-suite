// ============================================================================
// Edge Function: company-assistant — «Chiedi ad AI-Swisse»
//
// Una sola azione: rispondere a una domanda. Tutto il resto — creare, elencare,
// rinominare, archiviare o eliminare una conversazione, votare una risposta —
// passa direttamente da PostgREST con i permessi dell'utente, perché la 0027
// concede esattamente quei diritti e non serve un intermediario che li ripeta.
// Qui vive solo ciò che il client NON può fare: chiamare il modello e scrivere
// una risposta con ruolo `assistant`.
//
// ⚠️ RISPONDE IN FLUSSO (text/event-stream), ed è il primo punto del prodotto a
// farlo. La ragione non è la moda: una domanda che attraversa più moduli
// impiega secondi, e §112 chiede che l'utente veda «cerco nelle attività…»,
// «controllo i contratti…» mentre succede — e §114 che possa interrompere.
// Con `functions.invoke`, che aspetta la risposta intera, nessuna delle due
// cose è possibile. Il flusso trasporta STATO, mai ragionamento (§14).
//
// ⚠️ IL RUOLO DI SERVIZIO SI USA PER SCRIVERE, MAI PER LEGGERE I DATI AZIENDALI.
// Le letture passano tutte dal client dell'utente: le RPC del prodotto sono
// SECURITY INVOKER e la loro unica difesa è la RLS di chi chiama. Con il ruolo
// di servizio `list_finance_items` restituirebbe le fatture di chiunque.
//
// Sicurezza: JWT valido; appartenenza all'azienda verificata con il JWT
// dell'utente (§32); quota per azienda E per persona (§141); la domanda è DATO,
// non istruzioni (§98, nel prompt); il contesto entità è verificato contro il
// database prima di entrare nel prompt (§122).
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
// ⚠️ Si riusa il collante delle automazioni invece di scriverne un terzo: CORS,
// costruzione dei client, autenticazione e log sono già risolti là, e una terza
// copia significherebbe tre posti in cui correggere lo stesso errore. È la
// regola di §178 applicata al runtime, non solo al client del modello.
import {
  CORS, adminClient, authenticate, env, failure, json, logEvent, userClient,
  type AuthedRequest,
} from '../_shared/automation/runtime.ts';
import {
  ASSISTANT_AI_KIND, ASSISTANT_ERROR_CODES, ASSISTANT_LIMITS, ASSISTANT_MODEL,
  ASSISTANT_PROVIDER, isAssistantLocale, type AssistantContext, type AssistantEntityContext,
  type AssistantLocale, type AssistantStreamEvent,
} from '../_shared/assistant/contract.ts';
import { DEFAULT_TIME_ZONE } from '../_shared/assistant/dates.ts';
import {
  answerQuestion, type AssistantCreateMessage, type AssistantModelMessage,
} from '../_shared/assistant/runtime.ts';
import {
  createThread, finishRun, loadHistory, startRun, verifyThread, writeAnswer,
  writeQuestion, writeToolCalls, type StoreClient,
} from '../_shared/assistant/store.ts';

type UserClient = ReturnType<typeof userClient>;

interface Body {
  companyId?: unknown;
  threadId?: unknown;
  question?: unknown;
  locale?: unknown;
  entityContext?: { type?: unknown; id?: unknown } | null;
}

/**
 * Appartenenza, non ruolo.
 *
 * `assertAdmin` del modulo automazioni è troppo stretto: le automazioni le
 * governa chi guida l'azienda, ma una domanda sui dati la può fare ogni membro.
 * La lettura è la stessa — `company_members` con il JWT dell'utente — senza il
 * filtro sul ruolo.
 */
async function assertMember(auth: AuthedRequest, companyId: string): Promise<boolean> {
  const { data, error } = await auth.sbUser
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('user_id', auth.userId)
    .maybeSingle();
  return !error && !!data;
}

/**
 * §21 — il fuso orario si legge dal DATABASE, non dal browser.
 *
 * Le preferenze di notifica (0018) ne conservano già uno per persona e azienda,
 * validato IANA da un guardiano, con `Europe/Zurich` come predefinito. Prenderlo
 * dal client significherebbe accettare un valore che l'utente controlla per
 * decidere che cosa conta come «scaduto»: un parametro in meno di cui fidarsi.
 */
async function resolveTimeZone(sbUser: UserClient, companyId: string): Promise<string> {
  const { data, error } = await sbUser
    .from('notification_preferences')
    .select('timezone')
    .eq('company_id', companyId)
    .maybeSingle();
  const tz = !error && data && typeof (data as { timezone?: unknown }).timezone === 'string'
    ? (data as { timezone: string }).timezone
    : null;
  if (!tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * §122 — il contesto entità si verifica, non si crede.
 *
 * Il client dice «l'utente sta guardando il contratto X». L'etichetta che
 * finisce nel prompt viene letta dal database con i permessi dell'utente: se
 * quell'entità non esiste, non è sua o non è di questa azienda, il contesto
 * semplicemente non c'è. Non è un errore da mostrare — è un contesto che non si
 * applica.
 */
async function resolveEntityContext(
  sbUser: UserClient, companyId: string, raw: Body['entityContext'],
): Promise<AssistantEntityContext | null> {
  const type = typeof raw?.type === 'string' ? raw.type : null;
  const id = typeof raw?.id === 'string' ? raw.id : null;
  if (!type || !id) return null;

  const label = async (rpc: string, args: Record<string, unknown>, field: string): Promise<string | null> => {
    const { data, error } = await sbUser.rpc(rpc, args);
    if (error || !Array.isArray(data) || !data.length) return null;
    const v = (data[0] as Record<string, unknown>)[field];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  switch (type) {
    case 'contract': {
      const name = await label('list_contracts',
        { p_company_id: companyId, p_contract_id: id, p_limit: 1 }, 'display_name');
      return name ? { type, id, label: name } : null;
    }
    case 'crm_organization': {
      const name = await label('list_crm_organizations',
        { p_company_id: companyId, p_organization_id: id, p_limit: 1 }, 'display_name');
      return name ? { type, id, label: name } : null;
    }
    case 'finance_item': {
      const name = await label('list_finance_items',
        { p_company_id: companyId, p_item_id: id, p_limit: 1 }, 'supplier_name')
        ?? await label('list_finance_items',
          { p_company_id: companyId, p_item_id: id, p_limit: 1 }, 'document_title');
      return name ? { type, id, label: name } : null;
    }
    case 'document': {
      const name = await label('list_documents',
        { p_company_id: companyId, p_document_id: id, p_limit: 1 }, 'title');
      return name ? { type, id, label: name } : null;
    }
    case 'task': {
      const { data, error } = await sbUser.from('tasks')
        .select('title').eq('id', id).eq('company_id', companyId).maybeSingle();
      const title = !error && data ? (data as { title?: unknown }).title : null;
      return typeof title === 'string' && title.trim() ? { type, id, label: title.trim() } : null;
    }
    default:
      return null;
  }
}

function aiCreateMessage(): AssistantCreateMessage | null {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey });
  return ((request: unknown, options?: { signal?: AbortSignal }) =>
    anthropic.messages.create(request as never, options as never) as Promise<AssistantModelMessage>
  ) as AssistantCreateMessage;
}

const SSE_HEADERS = {
  ...CORS,
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Alcuni intermediari accumulano la risposta: senza questo, lo stato
  // progressivo arriverebbe tutto insieme alla fine, cioè non arriverebbe.
  'X-Accel-Buffering': 'no',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);

  const body = (await req.json().catch(() => ({}))) as Body;
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const locale: AssistantLocale = isAssistantLocale(body.locale) ? body.locale : 'it';

  if (!companyId) return failure(ASSISTANT_ERROR_CODES.INVALID_REQUEST, 400);
  if (question.length < ASSISTANT_LIMITS.minQuestionChars
    || question.length > ASSISTANT_LIMITS.maxQuestionChars) {
    return failure(ASSISTANT_ERROR_CODES.INVALID_REQUEST, 400);
  }

  // §32 — l'azienda arriva dal client ma non viene creduta: si verifica contro
  // la membership, con il JWT dell'utente.
  if (!(await assertMember(auth, companyId))) {
    return failure(ASSISTANT_ERROR_CODES.FORBIDDEN, 403);
  }

  const createMessage = aiCreateMessage();
  if (!createMessage) return failure(ASSISTANT_ERROR_CODES.AI_NOT_CONFIGURED, 503);

  const sbUser = auth.sbUser as unknown as StoreClient;

  // La conversazione: o è già aperta e appartiene a questa persona, o nasce ora.
  let thread = typeof body.threadId === 'string' && body.threadId
    ? await verifyThread(sbUser, body.threadId, companyId)
    : null;
  if (typeof body.threadId === 'string' && body.threadId && !thread) {
    return failure(ASSISTANT_ERROR_CODES.THREAD_NOT_FOUND, 404);
  }
  if (thread?.status === 'archived') return failure(ASSISTANT_ERROR_CODES.THREAD_NOT_FOUND, 409);
  if (!thread) {
    thread = await createThread(sbUser, { companyId, userId: auth.userId, locale, firstQuestion: question });
    if (!thread) return failure(ASSISTANT_ERROR_CODES.FORBIDDEN, 403);
  }

  // §141 — quota per azienda E per persona, prenotata PRIMA della chiamata.
  // ⚠️ Va chiamata con il client dell'utente: la funzione legge `auth.uid()`.
  const slot = await auth.sbUser.rpc('assistant_reserve_slot', {
    p_company_id: companyId,
    p_company_limit: ASSISTANT_LIMITS.companyRateLimitPerMinute,
    p_user_limit: ASSISTANT_LIMITS.userRateLimitPerMinute,
    p_provider: ASSISTANT_PROVIDER,
    p_model: ASSISTANT_MODEL,
  });
  if (slot.error) return failure(ASSISTANT_ERROR_CODES.FORBIDDEN, 403);
  const logId = typeof slot.data === 'string' ? slot.data : null;
  if (!logId) return failure(ASSISTANT_ERROR_CODES.RATE_LIMITED, 429);

  const [timeZone, entityContext, history] = await Promise.all([
    resolveTimeZone(auth.sbUser, companyId),
    resolveEntityContext(auth.sbUser, companyId, body.entityContext ?? null),
    loadHistory(sbUser, thread.id),
  ]);

  await writeQuestion(sbUser, { threadId: thread.id, companyId, userId: auth.userId, question });

  const sbAdmin = adminClient() as unknown as StoreClient;
  const runId = await startRun(sbAdmin, { threadId: thread.id, companyId, userId: auth.userId });

  const ctx: AssistantContext = {
    userId: auth.userId,
    companyId,
    locale: thread.locale ?? locale,
    timeZone,
    now: new Date(),
    entityContext,
  };

  // §114 — l'interruzione. Quando il browser chiude il flusso, `cancel()` fa
  // scattare questo controller: la richiesta al modello viene davvero abortita,
  // non semplicemente ignorata.
  const controller = new AbortController();
  const encoder = new TextEncoder();
  const threadId = thread.id;
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: AssistantStreamEvent) => {
        try { ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { /* già chiuso */ }
      };

      send({ type: 'run_started', runId: runId ?? '', threadId });

      let errorCode: string | null = null;
      let status: 'succeeded' | 'failed' | 'cancelled' = 'failed';
      try {
        const outcome = await answerQuestion(question, history, {
          db: auth.sbUser as never,
          createMessage,
          ctx,
          emit: send,
          signal: controller.signal,
        });

        if (runId) await writeToolCalls(sbAdmin, runId, outcome.toolCalls);

        // §114 — se l'interruzione è arrivata, non si scrive.
        //
        // Il ciclo guarda il segnale prima di ogni giro, e un'interruzione a
        // metà lo ferma davvero: provato il 2026-07-30 interrompendo durante la
        // prima ricerca, dopo trenta secondi non era stato scritto nulla.
        // Questo controllo chiude ciò che resta, cioè il caso in cui la
        // disconnessione arriva mentre la risposta si sta componendo.
        //
        // ⚠️ NON COPRE LA FINESTRA FINALE, e non può. Fra il momento in cui il
        // modello consegna la risposta e questa riga passano poche decine di
        // millisecondi di lavoro locale, mentre la chiusura del browser deve
        // attraversare la rete: provato il 2026-07-30 abortendo esattamente
        // sull'evento `composing`, il segnale qui era ancora falso e la
        // risposta è stata scritta. È una corsa che non si vince spostando
        // questo controllo, e infatti non si prova: a dire il vero è la
        // SCHERMATA, che dopo un'interruzione rilegge la conversazione e mostra
        // ciò che c'è davvero (vedi `LATE_ANSWER_GRACE_MS` in AssistantPage).
        if (controller.signal.aborted) {
          errorCode = ASSISTANT_ERROR_CODES.CANCELLED;
          status = 'cancelled';
          send({ type: 'error', code: 'CANCELLED', message: errorCode });
        } else if (outcome.ok && outcome.answer) {
          const written = await writeAnswer(sbAdmin, {
            threadId, companyId, runId,
            answer: outcome.answer,
            citedSources: outcome.citedSources,
          });
          status = 'succeeded';
          // §138 — la risposta è stata consegnata, ma il controllo di ancoraggio
          // ha segnalato qualcosa: si registra sull'elaborazione perché la
          // metrica esista, senza trasformarlo in un guasto per chi legge.
          const g = outcome.answer.diagnostics.grounding;
          if (g && !g.ok) errorCode = ASSISTANT_ERROR_CODES.GROUNDING_FAILED;
          else if (outcome.answer.diagnostics.invalidRefs.length) errorCode = 'INVALID_CITATION_REF';

          if (written) {
            send({
              type: 'answer',
              messageId: written.messageId,
              answer: {
                status: outcome.answer.status,
                text: outcome.answer.text,
                uncertainty: outcome.answer.uncertainty,
                followUps: outcome.answer.followUps,
                citations: outcome.answer.citations,
                disambiguation: outcome.answer.disambiguation,
                degraded: outcome.answer.degraded,
              },
            });
          } else {
            errorCode = ASSISTANT_ERROR_CODES.UNKNOWN_ERROR;
            send({ type: 'error', code: 'UNKNOWN_ERROR', message: 'UNKNOWN_ERROR' });
          }
        } else {
          errorCode = outcome.errorCode ?? ASSISTANT_ERROR_CODES.UNKNOWN_ERROR;
          status = outcome.errorCode === 'CANCELLED' ? 'cancelled' : 'failed';
          send({ type: 'error', code: (outcome.errorCode ?? 'UNKNOWN_ERROR'), message: errorCode });
        }

        if (runId) {
          await finishRun(sbAdmin, runId, {
            status,
            durationMs: outcome.durationMs,
            toolCallCount: outcome.toolCalls.length,
            usage: outcome.usage,
            errorCode,
          });
        }
        // Il registro delle richieste AI si chiude con il client dell'UTENTE:
        // `finalize_ai_request` aggiorna solo la propria riga (`user_id = auth.uid()`).
        await auth.sbUser.rpc('finalize_ai_request', {
          p_id: logId,
          p_status: status === 'succeeded' ? 'ok' : 'error',
          p_duration_ms: outcome.durationMs,
          p_input_tokens: outcome.usage.inputTokens,
          p_output_tokens: outcome.usage.outputTokens,
          p_error_code: errorCode,
          p_model: ASSISTANT_MODEL,
        });

        // ⚠️ Solo numeri e codici (§146). Mai la domanda, mai la risposta, mai
        // il contenuto di una fonte.
        logEvent('company-assistant', {
          companyId, runId: runId ?? '', status,
          tools: outcome.toolCalls.length,
          inputTokens: outcome.usage.inputTokens,
          outputTokens: outcome.usage.outputTokens,
          cacheReadTokens: outcome.usage.cacheReadTokens,
          durationMs: outcome.durationMs,
          answerStatus: outcome.answer?.status ?? '',
          citations: outcome.answer?.citations.length ?? 0,
          code: errorCode ?? '',
        });
      } catch (error) {
        errorCode = ASSISTANT_ERROR_CODES.UNKNOWN_ERROR;
        logEvent('company-assistant', {
          companyId, runId: runId ?? '', status: 'failed',
          code: (error as Error)?.name ?? 'unknown',
        });
        if (runId) {
          await finishRun(sbAdmin, runId, {
            status: 'failed', durationMs: Date.now() - startedAt, toolCallCount: 0,
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            errorCode,
          }).catch(() => undefined);
        }
        await auth.sbUser.rpc('finalize_ai_request', {
          p_id: logId, p_status: 'error', p_error_code: errorCode, p_model: ASSISTANT_MODEL,
        }).catch(() => undefined);
        send({ type: 'error', code: 'UNKNOWN_ERROR', message: 'UNKNOWN_ERROR' });
      } finally {
        send({ type: 'done' });
        try { ctrl.close(); } catch { /* già chiuso */ }
      }
    },
    cancel() {
      // Il browser ha chiuso: si abortisce davvero la richiesta al modello.
      controller.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
});

// `json` resta importato per gli errori non-flusso: è la stessa forma del resto
// del prodotto — solo il codice, mai un messaggio del provider (§146).
export { json };
