// ============================================================================
// VALIDAZIONE E NORMALIZZAZIONE di ciò che il modello ha restituito.
//
// ⚠️ NIENTE ENTRA IN CONTRACT MANAGER SENZA PASSARE DI QUI. È la disciplina di
// `_shared/validate.ts` (Admin AI) e di `_shared/finance/validate.ts`, e qui
// pesa quanto là: i valori di cui si parla decidono quando un'azienda può
// disdire un contratto.
//
// LE CINQUE REGOLE CHE QUESTO FILE APPLICA
//
// 1. UN CAMPO NON PREVISTO NON ESISTE. Il modello può restituire quello che
//    vuole: entra soltanto ciò che sta in `CONTRACT_AI_FIELDS`. È la difesa
//    contro un documento che contenga «aggiungi il campo X».
//
// 2. UNA FIDUCIA BASSA NON È UN FATTO. Sotto `CONTRACT_MIN_CONFIDENCE` il valore
//    non si salva: resta `null` e l'incertezza lo dichiara.
//
// 3. SUI CAMPI CHE DECIDONO UNA SCADENZA O UN COSTO LA CITAZIONE È OBBLIGATORIA.
//    Date, preavviso, ancoraggio, rinnovo e importo senza una citazione
//    RITROVATA nel testo vengono rifiutati. Su un indirizzo o sul foro
//    competente la citazione mancante costa solo la citazione.
//
// 4. LA CONVERSIONE LA FA IL CODICE. «drei Monate» diventa {3, months} qui, con
//    `periods.ts`; se non si riesce a leggerlo, il valore cade — `null` è un
//    esito, un periodo indovinato no.
//
// 5. NESSUN GIUDIZIO ENTRA. Le clausole di attenzione sono rilevazioni con una
//    citazione; una voce senza citazione ritrovata viene scartata, perché una
//    clausola che il prodotto afferma senza poterla mostrare è un'opinione.
//
// Modulo PORTABILE: funzioni pure. Nessun database, nessun `Deno`.
// ============================================================================
import {
  ATTENTION_CLAUSE_KINDS, CONTRACT_MIN_CONFIDENCE, CONTRACT_TYPES,
  COST_FREQUENCIES, END_DATE_KINDS, TERMINATION_METHODS,
  type AttentionClauseKind, type ContractAutoRenewal, type ContractCostFrequency,
  type ContractEndKind, type ContractNoticeAnchor, type ContractPeriodUnit,
  type ContractQualityFlag, type ContractTerminationMethod, type ContractType,
} from './contract.ts';
import { canDeriveNoticeDeadline, detectAnchor, normalizeAnchor, parsePeriod } from './periods.ts';

// ---------------------------------------------------------------------------
// Citazioni
// ---------------------------------------------------------------------------

export interface ContractSourceText {
  fullText: string;
  pages: { pageNumber: number; text: string }[];
}

/** Citazione verificata. `start`/`end` non vengono MAI dal modello: si calcolano. */
export interface ContractEvidence {
  quote: string;
  start: number | null;
  end: number | null;
  page: number | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normWs = (s: string) => s.replace(/\s+/g, ' ').trim();

const cleanStr = (s: unknown, maxLength = 400): string | null => {
  if (typeof s !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return t.length ? t.slice(0, maxLength) : null;
};

const clamp01 = (n: unknown): number => {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
};

/**
 * Ritrova una citazione nel testo estratto e ne calcola gli offset.
 *
 * ⚠️ DOPPIONE DICHIARATO di `locateQuote()` di Finance, stessa meccanica
 * (esatta → senza maiuscole → spazi elastici) e stessa ragione per non riusarla:
 * quella vive in un modulo legato ai tipi delle fatture. La copia è di quindici
 * righe e `test:contracts-unit` la confronta con l'originale sugli stessi casi.
 */
function locateQuote(text: string, quote: string): { start: number; end: number } | null {
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

export function verifyQuote(
  source: ContractSourceText,
  raw: unknown,
  rawPage?: unknown,
): ContractEvidence | null {
  const quote = cleanStr(
    typeof raw === 'object' && raw !== null ? (raw as { quote?: unknown }).quote : raw,
    600,
  );
  if (!quote) return null;

  const hit = locateQuote(source.fullText, quote);
  if (!hit) return null;

  const pageRaw = typeof raw === 'object' && raw !== null
    ? (raw as { pageNumber?: unknown }).pageNumber
    : rawPage;
  let page = typeof pageRaw === 'number' && pageRaw > 0 ? pageRaw : null;
  if (page !== null && !source.pages.some((p) => p.pageNumber === page)) page = null;
  if (page === null) {
    const nq = normWs(quote);
    const found = source.pages.find((p) => normWs(p.text).includes(nq));
    if (found) page = found.pageNumber;
  }
  return { quote, start: hit.start, end: hit.end, page };
}

// ---------------------------------------------------------------------------
// Il risultato
// ---------------------------------------------------------------------------

export interface ContractFieldValue<T> {
  /** Il testo così come stampato: serve a mostrare l'originale accanto al dato. */
  raw: string;
  value: T;
  confidence: number;
  evidence: ContractEvidence | null;
}

export interface ContractObligation {
  party: 'company' | 'counterparty' | 'both' | 'unclear';
  text: string;
  cadence: string | null;
  confidence: number;
  evidence: ContractEvidence;
}

export interface ContractAttentionClause {
  kind: AttentionClauseKind;
  text: string;
  evidence: ContractEvidence;
}

export interface ContractPenalty {
  text: string;
  amount: string | null;
  currency: string | null;
  evidence: ContractEvidence;
}

export interface ContractReferencedAnnex {
  text: string;
  evidence: ContractEvidence;
}

export interface ContractUncertainty {
  field: string;
  /** CHIAVE quando la scrive il codice, prosa quando la scrive il modello. */
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ContractReading {
  documentIsContract: boolean;
  detectedType: ContractType | null;
  outOfScopeKind: string | null;
  documentLanguage: string | null;

  companyParty: ContractFieldValue<string> | null;
  counterparty: ContractFieldValue<string> | null;
  counterpartyAddress: ContractFieldValue<string> | null;

  documentDate: ContractFieldValue<string> | null;
  signatureDate: ContractFieldValue<string> | null;
  startDate: ContractFieldValue<string> | null;
  endDate: ContractFieldValue<string> | null;
  endDateKind: ContractEndKind;

  minimumTerm: ContractFieldValue<{ value: number; unit: ContractPeriodUnit }> | null;
  autoRenewal: ContractAutoRenewal;
  autoRenewalEvidence: ContractEvidence | null;
  renewalPeriod: ContractFieldValue<{ value: number; unit: ContractPeriodUnit }> | null;
  noticePeriod: ContractFieldValue<{ value: number; unit: ContractPeriodUnit }> | null;
  noticeAnchor: ContractNoticeAnchor | null;
  noticeAnchorText: string | null;
  noticeAnchorEvidence: ContractEvidence | null;

  terminationMethod: ContractFieldValue<ContractTerminationMethod> | null;
  terminationAddress: ContractFieldValue<string> | null;

  costAmount: ContractFieldValue<string> | null;
  costCurrency: string | null;
  costFrequency: ContractCostFrequency;
  costVatIncluded: boolean | null;
  priceAdjustment: boolean;

  governingLaw: string | null;
  jurisdiction: string | null;
  signed: boolean | null;

  obligations: ContractObligation[];
  attentionClauses: ContractAttentionClause[];
  penalties: ContractPenalty[];
  referencedAnnexes: ContractReferencedAnnex[];

  uncertainties: ContractUncertainty[];
  qualityFlags: ContractQualityFlag[];
  overallConfidence: number;
  /** Che cosa è stato scartato e perché. Solo CODICI: finisce nei log (§110). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Estrazione di un singolo campo
// ---------------------------------------------------------------------------

/**
 * I campi la cui citazione è obbligatoria.
 * ⚠️ Sono esattamente quelli che decidono UNA SCADENZA o UN COSTO. Sul resto si
 * è più tolleranti di proposito: un indirizzo senza citazione resta utile, e
 * rifiutarlo produrrebbe schede vuote su contratti perfettamente leggibili —
 * cioè insegnerebbe a non fidarsi delle verifiche.
 */
const QUOTE_REQUIRED = new Set([
  'start_date', 'end_date', 'end_date_kind', 'minimum_term', 'auto_renewal',
  'renewal_period', 'notice_period', 'notice_anchor_text', 'cost_amount',
]);

interface RawField { raw: string | null; confidence: number; evidence: ContractEvidence | null }

function readField(
  fields: Record<string, unknown>,
  name: string,
  source: ContractSourceText,
  warnings: string[],
): RawField | null {
  const entry = fields[name];
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as { raw?: unknown; confidence?: unknown; evidence?: unknown };

  const raw = cleanStr(e.raw, 600);
  if (raw === null) return null;

  const confidence = clamp01(e.confidence);
  if (confidence < CONTRACT_MIN_CONFIDENCE) {
    warnings.push(`low_confidence:${name}`);
    return null;
  }

  const evidence = verifyQuote(source, e.evidence);
  if (!evidence && QUOTE_REQUIRED.has(name)) {
    // ⚠️ La citazione non ritrovata NON è un dettaglio formale: significa che il
    // valore non è stato letto nel documento che stiamo guardando. Su un campo
    // che decide una scadenza, tenerlo vorrebbe dire fidarsi di una frase che
    // nessuno può controllare.
    warnings.push(`quote_not_found:${name}`);
    return null;
  }
  return { raw, confidence, evidence };
}

const asText = (f: RawField | null): ContractFieldValue<string> | null =>
  f ? { raw: f.raw!, value: f.raw!, confidence: f.confidence, evidence: f.evidence } : null;

const asPeriod = (
  f: RawField | null,
  warnings: string[],
  name: string,
): ContractFieldValue<{ value: number; unit: ContractPeriodUnit }> | null => {
  if (!f?.raw) return null;
  const parsed = parsePeriod(f.raw);
  if (!parsed) {
    // Il periodo c'è ma non si legge («tre mesi il primo anno, sei in seguito»):
    // il valore cade e la clausola resta visibile fra le incertezze.
    warnings.push(`period_unreadable:${name}`);
    return null;
  }
  return { raw: f.raw, value: parsed, confidence: f.confidence, evidence: f.evidence };
};

function pickEnum<T extends string>(
  f: RawField | null,
  allowed: readonly T[],
): ContractFieldValue<T> | null {
  if (!f?.raw) return null;
  const value = allowed.find((a) => a === f.raw!.toLowerCase().trim());
  return value ? { raw: f.raw, value, confidence: f.confidence, evidence: f.evidence } : null;
}

function readBoolean(f: RawField | null): boolean | null {
  if (!f?.raw) return null;
  const v = f.raw.toLowerCase().trim();
  if (v === 'true' || v === 'sì' || v === 'si' || v === 'ja' || v === 'oui' || v === 'yes') return true;
  if (v === 'false' || v === 'no' || v === 'nein' || v === 'non') return false;
  return null;
}

// ---------------------------------------------------------------------------
// La validazione completa
// ---------------------------------------------------------------------------

export interface ValidateInput {
  /** L'oggetto che il modello ha restituito, già decodificato da JSON. */
  payload: unknown;
  source: ContractSourceText;
  truncated: boolean;
}

export function validateContractReading(input: ValidateInput): ContractReading {
  const warnings: string[] = [];
  const uncertainties: ContractUncertainty[] = [];
  const flags = new Set<ContractQualityFlag>();
  const p = (input.payload ?? {}) as Record<string, unknown>;
  const fields = (p.fields && typeof p.fields === 'object' ? p.fields : {}) as Record<string, unknown>;
  const src = input.source;

  const f = (name: string) => readField(fields, name, src, warnings);

  // ---- Identità del documento --------------------------------------------
  const documentIsContract = p.documentIsContract === true;
  const detectedTypeRaw = cleanStr(p.detectedType, 40)?.toLowerCase() ?? null;
  const detectedType = CONTRACT_TYPES.find((t) => t === detectedTypeRaw) ?? null;
  const outOfScopeKind = cleanStr(p.outOfScopeKind, 200);
  if (outOfScopeKind) flags.add('out_of_scope_contract_kind');

  // ---- Parti ---------------------------------------------------------------
  const counterparty = asText(f('counterparty'));
  if (!counterparty) flags.add('missing_counterparty');

  // ---- Date ----------------------------------------------------------------
  const startDate = asText(f('start_date'));
  const endDate = asText(f('end_date'));
  const endKindField = pickEnum(f('end_date_kind'), END_DATE_KINDS);
  // ⚠️ Se una data di fine c'è ma il modello non ha dichiarato il tipo, il tipo è
  // `explicit`: la data è scritta. Se non c'è, resta `unknown` — e `unknown` non
  // è `none`: «non l'ho trovata» e «il contratto è a tempo indeterminato» sono
  // due affermazioni diverse, e una delle due spegnerebbe la sorveglianza.
  const endDateKind: ContractEndKind =
    endKindField?.value ?? (endDate ? 'explicit' : 'unknown');

  // ---- Rinnovo -------------------------------------------------------------
  const renewalField = f('auto_renewal');
  const renewalRaw = renewalField?.raw?.toLowerCase().trim() ?? null;
  // ⚠️ §35 — SOLO `yes` e `no` espliciti. Tutto il resto è `unclear`, compreso il
  // silenzio: un `no` dedotto dall'assenza spegnerebbe l'unica sorveglianza che
  // conta su un contratto che si rinnova da solo.
  const autoRenewal: ContractAutoRenewal =
    renewalRaw === 'yes' ? 'yes' : renewalRaw === 'no' ? 'no' : 'unclear';
  if (autoRenewal === 'unclear') flags.add('renewal_unclear');

  const renewalPeriod = asPeriod(f('renewal_period'), warnings, 'renewal_period');
  const minimumTerm = asPeriod(f('minimum_term'), warnings, 'minimum_term');

  // ---- Preavviso: il cuore del modulo -------------------------------------
  const noticePeriod = asPeriod(f('notice_period'), warnings, 'notice_period');
  const anchorField = f('notice_anchor_text');
  const noticeAnchorText = anchorField?.raw ?? null;

  // ⚠️ L'ANCORAGGIO LO DEDUCE IL CODICE DALLA CLAUSOLA, non il modello.
  // Al modello si chiede la FRASE; qui si riconosce a che cosa si riferisce, con
  // regole leggibili e provate. Chiedere al modello di classificare significava
  // fidarsi di una categoria senza poterla verificare — e su questo campo la
  // differenza fra `before_fixed_end` e `to_month_end` è la differenza fra una
  // data calcolata e nessuna data.
  const noticeAnchor: ContractNoticeAnchor | null = noticePeriod
    ? (noticeAnchorText ? detectAnchor(noticeAnchorText) : 'unclear')
    : null;

  if (noticePeriod && (!noticeAnchor || noticeAnchor === 'unclear')) {
    flags.add('notice_anchor_unclear');
  }
  if (noticePeriod && !canDeriveNoticeDeadline({
    noticeValue: noticePeriod.value.value,
    noticeUnit: noticePeriod.value.unit,
    anchor: noticeAnchor,
    hasExplicitEndDate: endDateKind === 'explicit' && !!endDate,
  })) {
    flags.add('notice_not_derivable');
  }

  // ---- Costi ---------------------------------------------------------------
  const costAmount = asText(f('cost_amount'));
  const currencyField = f('cost_currency');
  const costCurrency = normalizeCurrency(currencyField?.raw ?? null);
  const frequencyField = pickEnum(f('cost_frequency'), COST_FREQUENCIES);
  const costFrequency: ContractCostFrequency = frequencyField?.value ?? 'unknown';
  if (costAmount && costFrequency === 'unknown') flags.add('cost_unclear');

  // ---- Elenchi -------------------------------------------------------------
  const obligations = readObligations(p.obligations, src, warnings);
  const attentionClauses = readAttentionClauses(p.attentionClauses, src, warnings);
  const penalties = readPenalties(p.penalties, src, warnings);
  const referencedAnnexes = readAnnexes(p.referencedAnnexes, src, warnings);
  if (referencedAnnexes.length) flags.add('missing_referenced_annex');

  // ---- Incertezze del modello ---------------------------------------------
  if (Array.isArray(p.uncertainties)) {
    for (const item of p.uncertainties.slice(0, 30)) {
      if (!item || typeof item !== 'object') continue;
      const u = item as Record<string, unknown>;
      const description = cleanStr(u.description, 400);
      if (!description) continue;
      const severity = u.severity === 'high' ? 'high' : u.severity === 'medium' ? 'medium' : 'low';
      uncertainties.push({
        field: cleanStr(u.field, 60) ?? 'general',
        description,
        severity,
      });
    }
  }

  const overallConfidence = clamp01(p.overallConfidence);
  if (overallConfidence > 0 && overallConfidence < 0.5) flags.add('low_extraction_confidence');

  if (input.truncated) {
    flags.add('partially_analysed');
    uncertainties.push({
      // CHIAVE, non frase: la frase la scrive l'interfaccia (§124).
      field: 'document', description: 'document_truncated', severity: 'high',
    });
  }

  return {
    documentIsContract,
    detectedType,
    outOfScopeKind,
    documentLanguage: cleanStr(p.documentLanguage, 10),
    companyParty: asText(f('company_party')),
    counterparty,
    counterpartyAddress: asText(f('counterparty_address')),
    documentDate: asText(f('document_date')),
    signatureDate: asText(f('signature_date')),
    startDate,
    endDate,
    endDateKind,
    minimumTerm,
    autoRenewal,
    autoRenewalEvidence: renewalField?.evidence ?? null,
    renewalPeriod,
    noticePeriod,
    noticeAnchor,
    noticeAnchorText,
    noticeAnchorEvidence: anchorField?.evidence ?? null,
    terminationMethod: pickEnum(f('termination_method'), TERMINATION_METHODS),
    terminationAddress: asText(f('termination_address')),
    costAmount,
    costCurrency,
    costFrequency,
    costVatIncluded: readBoolean(f('cost_vat_included')),
    priceAdjustment: readBoolean(f('price_adjustment')) === true,
    governingLaw: cleanStr(f('governing_law')?.raw, 200),
    jurisdiction: cleanStr(f('jurisdiction')?.raw, 200),
    signed: readBoolean(f('signed')),
    obligations,
    attentionClauses,
    penalties,
    referencedAnnexes,
    uncertainties,
    qualityFlags: [...flags].sort(),
    overallConfidence,
    warnings,
  };
}

/** «CHF», «Fr.», «franchi» → CHF. Nel dubbio `null`: una valuta indovinata no. */
export function normalizeCurrency(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase().replace(/[\s.]/g, '');
  if (/^chf$|^fr$|^franchi|^franken|^francs$/.test(v)) return 'CHF';
  if (/^eur$|^€$|^euro/.test(v)) return 'EUR';
  if (/^usd$|^\$$|^dollar/.test(v)) return 'USD';
  return /^[a-z]{3}$/.test(v) ? v.toUpperCase() : null;
}

// ---------------------------------------------------------------------------
// Gli elenchi: una voce senza citazione ritrovata non entra
// ---------------------------------------------------------------------------

/**
 * ⚠️ IL LIMITE NON È UN DETTAGLIO. Un contratto lungo può produrre decine di
 * «obblighi», e un elenco di quaranta voci non lo legge nessuno: diventa rumore
 * che nasconde le tre che contano. Il taglio è dichiarato nei warning, mai
 * silenzioso.
 */
const MAX_LIST = 20;

function readObligations(
  raw: unknown, src: ContractSourceText, warnings: string[],
): ContractObligation[] {
  if (!Array.isArray(raw)) return [];
  const out: ContractObligation[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LIST) { warnings.push('obligations_truncated'); break; }
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const text = cleanStr(o.text, 500);
    if (!text) continue;
    const evidence = verifyQuote(src, o.evidence);
    // §58 — senza citazione ritrovata non è un obbligo del documento: è una
    // frase del modello, e presentarla come obbligo sarebbe inventare un impegno.
    if (!evidence) { warnings.push('obligation_without_quote'); continue; }
    const partyRaw = cleanStr(o.party, 20)?.toLowerCase();
    const party = partyRaw === 'company' || partyRaw === 'counterparty' || partyRaw === 'both'
      ? partyRaw : 'unclear';
    out.push({
      party, text, cadence: cleanStr(o.cadence, 120),
      confidence: clamp01(o.confidence), evidence,
    });
  }
  return out;
}

function readAttentionClauses(
  raw: unknown, src: ContractSourceText, warnings: string[],
): ContractAttentionClause[] {
  if (!Array.isArray(raw)) return [];
  const out: ContractAttentionClause[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LIST) { warnings.push('clauses_truncated'); break; }
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const kindRaw = cleanStr(c.kind, 40)?.toLowerCase();
    const kind = ATTENTION_CLAUSE_KINDS.find((k) => k === kindRaw) ?? null;
    const text = cleanStr(c.text, 500);
    if (!kind || !text) continue;
    const evidence = verifyQuote(src, c.evidence);
    if (!evidence) { warnings.push('clause_without_quote'); continue; }
    out.push({ kind, text, evidence });
  }
  return out;
}

function readPenalties(
  raw: unknown, src: ContractSourceText, warnings: string[],
): ContractPenalty[] {
  if (!Array.isArray(raw)) return [];
  const out: ContractPenalty[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LIST) { warnings.push('penalties_truncated'); break; }
    if (!item || typeof item !== 'object') continue;
    const pn = item as Record<string, unknown>;
    const text = cleanStr(pn.text, 500);
    if (!text) continue;
    const evidence = verifyQuote(src, pn.evidence);
    // §61 — una penale che il prodotto afferma senza poterla mostrare è
    // esattamente il tipo di affermazione che questo modulo non fa.
    if (!evidence) { warnings.push('penalty_without_quote'); continue; }
    out.push({
      text,
      amount: cleanStr(pn.amount, 60),
      currency: normalizeCurrency(cleanStr(pn.currency, 20)),
      evidence,
    });
  }
  return out;
}

function readAnnexes(
  raw: unknown, src: ContractSourceText, warnings: string[],
): ContractReferencedAnnex[] {
  if (!Array.isArray(raw)) return [];
  const out: ContractReferencedAnnex[] = [];
  for (const item of raw) {
    if (out.length >= 10) { warnings.push('annexes_truncated'); break; }
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const text = cleanStr(a.text, 300);
    if (!text) continue;
    const evidence = verifyQuote(src, a.evidence);
    if (!evidence) { warnings.push('annex_without_quote'); continue; }
    out.push({ text, evidence });
  }
  return out;
}

/**
 * Il JSON dentro la risposta del modello.
 * ⚠️ Nessun `eval`, nessuna riparazione creativa: o è JSON o non lo è. Un
 * oggetto «aggiustato» è un oggetto di cui nessuno conosce più la provenienza.
 */
export function parseModelJson(text: string): unknown | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}
