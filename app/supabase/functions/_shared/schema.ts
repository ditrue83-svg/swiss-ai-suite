// ============================================================================
// SwissAI Suite — Schema dell'analisi documentale (Fase 2)
//
// Modulo PORTABILE (solo API web-standard): importato sia dalla Edge Function
// (Deno) sia dai test (Node via tsx). Nessuna dipendenza esterna qui.
//
// Contiene:
//  - lo schema JSON forzato per gli structured outputs di Claude (§6–18);
//  - i tipi TypeScript corrispondenti;
//  - gli enum normalizzati (§7 authorityType, §8 documentType, ecc.).
//
// prompt e validazione stanno in prompt.ts e validate.ts.
// ============================================================================

export const SCHEMA_VERSION = 2;
// 2026-07-25: la lingua dei testi generati segue quella dell'interfaccia (it/de/fr).
export const PROMPT_VERSION = 'admin-ai-2026-07-25-multilang';

// ---- Enum normalizzati ------------------------------------------------------
export const LANGUAGES = ['it', 'de', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DOCUMENT_TYPES = [
  'information', 'request_for_documents', 'payment_request', 'reminder', 'invoice',
  'declaration_request', 'official_decision', 'inspection_notice', 'tax_document',
  'social_insurance', 'employment', 'permit', 'contract_related', 'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const AUTHORITY_TYPES = [
  'federal', 'cantonal', 'municipal', 'social_insurance', 'insurance',
  'pension', 'private', 'unknown',
] as const;
export type AuthorityType = (typeof AUTHORITY_TYPES)[number];

export const DEADLINE_TYPES = ['explicit', 'relative', 'inferred', 'none'] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];

export const AMOUNT_TYPES = ['due', 'fine', 'fee', 'contribution', 'other'] as const;
export type AmountType = (typeof AMOUNT_TYPES)[number];

export const ACTION_SOURCES = ['extracted', 'suggested'] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];

export const RISK_SOURCES = ['explicit', 'inferred'] as const;
export type RiskSource = (typeof RISK_SOURCES)[number];

export const SEVERITIES = ['low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

// ---- Tipi dell'output AI (prima della validazione) --------------------------
// NB: gli structured outputs limitano a 16 i parametri con union/nullable, quindi
// evidence NON è nullable: quote "" = nessuna evidenza, pageNumber 0 = sconosciuto.
export interface AiEvidence {
  quote: string;
  pageNumber: number;
}

export interface AiAnalysis {
  language: Language;
  documentType: { value: DocumentType; confidence: number; evidence: AiEvidence };
  sender: { name: string | null; authorityType: AuthorityType; confidence: number; evidence: AiEvidence };
  recipient: string | null;
  subject: string | null;
  documentDate: string | null;
  referenceNumbers: { label: string; value: string; evidence: AiEvidence }[];
  summaryShort: string;
  deadline: {
    date: string | null;
    type: DeadlineType;
    sourceText: string | null;
    confidence: number;
    evidence: AiEvidence | null;
  };
  amounts: {
    amount: number;
    currency: string;
    type: AmountType;
    description: string;
    confidence: number;
    evidence: AiEvidence | null;
  }[];
  requestedActions: {
    title: string;
    description: string;
    sourceType: ActionSource;
    required: boolean | null;
    deadlineReference: string | null;
    confidence: number;
    evidence: AiEvidence | null;
  }[];
  requestedDocuments: { name: string; required: boolean | null; confidence: number; evidence: AiEvidence }[];
  risks: { text: string; sourceType: RiskSource; confidence: number; evidence: AiEvidence }[];
  legalReferences: { text: string; evidence: AiEvidence }[];
  replyNeeded: boolean;
  uncertainties: { field: string; description: string; severity: Severity }[];
  overallConfidence: number;
}

// ---- Helper JSON Schema (vincoli structured outputs) ------------------------
// Regole: additionalProperties:false ovunque; nullable via anyOf; niente
// min/max su numeri o stringhe (validati in validate.ts).
const nullable = (s: object) => ({ anyOf: [s, { type: 'null' }] });
// Evidence NON nullable (limite 16 union): quote "" = nessuna, pageNumber 0 = sconosciuto.
const evidenceSchema = {
  type: 'object', additionalProperties: false,
  required: ['quote', 'pageNumber'],
  properties: {
    quote: { type: 'string' },
    pageNumber: { type: 'integer' },
  },
};
const obj = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties,
});
const arr = (items: object) => ({ type: 'array', items });

// ---- Schema JSON per output_config.format -----------------------------------
export const ANALYSIS_JSON_SCHEMA = obj({
  language: { type: 'string', enum: [...LANGUAGES] },
  documentType: obj({
    value: { type: 'string', enum: [...DOCUMENT_TYPES] },
    confidence: { type: 'number' },
    evidence: evidenceSchema,
  }),
  sender: obj({
    name: nullable({ type: 'string' }),
    authorityType: { type: 'string', enum: [...AUTHORITY_TYPES] },
    confidence: { type: 'number' },
    evidence: evidenceSchema,
  }),
  recipient: nullable({ type: 'string' }),
  subject: nullable({ type: 'string' }),
  documentDate: nullable({ type: 'string' }),
  referenceNumbers: arr(obj({
    label: { type: 'string' },
    value: { type: 'string' },
    evidence: evidenceSchema,
  })),
  summaryShort: { type: 'string' },
  deadline: obj({
    date: nullable({ type: 'string' }),
    type: { type: 'string', enum: [...DEADLINE_TYPES] },
    sourceText: nullable({ type: 'string' }),
    confidence: { type: 'number' },
    evidence: evidenceSchema,
  }),
  amounts: arr(obj({
    amount: { type: 'number' },
    currency: { type: 'string' },
    type: { type: 'string', enum: [...AMOUNT_TYPES] },
    description: { type: 'string' },
    confidence: { type: 'number' },
    evidence: evidenceSchema,
  })),
  requestedActions: arr(obj({
    title: { type: 'string' },
    description: { type: 'string' },
    sourceType: { type: 'string', enum: [...ACTION_SOURCES] },
    required: nullable({ type: 'boolean' }),
    deadlineReference: nullable({ type: 'string' }),
    confidence: { type: 'number' },
    evidence: evidenceSchema,
  })),
  requestedDocuments: arr(obj({
    name: { type: 'string' },
    required: nullable({ type: 'boolean' }),
    confidence: { type: 'number' },
    evidence: evidenceSchema,
  })),
  risks: arr(obj({
    text: { type: 'string' },
    sourceType: { type: 'string', enum: [...RISK_SOURCES] },
    confidence: { type: 'number' },
    evidence: evidenceSchema,
  })),
  legalReferences: arr(obj({
    text: { type: 'string' },
    evidence: evidenceSchema,
  })),
  replyNeeded: { type: 'boolean' },
  uncertainties: arr(obj({
    field: { type: 'string' },
    description: { type: 'string' },
    severity: { type: 'string', enum: [...SEVERITIES] },
  })),
  overallConfidence: { type: 'number' },
});
