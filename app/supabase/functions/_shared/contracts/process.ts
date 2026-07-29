// ============================================================================
// LA PIPELINE: da un documento collegato a un verbale contrattuale.
//
// Lo esegue il worker (Deno) e lo eseguono i test (Node): il client arriva per
// parametro e questo file non conosce `Deno.env`, proprio per poter essere
// provato contro il database vero invece che riscritto per l'occasione.
//
// ⚠️ QUESTO MODULO NON PRENDE DECISIONI LEGALI E NON NE FA PRENDERE.
// Legge, valida, scrive un verbale. Non cambia i termini in vigore (lo fa una
// persona con `contract_verify_terms`), non crea attività, non manda niente a
// nessuno, non disdice e non rinnova.
// ============================================================================
import {
  CONTRACT_AI_KIND, CONTRACT_BATCH, CONTRACT_SLOT_MS, isTransient,
  type ContractErrorCode, type ContractQualityFlag,
} from './contract.ts';
import {
  buildContractExtractionRequest, clampDocumentText, CONTRACT_MODEL,
  CONTRACT_PROMPT_VERSION, type ContractOutputLanguage,
} from './prompt.ts';
import { parseModelJson, validateContractReading, type ContractReading } from './validate.ts';
import {
  claimNextDocument, finalizeContractAiSlot, loadCompanyName, loadDocumentText,
  lastSuccessfulHash, nextExtractionVersion, releaseDocument, requeueStale,
  reserveContractAiSlot, saveContractExtraction,
  type ContractDocumentRow, type ServerClient,
} from './store.ts';

/** Forma minima della risposta del modello: comune all'SDK Deno e a quello Node. */
export interface ContractModelMessage {
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}
export type ContractCreateMessage =
  (request: unknown) => Promise<ContractModelMessage>;

export interface ContractDeps {
  sb: ServerClient;
  createMessage: ContractCreateMessage | null;
  outputLanguage?: ContractOutputLanguage;
  /** Istante oltre il quale non si comincia più niente di nuovo. */
  deadlineMs: number;
  /** Iniettabile nei test: rende ripetibile ciò che dipende dall'orologio. */
  now?: () => number;
}

export interface ContractWorkerReport {
  claimed: number;
  completed: number;
  failed: number;
  requeued: number;
  skippedUnchanged: number;
  windowsOpened: number;
  timeBudgetReached: boolean;
  /** Solo CODICI, mai testo del documento (§110). */
  codes: string[];
}

export function emptyContractReport(): ContractWorkerReport {
  return {
    claimed: 0, completed: 0, failed: 0, requeued: 0, skippedUnchanged: 0,
    windowsOpened: 0, timeBudgetReached: false, codes: [],
  };
}

/**
 * L'impronta del testo letto (§112).
 * ⚠️ Non è crittografia: serve solo a non rileggere due volte lo stesso identico
 * documento. Una funzione semplice e deterministica basta, e non introduce una
 * dipendenza per una cosa che non protegge nulla.
 */
export function contentHash(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}:${text.length}`;
}

export type DocumentOutcome =
  | { kind: 'completed'; extractionId: string; flags: ContractQualityFlag[] }
  | { kind: 'failed'; code: ContractErrorCode }
  | { kind: 'released'; code: ContractErrorCode }
  | { kind: 'unchanged' };

/**
 * Legge UN documento e ne scrive il verbale.
 *
 * ⚠️ LA DISTINZIONE FRA `failed` E `released` È IL CUORE DI QUESTA FUNZIONE.
 * `failed` scrive una riga di estrazione fallita e significa una cosa sola: si è
 * provato e quel documento non si riesce a leggere. `released` non scrive nulla
 * e rimette in coda: la quota era finita, la chiave non c'è, il tempo è scaduto.
 * Confonderle renderebbe un guasto dell'ambiente indistinguibile da un guasto
 * del documento — e i due si risolvono in modi opposti.
 */
export async function processContractDocument(
  deps: ContractDeps,
  row: ContractDocumentRow,
): Promise<DocumentOutcome> {
  const now = deps.now ?? (() => Date.now());
  const started = now();

  const text = await loadDocumentText(deps.sb, row.document_id, row.company_id);
  if (!text) {
    // Il testo non c'è ancora: il documento è stato caricato ma la pipeline di
    // estrazione non è arrivata. Non è un fallimento del contratto — si ritenta.
    await releaseDocument(deps.sb, row.id, 'NO_TEXT');
    return { kind: 'released', code: 'NO_TEXT' };
  }

  // §112 — lo stesso identico testo non si rilegge.
  const hash = contentHash(text.fullText);
  const previous = await lastSuccessfulHash(deps.sb, row.contract_id, row.document_id);
  if (previous?.hash && previous.hash === hash) {
    await deps.sb.from('contract_documents')
      .update({ processing_status: 'completed', error_code: null })
      .eq('id', row.id);
    return { kind: 'unchanged' };
  }

  if (!deps.createMessage) {
    // ⚠️ NIENTE LETTURA DETERMINISTICA DI RIPIEGO. In Finance il codice sa leggere
    // un IBAN e un riferimento da solo, e quella lettura è ESATTA. Qui no: le
    // clausole di un contratto non si riconoscono con un'espressione regolare, e
    // un ripiego che riempisse tre campi su venti produrrebbe un contratto
    // «letto» che nessuno ha letto. Senza modello non si scrive alcun verbale.
    await releaseDocument(deps.sb, row.id, 'AI_UNAVAILABLE');
    return { kind: 'released', code: 'AI_UNAVAILABLE' };
  }

  let logId: string | null = null;
  try {
    logId = await reserveContractAiSlot(deps.sb, {
      companyId: row.company_id,
      documentId: row.document_id,
      model: CONTRACT_MODEL,
      kind: CONTRACT_AI_KIND,
    });
  } catch {
    await releaseDocument(deps.sb, row.id, 'QUOTA_EXCEEDED');
    return { kind: 'released', code: 'QUOTA_EXCEEDED' };
  }
  if (!logId) {
    // Quota per azienda esaurita: si smette e si riprende alla prossima
    // esecuzione, come fa l'Inbox. Non è un fallimento del documento.
    await releaseDocument(deps.sb, row.id, 'PROVIDER_RATE_LIMITED');
    return { kind: 'released', code: 'PROVIDER_RATE_LIMITED' };
  }

  const companyName = await loadCompanyName(deps.sb, row.company_id);
  const { truncated } = clampDocumentText(text.fullText);
  const request = buildContractExtractionRequest({
    documentText: text.fullText,
    relation: row.relation,
    todayIso: new Date(now()).toISOString().slice(0, 10),
    outputLanguage: deps.outputLanguage ?? 'it',
    companyName,
  });

  let message: ContractModelMessage;
  try {
    message = await deps.createMessage(request);
  } catch (error) {
    // ⚠️ Il credito esaurito è un guasto dell'AMBIENTE, non del documento:
    // scriverne un verbale `failed` direbbe «questo contratto non si riesce a
    // leggere», che è falso. Torna in coda e si ritenta, come per la quota.
    const code: ContractErrorCode = creditExhausted(error)
      ? 'QUOTA_EXCEEDED'
      : rateLimited(error) ? 'PROVIDER_RATE_LIMITED' : 'AI_REFUSED';
    await finalizeContractAiSlot(deps.sb, logId, {
      status: 'error', errorCode: code, model: CONTRACT_MODEL,
      durationMs: now() - started,
    });
    if (isTransient(code)) {
      await releaseDocument(deps.sb, row.id, code);
      return { kind: 'released', code };
    }
    await writeFailure(deps, row, code, hash);
    return { kind: 'failed', code };
  }

  const durationMs = now() - started;
  const raw = message.content?.find((c) => c.type === 'text')?.text ?? '';
  const payload = parseModelJson(raw);

  await finalizeContractAiSlot(deps.sb, logId, {
    status: payload ? 'ok' : 'error',
    durationMs,
    inputTokens: message.usage?.input_tokens ?? null,
    outputTokens: message.usage?.output_tokens ?? null,
    errorCode: payload ? null : 'AI_REFUSED',
    model: CONTRACT_MODEL,
  });

  if (!payload) {
    await writeFailure(deps, row, 'AI_REFUSED', hash);
    return { kind: 'failed', code: 'AI_REFUSED' };
  }

  const reading = validateContractReading({
    payload,
    source: { fullText: text.fullText, pages: text.pages },
    truncated,
  });

  // ⚠️ Un documento che non è un contratto NON diventa un contratto vuoto: si
  // scrive un verbale `failed` con il codice, e la schermata dice che cosa è
  // successo. Scrivere venti campi nulli e dire «completato» sarebbe dichiarare
  // di aver letto un contratto che non c'era.
  if (!reading.documentIsContract) {
    await writeFailure(deps, row, 'NOT_A_CONTRACT', hash);
    return { kind: 'failed', code: 'NOT_A_CONTRACT' };
  }

  const version = await nextExtractionVersion(deps.sb, row.contract_id, row.document_id);
  const extractionId = await saveContractExtraction(deps.sb, {
    companyId: row.company_id,
    contractId: row.contract_id,
    documentId: row.document_id,
    version,
    status: 'completed',
    method: 'ai',
    provider: 'anthropic',
    model: CONTRACT_MODEL,
    promptVersion: CONTRACT_PROMPT_VERSION,
    qualityFlags: reading.qualityFlags,
    inputTokens: message.usage?.input_tokens ?? null,
    outputTokens: message.usage?.output_tokens ?? null,
    durationMs,
    contentHash: hash,
    fields: fieldsFromReading(reading),
  });

  return { kind: 'completed', extractionId, flags: reading.qualityFlags };
}

/** I campi del verbale, dalla lettura validata. */
export function fieldsFromReading(r: ContractReading): Record<string, unknown> {
  const evidence: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  const confidence: Record<string, number> = {};

  const put = (name: string, field: { evidence: unknown; confidence: number } | null) => {
    if (!field) return;
    if (field.evidence) evidence[name] = field.evidence;
    sources[name] = 'ai';
    confidence[name] = field.confidence;
  };

  put('counterparty', r.counterparty);
  put('company_party', r.companyParty);
  put('start_date', r.startDate);
  put('end_date', r.endDate);
  put('minimum_term', r.minimumTerm);
  put('renewal_period', r.renewalPeriod);
  put('notice_period', r.noticePeriod);
  put('cost_amount', r.costAmount);
  put('termination_method', r.terminationMethod);
  if (r.autoRenewalEvidence) { evidence.auto_renewal = r.autoRenewalEvidence; sources.auto_renewal = 'ai'; }
  if (r.noticeAnchorEvidence) { evidence.notice_anchor = r.noticeAnchorEvidence; sources.notice_anchor = 'ai'; }

  return {
    detected_type: r.detectedType,
    out_of_scope_kind: r.outOfScopeKind,
    company_party: r.companyParty?.value ?? null,
    counterparty: r.counterparty?.value ?? null,
    counterparty_address: r.counterpartyAddress?.value ?? null,
    // ⚠️ LE DATE RESTANO STRINGHE COPIATE DAL DOCUMENTO fino a qui, e diventano
    // date solo attraverso `try_date` del database — la stessa funzione che usa
    // il Document Hub. Convertirle qui con `new Date()` significherebbe che
    // «03.04.2026» diventa il 4 marzo o il 3 aprile a seconda del fuso e della
    // locale del runtime: l'ambiguità giorno/mese non si risolve indovinando.
    document_date: toDateOrNull(r.documentDate?.value),
    signature_date: toDateOrNull(r.signatureDate?.value),
    start_date: toDateOrNull(r.startDate?.value),
    end_date: toDateOrNull(r.endDate?.value),
    end_date_kind: r.endDateKind,
    minimum_term_value: r.minimumTerm?.value.value ?? null,
    minimum_term_unit: r.minimumTerm?.value.unit ?? null,
    auto_renewal: r.autoRenewal,
    renewal_period_value: r.renewalPeriod?.value.value ?? null,
    renewal_period_unit: r.renewalPeriod?.value.unit ?? null,
    notice_period_value: r.noticePeriod?.value.value ?? null,
    notice_period_unit: r.noticePeriod?.value.unit ?? null,
    notice_anchor: r.noticeAnchor,
    notice_anchor_text: r.noticeAnchorText,
    termination_method: r.terminationMethod?.value ?? null,
    termination_address: r.terminationAddress?.value ?? null,
    cost_amount: toNumberOrNull(r.costAmount?.value),
    cost_currency: r.costCurrency,
    cost_frequency: r.costFrequency,
    cost_vat_included: r.costVatIncluded,
    price_adjustment: r.priceAdjustment,
    obligations: r.obligations,
    attention_clauses: r.attentionClauses,
    penalties: r.penalties,
    referenced_annexes: r.referencedAnnexes,
    governing_law: r.governingLaw,
    jurisdiction: r.jurisdiction,
    signed: r.signed,
    field_sources: sources,
    field_confidence: confidence,
    evidence,
    uncertainties: r.uncertainties,
    document_language: r.documentLanguage,
    truncated: r.qualityFlags.includes('partially_analysed'),
  };
}

/**
 * Una data ISO, SOLO se il testo è già in forma ISO o inequivocabile.
 *
 * ⚠️ NON INDOVINA. «03.04.2026» può essere il 3 aprile o il 4 marzo, e sceglierne
 * uno significherebbe scrivere nel database una data che il documento non dice.
 * Le forme ambigue restano `null`: il valore grezzo è comunque salvato
 * nell'evidenza, e una persona lo corregge in un gesto.
 */
export function toDateOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return validCalendarDate(+iso[1], +iso[2], +iso[3]) ? t : null;

  // gg.mm.aaaa e gg/mm/aaaa: in Svizzera il giorno viene prima. Si accetta SOLO
  // quando il primo numero è > 12, cioè quando non può essere un mese: è la
  // stessa cautela di `ambiguous_date` in Finance, portata all'estremo perché
  // qui una data sbagliata non si scopre pagando, si scopre a rinnovo avvenuto.
  const eu = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
  if (eu) {
    const [d, m, y] = [+eu[1], +eu[2], +eu[3]];
    if (d > 12 && validCalendarDate(y, m, d)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }
  return null;
}

function validCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return false;
  const daysInMonth = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= daysInMonth[m - 1];
}

/** Un importo, senza indovinare il separatore. `null` se non è inequivocabile. */
export function toNumberOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // ⚠️ «CHF 250.–» è la forma svizzera per «250 franchi e zero centesimi»: il
  // trattino sta al posto dei decimali. Tolti i caratteri non numerici resta
  // «250.», che non è un numero — e senza questa riga l'importo cadeva.
  const cleaned = raw.replace(/[^\d.,'’\s-]/g, '').trim().replace(/[.,]$/, '');
  if (!cleaned) return null;
  // Separatore svizzero delle migliaia (apostrofo) e decimale col punto.
  const swiss = cleaned.replace(/['’\s]/g, '');
  if (/^-?\d+(\.\d{1,2})?$/.test(swiss)) return swiss;
  // Forma con virgola decimale: 1.250,00 → 1250.00
  if (/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(cleaned)) {
    return cleaned.replace(/\./g, '').replace(',', '.');
  }
  if (/^-?\d+,\d{1,2}$/.test(cleaned)) return cleaned.replace(',', '.');
  return null;
}

async function writeFailure(
  deps: ContractDeps, row: ContractDocumentRow, code: ContractErrorCode, hash: string,
): Promise<void> {
  const version = await nextExtractionVersion(deps.sb, row.contract_id, row.document_id);
  await saveContractExtraction(deps.sb, {
    companyId: row.company_id,
    contractId: row.contract_id,
    documentId: row.document_id,
    version,
    status: 'failed',
    errorCode: code,
    contentHash: hash,
  });
}

/**
 * Il credito del fornitore è esaurito?
 * ⚠️ Doppione DICHIARATO di `classifyProviderError` in `_shared/validate.ts`:
 * quel modulo vive nei tipi dell'analisi amministrativa, e importarlo qui
 * trascinerebbe `schema.ts` dentro un file che deve restare leggibile da solo.
 * La condizione è la stessa e `test:contracts-unit` la confronta.
 */
function creditExhausted(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return /credit balance|insufficient.{0,20}credit|billing|quota exceeded/.test(message);
}

function rateLimited(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return status === 429 || /rate.?limit|429|overloaded/i.test(message);
}

/**
 * Un'esecuzione del worker.
 *
 * ⚠️ IL BUDGET DI TEMPO SI CONTROLLA PRIMA DI COMINCIARE, MAI DOPO. Supabase
 * chiude la richiesta a 150 secondi e uccide l'isolate: il `finally` non gira.
 * Ciò che non si comincia è lavoro della prossima esecuzione, fra pochi minuti;
 * ciò che si comincia senza tempo davanti è un documento lasciato in lavorazione
 * per mezz'ora.
 */
export async function runContractWorker(deps: ContractDeps): Promise<ContractWorkerReport> {
  const now = deps.now ?? (() => Date.now());
  const report = emptyContractReport();

  report.requeued = await requeueStale(deps.sb);

  for (let i = 0; i < CONTRACT_BATCH; i++) {
    if (now() + CONTRACT_SLOT_MS > deps.deadlineMs) {
      report.timeBudgetReached = true;
      break;
    }
    const row = await claimNextDocument(deps.sb);
    if (!row) break;
    report.claimed += 1;

    const outcome = await processContractDocument(deps, row);
    if (outcome.kind === 'completed') report.completed += 1;
    else if (outcome.kind === 'failed') { report.failed += 1; report.codes.push(outcome.code); }
    else if (outcome.kind === 'unchanged') report.skippedUnchanged += 1;
    else {
      report.codes.push(outcome.code);
      // ⚠️ Ci si ferma al primo esaurimento di quota: la quota è per azienda e
      // insistere consumerebbe soltanto tentativi. È la scelta già fatta
      // nell'Inbox dopo il primo import iniziale.
      if (outcome.code === 'PROVIDER_RATE_LIMITED' || outcome.code === 'QUOTA_EXCEEDED') break;
    }
  }

  // §95 — le finestre di attenzione: è un fatto che dipende dal tempo, e nessun
  // trigger può accorgersene. Si riusa lo scheduler, non se ne crea un secondo.
  const { data, error } = await deps.sb.rpc('contract_open_milestone_windows', {
    p_window_days: 60, p_limit: 200,
  });
  if (!error && typeof data === 'number') report.windowsOpened = data;

  return report;
}
