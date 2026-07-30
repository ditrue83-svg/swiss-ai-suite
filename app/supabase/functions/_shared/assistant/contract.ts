// ============================================================================
// COMPANY ASSISTANT — il contratto condiviso
//
// Modulo PORTABILE: gira dentro una Edge Function (Deno) e dentro i test
// (Node via tsx). Nessun import, nessuna API di runtime, nessun accesso alla
// rete: qui stanno solo tipi, costanti e le poche funzioni pure che entrambi i
// lati devono vedere allo stesso modo. È la stessa scelta di `finance/contract.ts`
// e `automation/contract.ts`, e la ragione è sempre quella: un limite scritto
// in due posti diventa due limiti diversi il giorno in cui uno dei due cambia.
// ============================================================================

// ---------------------------------------------------------------------------
// Versioni (§135)
//
// Quattro numeri e non uno. Cambiano in momenti diversi e per ragioni diverse,
// e quando una risposta peggiora si vuole sapere QUALE dei quattro è cambiato.
// Finiscono su `assistant_runs`, una colonna per ciascuno.
// ---------------------------------------------------------------------------
export const ASSISTANT_PROMPT_VERSION = 'assistant-2026-07-30-readonly';
export const ASSISTANT_TOOL_REGISTRY_VERSION = 'tools-2026-07-30-v1';
export const ASSISTANT_RETRIEVAL_VERSION = 'structured+fulltext-2026-07-30';
/**
 * §59/§64 — quale strategia di citazione è attiva.
 *
 * `application-v1` significa: gli identificativi di citazione li genera il
 * SERVER dai risultati degli strumenti, e il modello non ne scrive mai uno.
 *
 * Le citazioni NATIVE di Anthropic sono state valutate e SCARTATE per questa
 * versione, con due ragioni verificabili contro l'API corrente:
 *   1. funzionano su blocchi `document` / `search_result` passati nel prompt,
 *      mentre qui le fonti sono righe strutturate lette da RPC — trasformarle
 *      in documenti significherebbe mandare al modello l'intero contenuto per
 *      poi farselo ricitare, cioè il contrario di §53 e §74;
 *   2. sono incompatibili con `output_config.format`: attivarle insieme a un
 *      output strutturato fa fallire la richiesta con 400. E l'output
 *      strutturato serve a §65 (nessun `JSON.parse` di testo libero).
 * La scelta è documentata in docs/company-assistant.md e va rivista se l'API
 * cambia. Fino ad allora, dichiarare «citazioni native» sarebbe falso (§59).
 */
export const ASSISTANT_CITATION_STRATEGY = 'application-v1';

/** Il modello. Uno solo (§134): la baseline si misura prima di ottimizzarla. */
export const ASSISTANT_MODEL = 'claude-opus-5';
/**
 * §133 — il resto del prodotto gira su `claude-opus-4-8`. Qui si sale a Opus 5
 * per una ragione precisa e non per novità: questa è l'unica funzione del
 * prodotto costruita su un CICLO DI STRUMENTI, dove il modello sceglie che cosa
 * chiamare, quando fermarsi e che cosa non affermare — e su quel comportamento
 * Opus 5 è misurabilmente più affidabile, a parità di prezzo per token.
 * Il CLIENT, la quota, il log e la gestione errori restano quelli di sempre:
 * non nasce un secondo provider, cambia una stringa.
 *
 * ⚠️ Su Opus 5 il ragionamento è ATTIVO per impostazione predefinita e
 * `max_tokens` è il tetto di ragionamento PIÙ risposta: un tetto stretto non
 * accorcia la risposta, la tronca a metà.
 */
export const ASSISTANT_EFFORT = 'high' as const;
export const ASSISTANT_PROVIDER = 'anthropic';
/** `kind` per `ai_request_log`: serve a sapere quanto costa questa funzione. */
export const ASSISTANT_AI_KIND = 'assistant_answer';

// ---------------------------------------------------------------------------
// Limiti (§15, §16, §140)
//
// Sono qui, non nel prompt. Un limite affidato al prompt è un limite che il
// modello può disattendere senza che nessuno se ne accorga; qui è il codice a
// fermarsi, e la risposta che ne esce dichiara di essere parziale.
// ---------------------------------------------------------------------------
export const ASSISTANT_LIMITS = {
  /** Chiamate agli strumenti per singola domanda. Superato: si risponde con ciò che si ha. */
  maxToolCalls: 8,
  /** Giri di conversazione con il modello (una richiesta + i suoi risultati). */
  maxTurns: 10,
  /** Righe restituite da un singolo strumento, prima di troncare. */
  maxRowsPerTool: 25,
  /** Righe totali su tutta la domanda: evita che otto strumenti da 25 diventino 200. */
  maxRowsPerRun: 80,
  /** Caratteri di una citazione testuale ripresa dall'evidenza. */
  maxCitedTextChars: 600,
  /** Citazioni per risposta. Oltre, l'elenco smette di essere leggibile (§57). */
  maxCitations: 12,
  /** Follow-up suggeriti (§127). */
  maxFollowUps: 3,
  /** Caratteri della domanda. */
  maxQuestionChars: 1000,
  minQuestionChars: 3,
  /** Tetto complessivo di token per risposta: ragionamento + testo. */
  maxTokens: 8000,
  /** Millisecondi per l'intera domanda, ciclo di strumenti compreso (§145). */
  totalTimeoutMs: 90_000,
  /** Millisecondi per una singola chiamata a uno strumento (§9). */
  toolTimeoutMs: 8_000,
  /** Quota per minuto: complessiva d'azienda e per persona (§141). */
  companyRateLimitPerMinute: 30,
  userRateLimitPerMinute: 10,
  /** Messaggi precedenti riportati nel contesto: una conversazione, non un archivio. */
  maxHistoryMessages: 10,
} as const;

// ---------------------------------------------------------------------------
// Codici d'errore
//
// Stessa forma del resto del prodotto (`FINANCE_ERROR_CODES`, `CONTRACT_ERROR_CODES`):
// una chiave stabile che il client traduce, mai un messaggio inglese a schermo.
// ---------------------------------------------------------------------------
export const ASSISTANT_ERROR_CODES = {
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  RATE_LIMITED: 'RATE_LIMITED',
  /** §142 — il credito del servizio è finito. Aspettare NON serve, e va detto. */
  CREDIT_EXHAUSTED: 'CREDIT_EXHAUSTED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  /** Il modello ha rifiutato di rispondere (stop_reason: refusal). */
  PROVIDER_REFUSAL: 'PROVIDER_REFUSAL',
  TIME_BUDGET: 'TIME_BUDGET',
  /** L'utente ha interrotto (§114). Non è un guasto. */
  CANCELLED: 'CANCELLED',
  FORBIDDEN: 'FORBIDDEN',
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',
  INVALID_REQUEST: 'INVALID_REQUEST',
  /** Il modello ha prodotto un output che non rispetta il contratto (§137). */
  INVALID_ANSWER: 'INVALID_ANSWER',
  /** La verifica deterministica ha bocciato la risposta (§138). */
  GROUNDING_FAILED: 'GROUNDING_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;
export type AssistantErrorCode = keyof typeof ASSISTANT_ERROR_CODES;

// ---------------------------------------------------------------------------
// Lingue
// ---------------------------------------------------------------------------
export const ASSISTANT_LOCALES = ['it', 'de', 'fr'] as const;
export type AssistantLocale = (typeof ASSISTANT_LOCALES)[number];
export const isAssistantLocale = (v: unknown): v is AssistantLocale =>
  typeof v === 'string' && (ASSISTANT_LOCALES as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// Esiti dichiarati (§27–§29)
// ---------------------------------------------------------------------------
export const ANSWER_STATUSES = [
  'answered',
  'partial',
  'insufficient_evidence',
  'needs_disambiguation',
  'out_of_scope',
] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

// ---------------------------------------------------------------------------
// Tipi di fonte — l'elenco è CHIUSO e coincide con l'enum SQL
// `public.assistant_source_type` della 0027. Se i due divergono, la scrittura
// della citazione fallisce: è voluto, ed è meglio di un collegamento che non
// porta da nessuna parte.
// ---------------------------------------------------------------------------
export const SOURCE_TYPES = [
  'document',
  'document_evidence',
  'email_message',
  'task',
  'finance_item',
  'contract',
  'contract_milestone',
  'contract_term',
  'crm_organization',
  'crm_opportunity',
  'workflow_run',
  'workflow_definition',
  'company_overview',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * §54 — il modello comune delle fonti.
 *
 * Lo costruisce il SERVER a partire dai risultati degli strumenti. Il modello
 * non ne vede la forma completa: riceve solo `ref`, una stringa opaca che può
 * citare. Tutto il resto — rotta, titolo, versione, istantanea — lo aggiunge il
 * mappatore, e per questo una citazione non può essere inventata.
 */
export interface AssistantSourceReference {
  /** Riferimento opaco esposto al modello: `f1`, `f2`, … Solo questo può citare. */
  ref: string;
  sourceType: SourceType;
  /** Fonte singola. Nullo per un gruppo. */
  sourceId: string | null;
  /** Fonte aggregata (§57): gli identificativi contati. */
  sourceIds?: string[];
  groupSize?: number;
  /** Rotta INTERNA dell'applicazione. Mai un URL firmato, mai un indirizzo esterno (§106). */
  route: string;
  title: string;
  subtitle?: string | null;
  evidenceId?: string | null;
  pageNumber?: number | null;
  fieldName?: string | null;
  /** Testo preso DALLA FONTE (§62). Il modello non lo riscrive: non è lui a metterlo qui. */
  citedText?: string | null;
  /** §92 — il minimo per sapere su quale stato della fonte la risposta si basava. */
  valueSnapshot?: Record<string, unknown> | null;
  sourceVersion?: string | null;
  /** §24 — quanto è affidabile questa fonte. Entra nella risposta, non resta un dettaglio interno. */
  verification: SourceVerification;
}

/**
 * §24 — la precedenza delle fonti, dichiarata come dato e non lasciata alla
 * prosa. L'ordine è quello del requisito: più basso = più affidabile.
 */
export const SOURCE_VERIFICATIONS = [
  'human_verified',   // 1. verificato da una persona
  'deterministic',    // 2. calcolato o strutturato, validato dal prodotto
  'ai_with_evidence', // 3. estratto dall'AI con una citazione verificata
  'ai_unverified',    // 4. proposto e non confermato
] as const;
export type SourceVerification = (typeof SOURCE_VERIFICATIONS)[number];

export const VERIFICATION_RANK: Record<SourceVerification, number> = {
  human_verified: 1,
  deterministic: 2,
  ai_with_evidence: 3,
  ai_unverified: 4,
};

/** Una fonte è «non verificata» se va dichiarata come tale nella risposta (§25). */
export const isUnverified = (v: SourceVerification): boolean => v === 'ai_unverified';

// ---------------------------------------------------------------------------
// Il risultato di uno strumento
//
// ⚠️ `rows` è ciò che il modello vede; `sources` è ciò che il server tiene per
// sé. I due sono allineati dal campo `ref`: ogni riga porta il proprio `ref`, e
// citare significa nominare un `ref`. Il modello non vede mai un uuid.
// ---------------------------------------------------------------------------
export interface ToolExecutionResult {
  status: 'ok' | 'empty' | 'denied' | 'error' | 'timeout';
  /** Righe già ridotte ai campi necessari (§53). Ognuna contiene `ref`. */
  rows: Record<string, unknown>[];
  /** Fonti corrispondenti, indicizzate per `ref`. Non escono mai dal server. */
  sources: AssistantSourceReference[];
  /** Quante righe esistevano prima del troncamento, se noto. */
  totalCount?: number | null;
  truncated?: boolean;
  /** Nota tecnica per il modello: «ho troncato», «il modulo non ha dati». */
  note?: string;
  errorCode?: string;
}

export const emptyResult = (note?: string): ToolExecutionResult => ({
  status: 'empty', rows: [], sources: [], note,
});

// ---------------------------------------------------------------------------
// La risposta (§63)
// ---------------------------------------------------------------------------
export interface AssistantAnswer {
  status: AnswerStatus;
  /** Testo per la persona. Risposta prima, dettaglio dopo (§66). */
  text: string;
  /** I `ref` citati, nell'ordine in cui compaiono. Il server li risolve in fonti. */
  citedRefs: string[];
  /** §25 — dichiarazione di incertezza, quando un dato non è verificato. */
  uncertainty?: string | null;
  /** §127 — al massimo tre, e pertinenti. */
  followUps?: string[];
  /** §29/§30 — le entità fra cui l'utente deve scegliere. */
  disambiguation?: { ref: string; label: string; hint?: string | null }[];
}

// ---------------------------------------------------------------------------
// Il contesto di una domanda
//
// ⚠️ `userId` e `companyId` NON arrivano mai dal modello (§110, §111) e non
// vengono accettati dal client senza verifica (§32): il primo si legge dalla
// sessione, il secondo si verifica contro la membership prima di comporre
// questo oggetto.
// ---------------------------------------------------------------------------
export interface AssistantContext {
  userId: string;
  companyId: string;
  locale: AssistantLocale;
  /** §21 — fuso dell'utente, per trasformare «questa settimana» in un intervallo. */
  timeZone: string;
  /** Istante di riferimento della domanda. Iniettato: i test non dipendono dall'orologio. */
  now: Date;
  /** §120 — entità di contesto, già verificata dal server (§122). */
  entityContext?: AssistantEntityContext | null;
}

export interface AssistantEntityContext {
  type: 'contract' | 'crm_organization' | 'finance_item' | 'document' | 'task';
  id: string;
  /** Etichetta letta dal database, non inviata dal client. */
  label: string;
}

// ---------------------------------------------------------------------------
// Eventi dello stato progressivo (§112, §113)
//
// Sono ciò che il flusso SSE trasporta. ⚠️ Nessuno di questi eventi contiene il
// ragionamento del modello: dicono che cosa il SISTEMA sta facendo — «cerco
// nelle attività», «verifico le fonti» — e mai «sto ragionando passo per passo».
// ---------------------------------------------------------------------------
export type AssistantStreamEvent =
  | { type: 'run_started'; runId: string; threadId: string }
  // ⚠️ L'evento porta il MODULO e non solo la chiave dello strumento: senza,
  // l'interfaccia dovrebbe ridichiarare la mappa chiave → modulo, e le due
  // copie divergerebbero al primo strumento nuovo — con il risultato che lo
  // stato progressivo direbbe la cosa sbagliata proprio mentre la si guarda.
  | { type: 'tool_started'; toolKey: string; module: string; seq: number }
  | { type: 'tool_finished'; toolKey: string; module: string; seq: number; status: ToolExecutionResult['status']; resultCount: number }
  | { type: 'composing' }
  | { type: 'answer'; messageId: string; answer: PublicAnswer }
  | { type: 'error'; code: AssistantErrorCode; message: string }
  | { type: 'done' };

/** La risposta come la vede il client: i `ref` sono già diventati citazioni. */
export interface PublicAnswer {
  status: AnswerStatus;
  text: string;
  uncertainty: string | null;
  followUps: string[];
  citations: PublicCitation[];
  disambiguation: { label: string; hint: string | null; route: string }[];
  /** §144 — quali strumenti hanno fallito, se la risposta è parziale. */
  degraded: string[];
}

export interface PublicCitation {
  index: number;
  sourceType: SourceType;
  sourceId: string | null;
  groupSize: number | null;
  route: string;
  title: string;
  subtitle: string | null;
  pageNumber: number | null;
  fieldName: string | null;
  citedText: string | null;
  verification: SourceVerification;
  valueSnapshot: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Utilità pure
// ---------------------------------------------------------------------------

/** Accorcia senza tagliare a metà una parola, e senza fingere che non sia tagliato. */
export function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/**
 * Il titolo di una conversazione è la prima domanda accorciata. Nessuna
 * chiamata al modello per riassumere una riga: costerebbe quanto la risposta.
 */
export function threadTitleFrom(question: string): string {
  return truncate(question.replace(/\s+/g, ' ').trim(), 80);
}

/** `f1`, `f2`, … — l'unica forma di riferimento che il modello può scrivere. */
export const refFor = (n: number): string => `f${n}`;
export const isRef = (v: unknown): v is string => typeof v === 'string' && /^f[1-9][0-9]{0,2}$/.test(v);
