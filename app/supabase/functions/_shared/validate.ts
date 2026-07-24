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
  amounts: { amount: number; currency: string; type: string; description: string; confidence: number; evidence: Evidence | null }[];
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
  const dType = oneOf<DeadlineType>(ai.deadline?.type, DEADLINE_TYPES, 'none');
  let dDate = cleanStr(ai.deadline?.date);
  if (dType === 'explicit') {
    if (!isIsoDate(dDate)) {
      warnings.push('deadline.date non valida per un tipo explicit: azzerata');
      uncertainties.push({ field: 'deadline', description: 'Data di scadenza non confermabile: verificare manualmente', severity: 'high' });
      dDate = null;
    }
  } else {
    dDate = null; // relative/inferred/none: mai una data assoluta (§11)
  }
  const deadlineRequiresVerification = dType === 'relative' || dType === 'inferred' || (dType === 'explicit' && dDate == null);
  if (dType === 'relative') {
    uncertainties.push({ field: 'deadline', description: 'Scadenza relativa: data esatta da verificare in base alla data di ricezione', severity: 'medium' });
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

  // §12 — importi: numeri finiti, currency non vuota (uppercase).
  const amounts = (Array.isArray(ai.amounts) ? ai.amounts : [])
    .filter((a) => typeof a?.amount === 'number' && Number.isFinite(a.amount))
    .map((a) => ({
      amount: a.amount,
      currency: (cleanStr(a?.currency) ?? 'CHF').toUpperCase(),
      type: oneOf(a?.type, ['due', 'fine', 'fee', 'contribution', 'other'] as const, 'other'),
      description: cleanStr(a?.description) ?? '',
      confidence: clamp01(a?.confidence),
      evidence: ver(a?.evidence ?? null),
    }));

  const senderName = cleanStr(ai.sender?.name);
  const authorityType = oneOf<AuthorityType>(ai.sender?.authorityType, AUTHORITY_TYPES, 'unknown');
  if (!senderName && !uncertainties.some((u) => u.field === 'sender')) {
    uncertainties.push({ field: 'sender', description: 'Ente mittente non identificato con certezza', severity: 'medium' });
  }

  const docDate = cleanStr(ai.documentDate);

  const normalized: NormalizedAnalysis = {
    language: oneOf<Language>(ai.language, LANGUAGES, 'it'),
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
      evidence: ver(ai.deadline?.evidence ?? null),
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
  'AI_TIMEOUT', 'AI_INVALID_OUTPUT', 'EVIDENCE_VALIDATION_FAILED', 'RATE_LIMITED',
  'PROVIDER_ERROR', 'AI_NOT_CONFIGURED', 'UNKNOWN_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNSUPPORTED_FILE: 'Formato file non supportato.',
  FILE_TOO_LARGE: 'Il file supera la dimensione massima consentita.',
  EMPTY_DOCUMENT: 'Il documento sembra vuoto o senza testo leggibile.',
  EXTRACTION_FAILED: 'Non è stato possibile estrarre il testo dal documento.',
  OCR_FAILED: 'Il riconoscimento del testo (OCR) non è riuscito.',
  AI_TIMEOUT: "L'analisi ha impiegato troppo tempo. Riprova.",
  AI_INVALID_OUTPUT: "La risposta del modello non è in un formato valido.",
  EVIDENCE_VALIDATION_FAILED: 'Le informazioni estratte non hanno superato la verifica.',
  RATE_LIMITED: 'Troppe analisi in poco tempo. Attendi qualche istante e riprova.',
  PROVIDER_ERROR: "Il servizio di analisi ha restituito un errore. Riprova più tardi.",
  AI_NOT_CONFIGURED: 'Servizio AI non configurato.',
  UNKNOWN_ERROR: 'Analisi non riuscita. Riprova tra poco.',
};
