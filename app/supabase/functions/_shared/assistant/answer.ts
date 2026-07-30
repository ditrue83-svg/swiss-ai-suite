// ============================================================================
// COMPANY ASSISTANT — validazione della risposta e ancoraggio ai dati
//
// Fra il modello e la persona che legge ci sono tre controlli, e sono
// deterministici tutti e tre: nessuno di essi chiede a un secondo modello se il
// primo ha fatto bene (§139). Un secondo modello costerebbe il doppio e
// sbaglierebbe in modo correlato al primo.
//
//   1. FORMA      — la risposta rispetta il contratto? (§137)
//   2. CITAZIONI  — ogni riferimento esiste, viene da uno strumento davvero
//                   invocato, e punta a una fonte che questa persona ha già
//                   potuto leggere? (§61)
//   3. ANCORAGGIO — ogni importo e ogni data scritti nel testo compaiono nei
//                   risultati degli strumenti o in un calcolo registrato dal
//                   server? (§138)
//
// ⚠️ Il terzo controllo è l'unico che guarda il TESTO, e serve per una ragione
// precisa: «tre fatture per CHF 4'820» e «tre fatture per CHF 4'280» sono
// entrambe frasi ben formate, entrambe citano le stesse righe, e nessuno schema
// le distingue. Solo il confronto con i numeri realmente letti le distingue.
//
// Modulo PORTABILE.
// ============================================================================

import {
  type AnswerStatus, type AssistantAnswer, type AssistantSourceReference,
  type PublicCitation, ANSWER_STATUSES, ASSISTANT_LIMITS, isRef, truncate,
} from './contract.ts';

// ---------------------------------------------------------------------------
// 1. FORMA
// ---------------------------------------------------------------------------

export interface AnswerValidation {
  ok: boolean;
  answer: AssistantAnswer | null;
  problems: string[];
}

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asStringArray = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim()).slice(0, max) : [];

/**
 * Normalizza l'ingresso di `submit_answer`.
 *
 * L'API valida già lo schema (`strict: true`), ma non tutto ciò che è valido è
 * accettabile: uno status «answered» senza alcuna citazione supera lo schema e
 * viola la regola che viene prima di tutte. Qui si CORREGGE dove è ovvio e si
 * RIFIUTA dove non lo è — mai si aggiusta il senso.
 */
export function validateAnswerShape(raw: unknown): AnswerValidation {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, answer: null, problems: ['la risposta non è un oggetto'] };
  }
  const o = raw as Record<string, unknown>;

  const statusRaw = asString(o.status);
  const status: AnswerStatus = (ANSWER_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as AnswerStatus)
    : 'partial';
  if (statusRaw && status !== statusRaw) problems.push(`status sconosciuto: ${statusRaw}`);

  const text = asString(o.text);
  if (!text) return { ok: false, answer: null, problems: [...problems, 'testo vuoto'] };

  const citedRefs = asStringArray(o.citedRefs, ASSISTANT_LIMITS.maxCitations).filter(isRef);
  const disambiguation = asStringArray(o.disambiguationRefs, 6).filter(isRef);
  const followUps = asStringArray(o.followUps, ASSISTANT_LIMITS.maxFollowUps)
    .map((f) => truncate(f, 120));
  const uncertainty = asString(o.uncertainty) || null;

  return {
    ok: true,
    answer: {
      status, text: truncate(text, 4000), citedRefs, uncertainty, followUps,
      disambiguation: disambiguation.map((ref) => ({ ref, label: '', hint: null })),
    },
    problems,
  };
}

// ---------------------------------------------------------------------------
// 2. CITAZIONI
//
// Il registro delle fonti è costruito SOLO dagli esecutori, e gli esecutori
// leggono con il client dell'utente. Ne segue, per costruzione, che una fonte
// presente nel registro appartiene all'azienda attiva ed è già stata letta con
// i permessi di questa persona: non serve una seconda interrogazione per
// verificarlo, e una seconda interrogazione non aggiungerebbe garanzie —
// aggiungerebbe latenza e un secondo punto in cui sbagliare.
//
// Ciò che invece VA verificato è che il modello non abbia nominato un
// riferimento che nessuno strumento ha prodotto. È l'unico modo in cui una
// citazione inventata può entrare, e qui viene fermata.
// ---------------------------------------------------------------------------

export interface CitationResolution {
  citations: PublicCitation[];
  /** Riferimenti nominati dal modello che non esistono: sono un difetto, e si contano. */
  invalidRefs: string[];
  /** Le fonti effettivamente citate, per l'ancoraggio e per la scrittura. */
  used: AssistantSourceReference[];
}

export function resolveCitations(
  refs: string[], registry: Map<string, AssistantSourceReference>,
): CitationResolution {
  const citations: PublicCitation[] = [];
  const invalidRefs: string[] = [];
  const used: AssistantSourceReference[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const src = registry.get(ref);
    if (!src) { invalidRefs.push(ref); continue; }
    // Difesa di cintura: una rotta che non è interna non deve poter uscire,
    // qualunque sia la strada per cui è arrivata fin qui (§106).
    if (!src.route.startsWith('/') || src.route.startsWith('//')) { invalidRefs.push(ref); continue; }
    used.push(src);
    citations.push({
      index: citations.length,
      sourceType: src.sourceType,
      sourceId: src.sourceId,
      groupSize: src.groupSize ?? null,
      route: src.route,
      title: src.title,
      subtitle: src.subtitle ?? null,
      pageNumber: src.pageNumber ?? null,
      fieldName: src.fieldName ?? null,
      citedText: src.citedText ?? null,
      verification: src.verification,
      valueSnapshot: src.valueSnapshot ?? null,
    });
    if (citations.length >= ASSISTANT_LIMITS.maxCitations) break;
  }
  return { citations, invalidRefs, used };
}

// ---------------------------------------------------------------------------
// 3. ANCORAGGIO
// ---------------------------------------------------------------------------

/**
 * L'insieme dei fatti: tutti i numeri e tutte le date che gli strumenti hanno
 * davvero restituito, più quelli che il SERVER ha calcolato e scritto nelle
 * note (i totali per valuta). Le note contano come fatti perché le scrive il
 * codice, non il modello: sono il «calcolo registrato» di §138.
 */
export interface FactSet {
  numbers: Set<string>;
  dates: Set<string>;
}

const DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const DATE_SWISS = /\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/g;

/**
 * Numeri all'europea e alla svizzera: 1'240.50 · 1.240,50 · 1 240.50 · 8200
 *
 * ⚠️ L'ORDINE DELLE ALTERNATIVE È LA SOSTANZA, e l'errore è già stato commesso:
 * con `(?:sep\d{3})*` — ripetizione FACOLTATIVA — la prima alternativa accettava
 * anche un numero senza separatori, e `\d{1,3}` ne mangiava solo le prime tre
 * cifre: «8200.00» diventava «820» seguito da «0.00», e un totale letto davvero
 * risultava non ancorato. La ripetizione è `+`: la forma con i separatori vale
 * solo se i separatori ci sono; tutto il resto passa dalla seconda alternativa.
 */
const NUMBER = /-?\d{1,3}(?:[’'’ .,]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g;

/**
 * ⚠️ LE DATE SI TOLGONO PRIMA DI CERCARE I NUMERI, ed è l'altro errore già
 * commesso: in «15.08.2026» la sequenza «15.08» ha esattamente la forma di un
 * importo, e finiva fra gli importi non ancorati di ogni risposta che nominasse
 * una scadenza in forma svizzera. Le date hanno già il loro controllo: qui
 * vanno rimosse, non contate due volte.
 */
function maskDates(text: string): string {
  return text.replace(DATE_ISO, (m) => ' '.repeat(m.length))
    .replace(DATE_SWISS, (m) => ' '.repeat(m.length));
}

const pad2 = (n: string) => (n.length === 1 ? `0${n}` : n);

/** Ogni data diventa `AAAA-MM-GG`: due scritture della stessa data sono lo stesso fatto. */
function normalizeDates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DATE_ISO)) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of text.matchAll(DATE_SWISS)) out.push(`${m[3]}-${pad2(m[2])}-${pad2(m[1])}`);
  return out;
}

/**
 * Ogni numero diventa una stringa canonica.
 *
 * ⚠️ La difficoltà è il separatore: «1.240» sono milleduecentoquaranta in
 * svizzero-tedesco e uno virgola due in inglese. La regola applicata è quella
 * che sbaglia dalla parte giusta: se dopo l'ultimo separatore ci sono
 * esattamente tre cifre E c'è più di un gruppo, è un separatore di migliaia.
 * Nel dubbio si producono ENTRAMBE le letture, perché un falso allarme
 * sull'ancoraggio è più costoso di una verifica in più.
 */
function numberVariants(raw: string): string[] {
  const s = raw.replace(/[’'’ ]/g, '');
  const variants = new Set<string>();
  const push = (v: number) => { if (Number.isFinite(v)) variants.add(v.toFixed(2)); };

  // Interpretazione 1: l'ultimo separatore è decimale.
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep >= 0) {
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
    const decPart = s.slice(lastSep + 1);
    if (/^\d+$/.test(decPart)) push(Number(`${intPart || '0'}.${decPart}`));
    // Interpretazione 2: TUTTI i separatori sono di migliaia.
    push(Number(s.replace(/[.,]/g, '')));
  } else {
    push(Number(s));
  }
  return [...variants];
}

function collectFrom(value: unknown, facts: FactSet, depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) facts.numbers.add(value.toFixed(2));
    return;
  }
  if (typeof value === 'string') {
    for (const d of normalizeDates(value)) facts.dates.add(d);
    for (const m of maskDates(value).matchAll(NUMBER)) {
      for (const v of numberVariants(m[0])) facts.numbers.add(v);
    }
    return;
  }
  if (Array.isArray(value)) { for (const v of value) collectFrom(v, facts, depth + 1); return; }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectFrom(v, facts, depth + 1);
  }
}

export function buildFactSet(
  results: { rows: Record<string, unknown>[]; note?: string; totalCount?: number | null }[],
): FactSet {
  const facts: FactSet = { numbers: new Set(), dates: new Set() };
  for (const r of results) {
    collectFrom(r.rows, facts);
    if (r.note) collectFrom(r.note, facts);
    if (typeof r.totalCount === 'number') facts.numbers.add(r.totalCount.toFixed(2));
  }
  return facts;
}

export interface GroundingReport {
  unsupportedAmounts: string[];
  unsupportedDates: string[];
  ok: boolean;
}

/**
 * Che cosa NON si controlla, e perché.
 *
 * I numeri piccoli senza separatori (0-31) sono quasi sempre conteggi, ordinali
 * o giorni («due sono scadute», «i prossimi 7 giorni»), e segnalarli
 * produrrebbe un allarme continuo che nessuno leggerebbe più. Gli anni a
 * quattro cifre dentro una data sono già coperti dal controllo sulle date.
 * Il controllo mira a ciò che fa danno: gli IMPORTI e le SCADENZE.
 */
export function checkGrounding(text: string, facts: FactSet): GroundingReport {
  const unsupportedDates: string[] = [];
  for (const d of new Set(normalizeDates(text))) {
    if (!facts.dates.has(d)) unsupportedDates.push(d);
  }

  const unsupportedAmounts: string[] = [];
  // Un importo è un numero con separatore decimale o con separatore di
  // migliaia: è la forma in cui il denaro si scrive, e distingue «4'820» da
  // «due attività».
  const amountLike = maskDates(text)
    .match(/-?\d{1,3}(?:[’'’ .,]\d{3})+(?:[.,]\d+)?|-?\d+[.,]\d{2}\b/g) ?? [];
  for (const raw of new Set(amountLike)) {
    const variants = numberVariants(raw);
    if (!variants.some((v) => facts.numbers.has(v))) unsupportedAmounts.push(raw);
  }

  return {
    unsupportedAmounts,
    unsupportedDates,
    ok: unsupportedAmounts.length === 0 && unsupportedDates.length === 0,
  };
}

// ---------------------------------------------------------------------------
// La composizione finale
// ---------------------------------------------------------------------------

export interface FinalizeInput {
  answer: AssistantAnswer;
  registry: Map<string, AssistantSourceReference>;
  results: { rows: Record<string, unknown>[]; note?: string; totalCount?: number | null }[];
  /** Strumenti che hanno fallito: entrano nella risposta come limite dichiarato (§144). */
  degraded: string[];
  /** Se true, l'ancoraggio è obbligatorio (denaro o scadenze in gioco). */
  highRisk: boolean;
}

export interface FinalizeOutput {
  status: AnswerStatus;
  text: string;
  uncertainty: string | null;
  followUps: string[];
  citations: PublicCitation[];
  /**
   * Le fonti citate, NELLO STESSO ORDINE delle citazioni.
   *
   * ⚠️ Torna da qui e non si ricostruisce a valle: ritrovare la fonte di una
   * citazione confrontando rotta e titolo funziona finché due fonti non hanno
   * la stessa rotta — che è esattamente il caso di due citazioni testuali sullo
   * stesso documento, dove la rotta è identica e cambia solo il campo.
   */
  citedSources: AssistantSourceReference[];
  disambiguation: { label: string; hint: string | null; route: string }[];
  degraded: string[];
  /** Diagnostica per `assistant_runs`: non si mostra all'utente. */
  diagnostics: { invalidRefs: string[]; grounding: GroundingReport | null };
}

export function finalizeAnswer(input: FinalizeInput): FinalizeOutput {
  const { answer, registry, results, degraded, highRisk } = input;
  const { citations, invalidRefs, used } = resolveCitations(answer.citedRefs, registry);

  let status = answer.status;
  const uncertaintyParts: string[] = [];
  if (answer.uncertainty) uncertaintyParts.push(answer.uncertainty);

  // §56 — un'affermazione sui dati aziendali senza fonte non è una risposta.
  // Non si cancella il testo: si declassa l'esito, così l'interfaccia lo mostra
  // per quello che è e la metrica di §147 lo conta.
  if (status === 'answered' && citations.length === 0) status = 'insufficient_evidence';

  // §25 — se ANCHE UNA SOLA fonte citata è una proposta non confermata, la
  // risposta lo deve dire. Non basta che il modello se lo ricordi.
  const unverified = used.filter((s) => s.verification === 'ai_unverified');
  if (unverified.length && !answer.uncertainty) {
    uncertaintyParts.push(
      unverified.length === 1
        ? `Un dato usato in questa risposta («${unverified[0].title}») non è ancora stato verificato da una persona.`
        : `${unverified.length} dati usati in questa risposta non sono ancora stati verificati da una persona.`,
    );
  }

  // §138 — l'ancoraggio.
  let grounding: GroundingReport | null = null;
  if (highRisk && status !== 'out_of_scope') {
    grounding = checkGrounding(answer.text, buildFactSet(results));
    if (!grounding.ok) {
      if (status === 'answered') status = 'partial';
      const bits: string[] = [];
      if (grounding.unsupportedAmounts.length) bits.push(`importi (${grounding.unsupportedAmounts.join(', ')})`);
      if (grounding.unsupportedDates.length) bits.push(`date (${grounding.unsupportedDates.join(', ')})`);
      uncertaintyParts.push(
        `Alcuni valori citati non corrispondono a quanto letto dai dati — ${bits.join(' e ')}: ` +
        'verificali aprendo le fonti prima di usarli.',
      );
    }
  }

  if (degraded.length && status === 'answered') status = 'partial';

  const disambiguation = (answer.disambiguation ?? [])
    .map((d) => registry.get(d.ref))
    .filter((s): s is AssistantSourceReference => !!s)
    .map((s) => ({ label: s.title, hint: s.subtitle ?? null, route: s.route }));

  if (status === 'needs_disambiguation' && !disambiguation.length) {
    // Chiedere di scegliere senza offrire fra che cosa non è una domanda: è un
    // vicolo cieco. Meglio dichiarare che non basta.
    status = 'insufficient_evidence';
  }

  return {
    status,
    text: answer.text,
    uncertainty: uncertaintyParts.length ? uncertaintyParts.join(' ') : null,
    followUps: answer.followUps ?? [],
    citations,
    citedSources: used,
    disambiguation,
    degraded,
    diagnostics: { invalidRefs, grounding },
  };
}

/** Gli strumenti dopo i quali una risposta sbagliata costa denaro o una scadenza. */
const HIGH_RISK_TOOLS = new Set([
  'list_finance_items', 'get_finance_item_details', 'get_finance_summary', 'get_finance_duplicates',
  'list_contracts', 'get_contract_details', 'list_contract_milestones',
  'list_tasks_by_due_date',
]);

export const isHighRisk = (toolKeys: string[]): boolean => toolKeys.some((k) => HIGH_RISK_TOOLS.has(k));
