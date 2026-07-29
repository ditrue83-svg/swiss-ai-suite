// ============================================================================
// Test DETERMINISTICI del validation layer (§19/§20) e della persistenza.
//   npm run test:validate
//
// Nessuna rete, nessuna credenziale, nessun credito AI: si passano al validatore
// output di modello costruiti ad arte — inclusi quelli ostili — e si verifica
// che le regole di governance reggano. È il livello che decide TUTTO ciò che
// finisce in document_analyses, quindi va provato senza dipendere dall'umore
// del modello.
// ============================================================================
import {
  classifyProviderError, ERROR_MESSAGES, validateAndNormalize, type ExtractionResult,
} from '../supabase/functions/_shared/validate.ts';
import { buildAnalysisRow, reviewStatus } from '../supabase/functions/_shared/persist.ts';

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

const TEXT = `Ausgleichskasse des Kantons Zürich
Betreff: Lohndeklaration 2025 — fehlende Unterlagen

Wir bitten Sie, uns die Unterlagen bis spätestens 15.08.2026 einzureichen.
Der ausstehende Betrag von CHF 4'820.00 ist zu überweisen.
Zusätzlich wurde eine Ordnungsbusse von CHF 250.00 erhoben.
Bei Nichteinhaltung der Frist werden Verzugszinsen erhoben.`;

const EXTRACTION: ExtractionResult = {
  fullText: TEXT,
  pages: [{ pageNumber: 1, text: TEXT }],
  extractionMethod: 'text',
};

// Output "onesto" di base; ogni test ne sovrascrive solo la parte in esame.
const base = () => ({
  language: 'de',
  documentType: { value: 'request_for_documents', confidence: 0.9, evidence: { quote: 'fehlende Unterlagen', pageNumber: 1 } },
  sender: { name: 'Ausgleichskasse des Kantons Zürich', authorityType: 'social_insurance', confidence: 0.95, evidence: { quote: 'Ausgleichskasse des Kantons Zürich', pageNumber: 1 } },
  recipient: null, subject: 'Lohndeklaration 2025', documentDate: null, referenceNumbers: [],
  summaryShort: 'La cassa di compensazione chiede i documenti salariali mancanti.',
  deadline: { date: '2026-08-15', type: 'explicit', sourceText: 'bis spätestens 15.08.2026', confidence: 0.9, evidence: { quote: 'bis spätestens 15.08.2026 einzureichen', pageNumber: 1 } },
  amounts: [], actions: [], requestedActions: [], requestedDocuments: [], risks: [], legalReferences: [],
  replyNeeded: false, uncertainties: [], overallConfidence: 0.9,
});

const ctx = {
  documentId: 'doc', companyId: 'co', extractionId: 'ext', provider: 'anthropic',
  model: 'claude-opus-4-8', promptVersion: 'v', processingStartedAt: new Date(0).toISOString(),
  inputTokens: null, outputTokens: null,
};

// ===========================================================================
console.log('\nIl credito esaurito NON è «riprova più tardi»');
// ===========================================================================
// ⚠️ Il 2026-07-29 il credito del progetto si è esaurito e Admin AI ha
// risposto «Il servizio di analisi ha restituito un errore. Riprova più
// tardi.» — una frase che manda nella direzione sbagliata, perché aspettare
// non ricarica niente. Il messaggio qui sotto è quello VERO dell'API, copiato
// dalla risposta ottenuta quel giorno: un test scritto su un messaggio
// inventato proverebbe la fantasia di chi lo ha scritto.
{
  const REAL = 'Your credit balance is too low to access the Anthropic API. '
    + 'Please go to Plans & Billing to upgrade or purchase credits.';

  ok(classifyProviderError({ status: 400, message: REAL }) === 'AI_CREDIT_EXHAUSTED',
    'il messaggio REALE dell\'API viene riconosciuto');
  ok(classifyProviderError({ status: 429, message: 'rate limit' }) === 'RATE_LIMITED',
    'il limite di frequenza resta distinto: quello sì che passa aspettando');
  ok(classifyProviderError({ name: 'AbortError', message: 'aborted' }) === 'AI_TIMEOUT',
    'il tempo scaduto resta distinto');
  ok(classifyProviderError({ status: 500, message: 'internal' }) === 'PROVIDER_ERROR',
    'un guasto qualunque resta PROVIDER_ERROR');
  // ⚠️ Se un giorno il testo dell'API cambiasse, si ricade nel comportamento di
  // PRIMA — non in uno peggiore. È la ragione per cui il confronto è largo.
  ok(classifyProviderError({ status: 400, message: 'malformed request' }) === 'PROVIDER_ERROR',
    'una richiesta malformata NON viene scambiata per credito esaurito');
  ok(!ERROR_MESSAGES.AI_CREDIT_EXHAUSTED.toLowerCase().includes('riprova'),
    'il messaggio NON invita a riprovare: sarebbe un consiglio sbagliato');
}

console.log('\nTest del validation layer — regole di governance\n');

// ---------------------------------------------------------------------------
console.log('1) Scadenza (§11/§20)');
{
  const r = validateAndNormalize(base() as never, EXTRACTION);
  ok(r.deadline.date === '2026-08-15', 'citazione verificata → data mantenuta', r.deadline.date ?? 'null');
  ok(r.deadline.requiresVerification === false, 'e NON marcata da verificare');
}
{
  // Citazione inventata: la data non è più confermabile.
  const ai = base();
  ai.deadline.evidence = { quote: 'entro il 15 agosto (frase mai scritta)', pageNumber: 1 };
  const r = validateAndNormalize(ai as never, EXTRACTION);
  ok(r.deadline.requiresVerification === true, 'citazione NON verificata → marcata DA VERIFICARE');
  ok(r.uncertainties.some((u) => u.field === 'deadline' && u.severity === 'high'), 'e dichiarata come incertezza grave');
  ok(r.deadline.evidence === null || r.deadline.evidence.verified === false, 'la citazione falsa non viene spacciata per valida');
}
{
  const ai = base();
  ai.deadline = { date: null, type: 'relative', sourceText: 'entro 30 giorni', confidence: 0.6, evidence: { quote: '', pageNumber: null } } as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  ok(r.deadline.date === null, 'scadenza relativa → nessuna data assoluta inventata');
  ok(r.deadline.requiresVerification === true, 'e marcata da verificare');
}
{
  const ai = base();
  ai.deadline = { date: '2026-02-31', type: 'explicit', sourceText: null, confidence: 0.9, evidence: { quote: '', pageNumber: null } } as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  ok(r.deadline.date === null, 'data inesistente (31 febbraio) → azzerata');
}
{
  const ai = base();
  ai.deadline = { date: null, type: 'none', sourceText: null, confidence: 0, evidence: { quote: '', pageNumber: null } } as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  ok(r.deadline.date === null, 'nessuna scadenza → resta null (§59)');
}

// ---------------------------------------------------------------------------
console.log('\n2) Azioni: extracted vs suggested (§13)');
{
  const ai = base();
  ai.requestedActions = [
    { title: 'Inviare la lista salari', description: '', sourceType: 'extracted', required: true, deadlineReference: null, confidence: 0.9, evidence: { quote: 'Wir bitten Sie, uns die Unterlagen', pageNumber: 1 } },
    { title: 'Conservare copia', description: '', sourceType: 'extracted', required: false, deadlineReference: null, confidence: 0.5, evidence: { quote: 'frase totalmente inventata', pageNumber: 1 } },
  ] as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  ok(r.actions[0]?.sourceType === 'extracted', 'azione con citazione verificata resta "extracted"');
  ok(r.actions[1]?.sourceType === 'suggested', 'azione con citazione falsa DECLASSATA a "suggested"');
}

// ---------------------------------------------------------------------------
console.log('\n3) Rischi: espliciti prima degli inferiti, tutti salvati (§16)');
{
  const ai = base();
  ai.risks = [
    { text: 'Potrebbe esserci un aggravio futuro', sourceType: 'inferred', confidence: 0.4, evidence: { quote: '', pageNumber: null } },
    { text: 'Verranno riscossi interessi di mora', sourceType: 'explicit', confidence: 0.9, evidence: { quote: 'Verzugszinsen erhoben', pageNumber: 1 } },
  ] as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  const row = buildAnalysisRow(r, ctx);
  const risks = row.risks as { text: string; level: string }[];
  ok(Array.isArray(risks) && risks.length === 2, 'TUTTI i rischi vengono salvati, non solo il primo', `${risks.length}`);
  ok(risks[0]?.level === 'explicit', 'il rischio ESPLICITO viene messo davanti a quello inferito', risks[0]?.level);
}

// ---------------------------------------------------------------------------
console.log('\n4) Importi: il principale dichiara il proprio tipo (§12)');
{
  const ai = base();
  ai.amounts = [
    { amount: 250, currency: 'CHF', type: 'fine', description: 'Ordnungsbusse', confidence: 0.9, evidence: { quote: 'Ordnungsbusse von CHF 250.00', pageNumber: 1 } },
    { amount: 4820, currency: 'CHF', type: 'due', description: 'Beitrag', confidence: 0.95, evidence: { quote: "Betrag von CHF 4'820.00", pageNumber: 1 } },
  ] as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  const row = buildAnalysisRow(r, ctx);
  ok(row.amount === 4820, 'con più importi sceglie quello DOVUTO, non il primo', String(row.amount));
  ok(row.amount_type === 'due', 'e ne registra il tipo', String(row.amount_type));
  ok(r.amounts.length === 2, 'entrambi gli importi restano disponibili');
}
{
  const ai = base();
  ai.amounts = [{ amount: 250, currency: 'CHF', type: 'fine', description: 'Multa', confidence: 0.9, evidence: { quote: 'Ordnungsbusse von CHF 250.00', pageNumber: 1 } }] as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  const row = buildAnalysisRow(r, ctx);
  ok(row.amount_type === 'fine', 'senza importo dovuto, il ripiego NON è etichettato "da versare"', String(row.amount_type));
}
{
  const ai = base();
  const r = validateAndNormalize(ai as never, EXTRACTION);
  const row = buildAnalysisRow(r, ctx);
  ok(row.amount === null && row.amount_type === null, 'nessun importo nel documento → nessun importo inventato (§59)');
}

// ---------------------------------------------------------------------------
console.log('\n5) Mittente e incertezze (§7/§17)');
{
  const ai = base();
  ai.sender = { name: null, authorityType: 'unknown', confidence: 0.2, evidence: { quote: '', pageNumber: null } } as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  ok(r.sender.name === null, 'ente non identificabile → resta null, non inventato');
  ok(r.uncertainties.some((u) => u.field === 'sender'), 'e viene dichiarata un\'incertezza');
}
{
  const ai = base();
  ai.uncertainties = [{ field: 'x', description: 'dubbio grave', severity: 'high' }] as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  const row = buildAnalysisRow(r, ctx);
  const unc = row.uncertainties as { description: string; severity: string }[];
  ok(unc.every((u) => typeof u === 'object' && 'severity' in u), 'le incertezze conservano la GRAVITÀ, non solo il testo');
  ok(unc.some((u) => u.severity === 'high'), 'la gravità "high" sopravvive alla persistenza');
  ok(reviewStatus(r) === 'needs_review', 'un\'incertezza grave forza needs_review (§25)');
}

// ---------------------------------------------------------------------------
console.log('\n6) Valori fuori range e campi malformati (§19)');
{
  const ai = base();
  ai.overallConfidence = 5 as never;
  ai.documentType = { value: 'categoria_inventata', confidence: -3, evidence: { quote: '', pageNumber: null } } as never;
  ai.language = 'klingon' as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  ok(r.overallConfidence >= 0 && r.overallConfidence <= 1, 'confidence riportata nell\'intervallo 0..1', String(r.overallConfidence));
  ok(r.documentType.value === 'other', 'tipo documento non ammesso → "other"', r.documentType.value);
  ok(['it', 'de', 'fr'].includes(r.language), 'lingua non ammessa → valore di ripiego valido', r.language);
}
{
  const r = validateAndNormalize({} as never, EXTRACTION);
  ok(!!r && typeof r.summary === 'string', 'output completamente vuoto non fa esplodere il validatore');
  ok(r.deadline.date === null && r.amounts.length === 0, 'e non produce dati dal nulla');
}

console.log(`\n${pass} passati, ${fail} falliti\n`);
process.exit(fail ? 1 : 0);
