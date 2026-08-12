// ============================================================================
// Validation layer (§19) + evidence verification (§20) + normalizzazione.
// Modulo portabile. NON si salva nel DB nulla che non passi di qui.
//
// Trasforma l'AiAnalysis grezza in una NormalizedAnalysis:
//  - valida date, currency, enum, range di confidence, stringhe/array;
//  - VERIFICA ogni citazione contro il testo estratto: se non c'è, la marca
//    non verificata, ne toglie gli offset e abbassa l'affidabilità (§20);
//  - impone le regole sulla scadenza (§11) e deriva la primaryAction (§14).
// ============================================================================
import type {
  AiAnalysis, AiEvidence, AuthorityType, DeadlineType, DocumentType, Language, Severity,
} from './schema.ts';
import {
  AUTHORITY_TYPES, DEADLINE_TYPES, DOCUMENT_TYPES, LANGUAGES, SEVERITIES,
} from './schema.ts';
// ⚠️ Si IMPORTA la normalizzazione delle valute invece di riscriverla: è la
// stessa domanda che si pone Finanze, e due risposte diverse alla stessa
// domanda divergono. `money.ts` non ha alcun import — né Deno, né npm, né il
// resto del progetto — quindi si può prendere così com'è.
import { normalizeCurrency } from './finance/money.ts';

// ---- Testo estratto (input della verifica) ----------------------------------
export interface ExtractionPage { pageNumber: number; text: string }
export interface ExtractionResult {
  fullText: string;
  pages: ExtractionPage[];
  extractionMethod: 'native_pdf' | 'ocr' | 'text';
}

// ---- Evidence normalizzata (output) -----------------------------------------
export interface Evidence {
  quote: string;
  pageNumber: number | null;
  verified: boolean;        // §20: la citazione esiste davvero nel testo
  start: number | null;     // offset nel fullText (per l'evidenziazione), mai dal modello
  end: number | null;
}

export interface NormAction {
  id: number;
  title: string;
  description: string;
  sourceType: 'extracted' | 'suggested';
  required: boolean | null;
  deadlineReference: string | null;
  confidence: number;
  evidence: Evidence | null;
}

export interface NormalizedAnalysis {
  language: Language;
  documentType: { value: DocumentType; confidence: number; evidence: Evidence | null };
  sender: { name: string | null; authorityType: AuthorityType; confidence: number; evidence: Evidence | null };
  recipient: string | null;
  subject: string | null;
  documentDate: string | null;
  referenceNumbers: { label: string; value: string; evidence: Evidence | null }[];
  summary: string;
  deadline: {
    date: string | null;
    type: DeadlineType;
    sourceText: string | null;
    confidence: number;
    evidence: Evidence | null;
    requiresVerification: boolean;
  };
  amounts: { amount: number; currency: string | null; type: string; description: string; confidence: number; evidence: Evidence | null }[];
  actions: NormAction[];
  primaryAction: NormAction | null;
  requestedDocuments: { name: string; required: boolean | null; confidence: number; evidence: Evidence | null }[];
  risks: { text: string; sourceType: 'explicit' | 'inferred'; confidence: number; evidence: Evidence | null }[];
  legalReferences: { text: string; evidence: Evidence | null }[];
  replyNeeded: boolean;
  uncertainties: { field: string; description: string; severity: Severity }[];
  overallConfidence: number;
  meta: { droppedEvidence: number; warnings: string[] };
}

// ---- Utility ----------------------------------------------------------------
const clamp01 = (n: unknown): number => {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
};
const cleanStr = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length ? t : null;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? (v as T) : fallback;

const isIsoDate = (s: string | null): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10);
};

const normWs = (s: string) => s.replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cerca una citazione nel testo e ne calcola gli offset (mai presi dal modello). */
function locate(text: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim();
  if (q.length < 4) return null;
  let i = text.indexOf(q);
  if (i >= 0) return { start: i, end: i + q.length };
  i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i >= 0) return { start: i, end: i + q.length };
  try {
    const pattern = q.split(/\s+/).filter(Boolean).map(escapeRe).join('\\s+');
    const m = new RegExp(pattern, 'i').exec(text);
    if (m && m.index >= 0) return { start: m.index, end: m.index + m[0].length };
  } catch { /* pattern non valido → non trovata */ }
  return null;
}

/** §20 — verifica una evidence contro il testo estratto. */
function verifyEvidence(ev: AiEvidence | null, extraction: ExtractionResult): { evidence: Evidence | null; dropped: boolean } {
  // Evidence non nullable nello schema: quote "" = "nessuna evidenza" (legittimo, non un errore).
  if (!ev || typeof ev.quote !== 'string') return { evidence: null, dropped: false };
  const quote = ev.quote.trim();
  if (quote.length < 4) return { evidence: null, dropped: false };

  const hit = locate(extraction.fullText, quote);
  if (hit) {
    // pageNumber 0/assente = sconosciuto; accettato solo se coerente con l'estrazione.
    let page = typeof ev.pageNumber === 'number' && ev.pageNumber > 0 ? ev.pageNumber : null;
    if (page != null && !extraction.pages.some((p) => p.pageNumber === page)) page = null;
    if (page == null) {
      const nq = normWs(quote);
      const found = extraction.pages.find((p) => normWs(p.text).includes(nq));
      if (found) page = found.pageNumber;
    }
    return { evidence: { quote, pageNumber: page, verified: true, start: hit.start, end: hit.end }, dropped: false };
  }
  // Non trovata: la teniamo solo come testo NON verificato (niente offset, niente "mostra nel documento").
  return { evidence: { quote, pageNumber: null, verified: false, start: null, end: null }, dropped: true };
}

// ---- Validazione + normalizzazione ------------------------------------------
export function validateAndNormalize(ai: AiAnalysis, extraction: ExtractionResult): NormalizedAnalysis {
  const warnings: string[] = [];
  let dropped = 0;
  const ver = (ev: AiEvidence | null): Evidence | null => {
    const r = verifyEvidence(ev, extraction);
    if (r.dropped) dropped++;
    return r.evidence;
  };

  const uncertainties = (Array.isArray(ai.uncertainties) ? ai.uncertainties : []).map((u) => ({
    field: cleanStr(u?.field) ?? 'generale',
    description: cleanStr(u?.description) ?? '',
    severity: oneOf<Severity>(u?.severity, SEVERITIES, 'medium'),
  })).filter((u) => u.description);

  // §11 — scadenza: la data assoluta è ammessa SOLO per il tipo explicit e se valida.
  let dType = oneOf<DeadlineType>(ai.deadline?.type, DEADLINE_TYPES, 'none');
  let dDate = cleanStr(ai.deadline?.date);

  // ⚠️⚠️ CHI È OBBLIGATO DA QUELLA DATA — la domanda che mancava, aggiunta il
  // 2026-08-11 su un caso reale. Un'email di Stripe sulle nuove tariffe di Radar
  // ha prodotto «Scadenza 22.01.2027»: la data c'era davvero, scritta a chiare
  // lettere, ma era l'entrata in vigore di un LISTINO DI UN FORNITORE. L'azienda
  // non doveva fare niente entro quel giorno, e si è ritrovata una scadenza nel
  // cruscotto operativo.
  //
  // Il tipo di scadenza non può dipendere dalla FORMA della data — quella dice
  // solo se è assoluta o relativa. Deve dipendere da CHI la impone. Una data che
  // non obbliga nessuno non è una scadenza: è una notizia.
  //
  // ⚠️ Il campo è a TRE stati, non due, e il terzo conta: `undefined` significa
  // «il modello non ha risposto alla domanda» — un'analisi prodotta prima che
  // questo campo esistesse, o un output monco. Lì non si declassa niente, perché
  // trattare il silenzio come «non obbliga» cancellerebbe di colpo le scadenze
  // vere di ogni analisi vecchia. Solo un `false` ESPLICITO declassa.
  const obliga = ai.deadline?.obligesCompany;
  if (obliga === false && dType !== 'none') {
    warnings.push('deadline: data che non obbliga l\'azienda (termine del mittente) → non è una scadenza');
    dType = 'none';
    dDate = null;
  }
  if (dType === 'explicit') {
    if (!isIsoDate(dDate)) {
      warnings.push('deadline.date non valida per un tipo explicit: azzerata');
      uncertainties.push({ field: 'deadline', description: 'Data di scadenza non confermabile: verificare manualmente', severity: 'high' });
      dDate = null;
    }
  } else {
    dDate = null; // relative/inferred/none: mai una data assoluta (§11)
  }
  // §20 — la scadenza è il dato più critico: una data "esplicita" vale solo se
  // la citazione che la sostiene esiste davvero nel testo. Senza citazione
  // verificata resta la data (è l'unica informazione che abbiamo) ma va
  // dichiarata DA VERIFICARE, esattamente come si declassano azioni e rischi.
  const deadlineEvidence = ver(ai.deadline?.evidence ?? null);
  const deadlineUnverified = dType === 'explicit' && dDate != null && !deadlineEvidence?.verified;
  const deadlineRequiresVerification =
    dType === 'relative' || dType === 'inferred' || (dType === 'explicit' && dDate == null) || deadlineUnverified;

  if (dType === 'relative') {
    uncertainties.push({ field: 'deadline', description: 'Scadenza relativa: data esatta da verificare in base alla data di ricezione', severity: 'medium' });
  }
  if (deadlineUnverified) {
    warnings.push('scadenza explicit senza citazione verificata: marcata da verificare');
    uncertainties.push({
      field: 'deadline',
      description: 'La data di scadenza non è confermata da una citazione verificabile nel documento: controllarla sull’originale',
      severity: 'high',
    });
  }

  // §13/§14 — azioni: extracted resta tale solo con evidence verificata.
  const rawActions = Array.isArray(ai.requestedActions) ? ai.requestedActions.slice(0, 6) : [];
  const actions: NormAction[] = rawActions.map((a, i) => {
    const evidence = ver(a?.evidence ?? null);
    const claimedExtracted = a?.sourceType === 'extracted';
    const sourceType: 'extracted' | 'suggested' = claimedExtracted && evidence?.verified ? 'extracted' : 'suggested';
    if (claimedExtracted && sourceType === 'suggested') {
      warnings.push('azione dichiarata extracted senza citazione verificata: declassata a suggested');
    }
    return {
      id: i,
      title: cleanStr(a?.title) ?? 'Azione',
      description: cleanStr(a?.description) ?? '',
      sourceType,
      required: typeof a?.required === 'boolean' ? a.required : null,
      deadlineReference: cleanStr(a?.deadlineReference),
      confidence: clamp01(a?.confidence),
      evidence: sourceType === 'extracted' ? evidence : null,
    };
  });

  // §14 — primaryAction: obbligo estratto > estratta con scadenza > estratta > suggerita.
  const priority = (a: NormAction) =>
    a.sourceType === 'extracted' && a.required === true ? 0
      : a.sourceType === 'extracted' && (a.deadlineReference || dDate) ? 1
        : a.sourceType === 'extracted' ? 2 : 3;
  const primaryAction = actions.length
    ? actions.map((a, idx) => ({ a, idx, p: priority(a) })).sort((x, y) => x.p - y.p || x.idx - y.idx)[0].a
    : null;

  // §16 — rischi: explicit resta tale solo con evidence verificata.
  const risks = (Array.isArray(ai.risks) ? ai.risks : []).map((r) => {
    const evidence = ver(r?.evidence ?? null);
    const claimedExplicit = r?.sourceType === 'explicit';
    const sourceType: 'explicit' | 'inferred' = claimedExplicit && evidence?.verified ? 'explicit' : 'inferred';
    if (claimedExplicit && sourceType === 'inferred') {
      warnings.push('rischio dichiarato explicit senza citazione verificata: declassato a inferred');
    }
    return { text: cleanStr(r?.text) ?? '', sourceType, confidence: clamp01(r?.confidence), evidence: sourceType === 'explicit' ? evidence : null };
  }).filter((r) => r.text);

  // §12 — importi: numeri finiti; la valuta si normalizza, NON si inventa.
  //
  // ⚠️⚠️ Fino al 2026-07-29 qui c'era `?? 'CHF'`. Sembrava un ripiego comodo su
  // un'app svizzera, ed era una risposta inventata a una domanda non posta: una
  // fattura tedesca da «4.500,00 EUR» in cui il modello non ripete la valuta
  // usciva da qui come 4500 CHF. Peggio, disinnescava la guardia scritta apposta
  // in `automation/conditions.ts` («CHF 5'000 non è EUR 5'000»), che di fronte a
  // una valuta ASSENTE risponde «non lo so» e non fa scattare la regola — ma di
  // fronte a un CHF inventato risponde «sì» e la fa scattare.
  //
  // L'importo si TIENE: buttarlo cambierebbe l'esito delle regole `exists` /
  // `not_exists` già scritte dagli utenti. Sparisce solo la certezza falsa.
  const amounts = (Array.isArray(ai.amounts) ? ai.amounts : [])
    .filter((a) => typeof a?.amount === 'number' && Number.isFinite(a.amount))
    .map((a) => ({
      amount: a.amount,
      currency: normalizeCurrency(cleanStr(a?.currency)),
      type: oneOf(a?.type, ['due', 'fine', 'fee', 'contribution', 'other'] as const, 'other'),
      description: cleanStr(a?.description) ?? '',
      confidence: clamp01(a?.confidence),
      evidence: ver(a?.evidence ?? null),
    }));

  // ⚠️ Severità `medium` e non `high`: una `high` manderebbe l'intera analisi in
  // `needs_review` (vedi `reviewStatus`), e un importo senza valuta dichiarata è
  // un dettaglio da controllare, non un'analisi da rifare.
  if (amounts.some((a) => a.currency === null) && !uncertainties.some((u) => u.field === 'amounts')) {
    uncertainties.push({
      field: 'amounts',
      description: 'Valuta non indicata nel documento per almeno un importo: verificare prima di usarlo in un confronto',
      severity: 'medium',
    });
  }

  const senderName = cleanStr(ai.sender?.name);
  const authorityType = oneOf<AuthorityType>(ai.sender?.authorityType, AUTHORITY_TYPES, 'unknown');
  if (!senderName && !uncertainties.some((u) => u.field === 'sender')) {
    uncertainties.push({ field: 'sender', description: 'Ente mittente non identificato con certezza', severity: 'medium' });
  }

  const docDate = cleanStr(ai.documentDate);

  const normalized: NormalizedAnalysis = {
    // ⚠️ Il ripiego è `other`, non `it`. Prima era `it`, e siccome l'elenco non
    // conteneva l'inglese, OGNI documento inglese usciva «italiano»: un dato
    // sbagliato prodotto con la stessa faccia di uno giusto.
    language: oneOf<Language>(ai.language, LANGUAGES, 'other'),
    documentType: {
      value: oneOf<DocumentType>(ai.documentType?.value, DOCUMENT_TYPES, 'other'),
      confidence: clamp01(ai.documentType?.confidence),
      evidence: ver(ai.documentType?.evidence ?? null),
    },
    sender: {
      name: senderName,
      authorityType,
      confidence: clamp01(ai.sender?.confidence),
      evidence: senderName ? ver(ai.sender?.evidence ?? null) : null,
    },
    recipient: cleanStr(ai.recipient),
    subject: cleanStr(ai.subject),
    documentDate: isIsoDate(docDate) ? docDate : null,
    referenceNumbers: (Array.isArray(ai.referenceNumbers) ? ai.referenceNumbers : [])
      .map((r) => ({ label: cleanStr(r?.label) ?? '', value: cleanStr(r?.value) ?? '', evidence: ver(r?.evidence ?? null) }))
      .filter((r) => r.value),
    summary: cleanStr(ai.summaryShort) ?? '',
    deadline: {
      date: dDate,
      type: dType,
      sourceText: cleanStr(ai.deadline?.sourceText),
      confidence: clamp01(ai.deadline?.confidence),
      evidence: deadlineEvidence,   // già verificata sopra: non ri-verificare (falserebbe il conteggio)
      requiresVerification: deadlineRequiresVerification,
    },
    amounts,
    actions,
    primaryAction,
    requestedDocuments: (Array.isArray(ai.requestedDocuments) ? ai.requestedDocuments : [])
      .map((d) => ({ name: cleanStr(d?.name) ?? '', required: typeof d?.required === 'boolean' ? d.required : null, confidence: clamp01(d?.confidence), evidence: ver(d?.evidence ?? null) }))
      .filter((d) => d.name),
    risks,
    legalReferences: (Array.isArray(ai.legalReferences) ? ai.legalReferences : [])
      .map((l) => ({ text: cleanStr(l?.text) ?? '', evidence: ver(l?.evidence ?? null) }))
      .filter((l) => l.text),
    replyNeeded: typeof ai.replyNeeded === 'boolean' ? ai.replyNeeded : false,
    uncertainties: [],
    overallConfidence: clamp01(ai.overallConfidence),
    meta: { droppedEvidence: dropped, warnings },
  };

  if (dropped > 0) {
    uncertainties.push({
      field: 'evidence',
      description: `${dropped} citazione/i del modello non ritrovate nel documento e scartate`,
      severity: 'low',
    });
  }
  // dedup incertezze per (field+description)
  const seen = new Set<string>();
  normalized.uncertainties = uncertainties.filter((u) => {
    const k = u.field + '¦' + u.description;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  return normalized;
}

// ---- Categorie d'errore (§46) -----------------------------------------------
export const ERROR_CODES = [
  'UNSUPPORTED_FILE', 'FILE_TOO_LARGE', 'EMPTY_DOCUMENT', 'EXTRACTION_FAILED', 'OCR_FAILED',
  'AI_TIMEOUT', 'AI_INVALID_OUTPUT', 'AI_OUTPUT_TRUNCATED', 'EVIDENCE_VALIDATION_FAILED',
  'RATE_LIMITED', 'PROVIDER_ERROR', 'AI_NOT_CONFIGURED', 'AI_CREDIT_EXHAUSTED', 'UNKNOWN_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Che genere di guasto ha restituito il fornitore del modello?
 *
 * ⚠️ SI GUARDA IL MESSAGGIO, e non è una scelta elegante: l'API risponde
 * `400 invalid_request_error` sia per un credito esaurito sia per una richiesta
 * malformata, e il `type` non li distingue. L'unica differenza osservabile è
 * nel testo. Verificato contro l'API vera il 2026-07-29, quando il credito del
 * progetto si è esaurito e Admin AI ha cominciato a rispondere «riprova più
 * tardi» a un problema che aspettare non risolve.
 *
 * ⚠️ IL CONFRONTO È LARGO DI PROPOSITO: se un giorno il testo cambiasse, il
 * caso ricadrebbe in `PROVIDER_ERROR` — cioè nel comportamento di prima, non in
 * uno peggiore. Un riconoscitore troppo stretto che smette di funzionare in
 * silenzio è la trappola che questo progetto ha già pagato due volte.
 */
export function classifyProviderError(error: unknown): ErrorCode {
  const err = error as { status?: number; name?: string; message?: string } | null;
  const message = (err?.message ?? '').toLowerCase();

  if (/credit balance|insufficient.{0,20}credit|billing|quota exceeded/.test(message)) {
    return 'AI_CREDIT_EXHAUSTED';
  }
  if (err?.status === 429) return 'RATE_LIMITED';
  if (err?.name === 'AbortError') return 'AI_TIMEOUT';
  return 'PROVIDER_ERROR';
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNSUPPORTED_FILE: 'Formato file non supportato.',
  FILE_TOO_LARGE: 'Il file supera la dimensione massima consentita.',
  EMPTY_DOCUMENT: 'Il documento sembra vuoto o senza testo leggibile.',
  EXTRACTION_FAILED: 'Non è stato possibile estrarre il testo dal documento.',
  OCR_FAILED: 'Il riconoscimento del testo (OCR) non è riuscito.',
  AI_TIMEOUT: "L'analisi ha impiegato troppo tempo. Riprova.",
  AI_INVALID_OUTPUT: "La risposta del modello non è in un formato valido.",
  // ⚠️ NON è `AI_INVALID_OUTPUT`, e la differenza non è una sfumatura: il modello
  // stava rispondendo bene ed è stato interrotto dal tetto di token che abbiamo
  // scelto NOI. «La risposta non è in un formato valido» accusa il fornitore di
  // un limite nostro, e manda chi legge a cercare il guasto dove non è. Alzare
  // il tetto è una decisione da prendere con i suoi conti (§28): con
  // `messages.create` sincrono si scambierebbe una troncatura rara con un
  // timeout nuovo, che è un guasto peggiore perché non dice nemmeno perché.
  AI_OUTPUT_TRUNCATED:
    "L'analisi si è interrotta prima della fine: il documento richiede una "
    + "risposta più lunga di quella prevista. Non dipende dal documento — "
    + "serve un intervento di chi amministra l'applicazione.",
  EVIDENCE_VALIDATION_FAILED: 'Le informazioni estratte non hanno superato la verifica.',
  RATE_LIMITED: 'Troppe analisi in poco tempo. Attendi qualche istante e riprova.',
  PROVIDER_ERROR: "Il servizio di analisi ha restituito un errore. Riprova più tardi.",
  AI_NOT_CONFIGURED: 'Servizio AI non configurato.',
  // ⚠️ NON dice «riprova più tardi», e la differenza è tutto il punto: aspettare
  // non risolve un credito esaurito. Un messaggio che manda nella direzione
  // sbagliata è peggio di uno generico — chi legge riprova per mezz'ora prima
  // di sospettare che il problema non sia suo.
  AI_CREDIT_EXHAUSTED:
    "Il servizio di analisi non ha credito disponibile. Non dipende dal documento: "
    + "serve un intervento di chi amministra l'applicazione.",
  UNKNOWN_ERROR: 'Analisi non riuscita. Riprova tra poco.',
};
