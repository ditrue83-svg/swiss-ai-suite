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
import { deadlineNatureDeclared, deadlineRequiresVerification } from '../supabase/functions/_shared/deadlineNature.ts';
import { looksLikeScan, MIN_CHARS_ABSOLUTE } from '../supabase/functions/_shared/extractionQuality.ts';
import { parseOcrResponse } from '../supabase/functions/_shared/extract.ts';
import { runAnalysisPipeline, type ModelMessage } from '../supabase/functions/_shared/pipeline.ts';
// ⚠️ I DUE WORKER VERI, non una loro imitazione: è l'unico modo perché questo
// test veda una guardia scollegata. Il client Supabase e il modello sono finti,
// quindi nessuna rete e nessun credito — ma il modello finto è una funzione VERA
// e non `null`, altrimenti «nessuna chiamata al modello» sarebbe verde per
// costruzione invece che per merito della guardia.
import { processFinanceItem } from '../supabase/functions/_shared/finance/process.ts';
import { processContractDocument } from '../supabase/functions/_shared/contracts/process.ts';
// Sezione 10: la provenienza di un dato — pagina, citazione, testo, lavoro appeso.
import { aiFact } from '../supabase/functions/_shared/automation/facts.ts';
import { evaluateCondition } from '../supabase/functions/_shared/automation/conditions.ts';
import { recoverStuckAnalyses } from '../supabase/functions/_shared/recoverStuckAnalyses.ts';

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

// Un'asserzione che SOLLEVA uccide la suite e nasconde tutto ciò che segue.
const prova = <T,>(f: () => T): T | null => { try { return f(); } catch { return null; } };

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
  // ⚠️ `dateKind` fa parte di un output ONESTO dal 2026-08-15: un modello che
  // non risponde a «che cosa è questa data?» lascia un'interpretazione che
  // nessuno ha verificato, e il validatore la marca da verificare. La sezione
  // sul sopralluogo prova apposta anche il caso in cui il campo manca.
  deadline: { date: '2026-08-15', type: 'explicit', dateKind: 'term', kindConfidence: 0.9, sourceText: 'bis spätestens 15.08.2026', confidence: 0.9, evidence: { quote: 'bis spätestens 15.08.2026 einzureichen', pageNumber: 1 } },
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
// ---------------------------------------------------------------------------
// ⚠️⚠️ CHI IMPONE LA DATA — il caso REALE del 2026-08-11.
// Un'email di Stripe sulle nuove tariffe di Radar ha prodotto «Scadenza
// 22.01.2027» nel cruscotto operativo. La data c'era, scritta a chiare lettere,
// e la citazione era verificabile: nessuna delle guardie esistenti poteva
// vederla, perché guardavano tutte la FORMA della data. Mancava la domanda su
// CHI fosse obbligato — e l'azienda, entro quel giorno, non doveva fare niente.
{
  const TESTO = 'Nuove tariffe di Radar a partire dal 22 gennaio 2027. '
    + 'Ti verrà addebitato CHF 0.05 per transazione.';
  const estrazione: ExtractionResult = {
    fullText: TESTO, pages: [{ pageNumber: 1, text: TESTO }], extractionMethod: 'text',
  };
  const listino = () => {
    const ai = base();
    ai.language = 'it' as never;
    ai.deadline = {
      date: '2027-01-22', type: 'explicit', obligesCompany: false,
      sourceText: 'a partire dal 22 gennaio 2027', confidence: 0.9,
      evidence: { quote: 'Nuove tariffe di Radar a partire dal 22 gennaio 2027', pageNumber: 1 },
    } as never;
    return ai;
  };

  const r = validateAndNormalize(listino() as never, estrazione);
  ok(r.deadline.date === null && r.deadline.type === 'none',
    'entrata in vigore di un listino di un fornitore: NON è una scadenza dell’azienda', String(r.deadline.date));

  // ⚠️ LA COPPIA. La stessa data, la stessa forma, la stessa citazione: cambia
  // solo CHI è obbligato. Se questa cadesse, la correzione starebbe cancellando
  // scadenze vere invece di distinguerle.
  const vera = listino();
  (vera.deadline as unknown as { obligesCompany: boolean }).obligesCompany = true;
  const rv = validateAndNormalize(vera as never, estrazione);
  ok(rv.deadline.date === '2027-01-22' && rv.deadline.type === 'explicit',
    'CONTROPROVA: identica in tutto, ma se obbliga l’azienda resta una scadenza', String(rv.deadline.date));

  // ⚠️ IL TERZO STATO: le analisi prodotte prima che il campo esistesse non
  // hanno `obligesCompany`. Il silenzio NON declassa, o una correzione di oggi
  // cancellerebbe le scadenze di ieri.
  const vecchia = listino();
  delete (vecchia.deadline as unknown as Record<string, unknown>).obligesCompany;
  const rvv = validateAndNormalize(vecchia as never, estrazione);
  ok(rvv.deadline.date === '2027-01-22',
    'campo assente (analisi anteriori al campo): la scadenza resta — il silenzio non è un «no»');
}
{
  const ai = base();
  ai.deadline = { date: null, type: 'none', sourceText: null, confidence: 0, evidence: { quote: '', pageNumber: null } } as never;
  const r = validateAndNormalize(ai as never, EXTRACTION);
  ok(r.deadline.date === null, 'nessuna scadenza → resta null (§59)');
}

// ---------------------------------------------------------------------------
// ⚠️⚠️ CHE COSA È QUELLA DATA — il caso REALE del 2026-08-15.
//
// «Comune di Lugano — Controllo tassa rifiuti» mostrava «Scadenza 10.09.2026 ·
// fra 26 giorni · affidabilità ALTA», e da quel campo erano nate TRE attività
// datate 10.09.2026. La citazione a supporto era esatta e verificabile: «Il
// sopralluogo è previsto per il 10.09.2026 presso la vostra sede».
//
// ⚠️ IL PUNTO DI QUESTA SEZIONE: le tre guardie esistenti erano tutte e tre
// VERDI su quel dato. `type` = explicit (la data è assoluta: vero).
// `obligesCompany` = true (da un sopralluogo l'azienda è coinvolta: vero).
// `evidence` verificata (la frase c'è: vero). Tre risposte giuste a tre domande
// che non erano quella. Il testo qui sotto è il documento vero, parola per
// parola, e l'output del modello è quello che il difetto produceva.
const SOPRALLUOGO = `Comune di Lugano — Cancelleria comunale
Piazza della Riforma 1, 6900 Lugano

Oggetto: Verifica della tassa rifiuti aziendale — sopralluogo

Spettabile Ditta,

vi informiamo che il nostro servizio effettuerà un controllo relativo alla tassa rifiuti per le attività economiche. Il sopralluogo è previsto per il 10.09.2026 presso la vostra sede.

Vi invitiamo a presentare in tale occasione il formulario allegato debitamente compilato e i giustificativi relativi allo smaltimento dei rifiuti speciali.

Distinti saluti
Cancelleria comunale di Lugano`;

{
  const estrazione: ExtractionResult = {
    fullText: SOPRALLUOGO, pages: [{ pageNumber: 1, text: SOPRALLUOGO }], extractionMethod: 'text',
  };
  // L'output com'era il 26 luglio, più il campo nuovo. `obligesCompany: true`
  // resta true ED È CORRETTO: l'azienda deve esserci. È il tipo di data a
  // cambiare tutto.
  const sopralluogo = (over: Record<string, unknown> = {}) => {
    const ai = base();
    ai.language = 'it' as never;
    ai.deadline = {
      date: '2026-09-10', type: 'explicit', obligesCompany: true, dateKind: 'event',
      kindConfidence: 0.9,
      sourceText: 'Il sopralluogo è previsto per il 10.09.2026', confidence: 0.9,
      evidence: { quote: 'Il sopralluogo è previsto per il 10.09.2026 presso la vostra sede', pageNumber: 1 },
      ...over,
    } as never;
    return ai;
  };

  const r = validateAndNormalize(sopralluogo() as never, estrazione);
  ok(r.deadline.date === null && r.deadline.type === 'none',
    'data di un sopralluogo: NON popola la scadenza', `${r.deadline.type} ${r.deadline.date}`);
  ok(r.appointment?.date === '2026-09-10',
    'ma non sparisce: diventa un APPUNTAMENTO', String(r.appointment?.date));
  ok(r.appointment?.evidence?.verified === true,
    'e si porta dietro la citazione che la prova');
  ok(r.deadline.evidence === null,
    'la citazione NON resta appesa a una scadenza che non c\'è');
  ok(r.uncertainties.some((u) => u.field === 'deadline' && /appuntamento/i.test(u.description)),
    'e si dichiara che il termine, se esiste, è anteriore e non è scritto');
  // ⚠️ `medium`, non `high`: una `high` manderebbe in revisione ogni avviso di
  // sopralluogo, e l'analisi qui NON è dubbia — ha riconosciuto bene.
  ok(reviewStatus(r) === 'completed',
    'riconoscere bene un appuntamento non manda l\'analisi in revisione');

  // ⚠️ LA COPPIA. Stesso documento, stessa data, stessa citazione, stesso
  // `obligesCompany`: cambia SOLO che cosa la data è. Se questa cadesse, la
  // correzione starebbe cancellando scadenze vere invece di distinguerle.
  const termine = validateAndNormalize(sopralluogo({ dateKind: 'term' }) as never, estrazione);
  ok(termine.deadline.date === '2026-09-10' && termine.deadline.type === 'explicit',
    'CONTROPROVA: identica in tutto, ma dichiarata «termine» resta una scadenza', String(termine.deadline.date));
  ok(termine.appointment === null, 'e allora non c\'è nessun appuntamento');

  // ⚠️ IL TERZO STATO — ed è QUI che si vede il difetto vero. Senza il campo
  // (cioè: come si comportava il prodotto fino al 2026-08-15) la data resta
  // una scadenza: buttarla cancellerebbe le scadenze vere di ogni analisi
  // vecchia. Ma non è più un FATTO: l'interpretazione non l'ha verificata
  // nessuno, e l'analisi lo dichiara.
  const muta = sopralluogo();
  delete (muta.deadline as unknown as Record<string, unknown>).dateKind;
  delete (muta.deadline as unknown as Record<string, unknown>).kindConfidence;
  const rm = validateAndNormalize(muta as never, estrazione);
  ok(rm.deadline.date === '2026-09-10',
    'natura non dichiarata: la data resta — il silenzio non cancella le scadenze di ieri');
  ok(rm.deadline.requiresVerification === true,
    'MA marcata DA VERIFICARE: un\'interpretazione che nessuno ha fatto non è un fatto');

  // Una data di riferimento amministrativo: né scadenza, né appuntamento.
  const rif = validateAndNormalize(sopralluogo({ dateKind: 'reference' }) as never, estrazione);
  ok(rif.deadline.date === null && rif.appointment === null,
    'data di riferimento (periodo, emissione, decorrenza): non è né l\'una né l\'altro');

  // ⚠️ FINO ALLA RIGA CHE SI SCRIVE. La colonna `deadline` è quella che
  // `documentTaskDraft` legge per la scadenza di un'attività, ed è da lì che
  // sono uscite le tre attività datate 10.09.2026: se il validatore distingue e
  // la persistenza no, il difetto è intatto un piano più sotto.
  const riga = buildAnalysisRow(r, ctx) as unknown as Record<string, unknown>;
  ok(riga.deadline === null,
    'la riga scritta nel database non ha alcuna scadenza', String(riga.deadline));
  ok(riga.appointment_date === '2026-09-10',
    'e porta la data nella colonna dell\'appuntamento', String(riga.appointment_date));
  ok(riga.deadline_kind === 'event',
    'con la natura dichiarata accanto, perché la lettura possa fidarsi', String(riga.deadline_kind));
  ok((riga.appointment_evidence as { quote?: string } | null)?.quote?.includes('sopralluogo') === true,
    'e la citazione dell\'appuntamento, verificata, per chi la vorrà rileggere');
  ok(riga.deadline_evidence === null,
    'e nessuna citazione di scadenza appesa a una scadenza inesistente');
}

// ---------------------------------------------------------------------------
// ⚠️⚠️ LA CONFIDENZA MISURAVA UNA COSA SOLA. «Affidabilità ALTA» su una
// data-evento non era un errore di calcolo: era la definizione a essere monca.
// `confidence` rispondeva a «ho letto bene la data?» — e 0.9 era onesto. Nessun
// numero rispondeva a «ho capito che cos'è?». Adesso sono due, e vince il più
// debole: un valore perfetto nel campo sbagliato resta un dato sbagliato.
{
  const incerta = base();
  incerta.deadline = {
    date: '2026-08-15', type: 'explicit', obligesCompany: true, dateKind: 'term',
    // Certo del valore, incerto della natura: la risposta onesta.
    confidence: 0.95, kindConfidence: 0.2,
    sourceText: 'bis spätestens 15.08.2026',
    evidence: { quote: 'bis spätestens 15.08.2026 einzureichen', pageNumber: 1 },
  } as never;
  incerta.overallConfidence = 0.9 as never;
  const r = validateAndNormalize(incerta as never, EXTRACTION);
  ok(Math.abs(r.deadline.confidence - 0.2) < 1e-9,
    'due certezze, vince la più debole: 0.95 sul valore e 0.2 sulla natura fanno 0.2', String(r.deadline.confidence));
  ok(Math.abs(r.overallConfidence - 0.2) < 1e-9,
    'e l\'analisi non si dichiara più sicura del dato da cui nascono le attività', String(r.overallConfidence));
  // ⚠️ LA COPPIA: senza una data, la scadenza non ha opinioni da imporre al resto.
  const senzaData = base();
  senzaData.deadline = { date: null, type: 'none', dateKind: 'none', confidence: 0.1, kindConfidence: 0.1, sourceText: null, evidence: { quote: '', pageNumber: 0 } } as never;
  senzaData.overallConfidence = 0.9 as never;
  const r2 = validateAndNormalize(senzaData as never, EXTRACTION);
  ok(Math.abs(r2.overallConfidence - 0.9) < 1e-9,
    'CONTROPROVA: senza scadenza il taglio non scatta', String(r2.overallConfidence));
}

// ---------------------------------------------------------------------------
// ⚠️⚠️ LA REGOLA IN LETTURA — la lezione pagata due volte. La domanda su CHI
// obbliga è del 2026-08-11, e il 15 agosto la riga di Stripe era ANCORA nel
// database con «Scadenza 22.01.2027»: il validatore gira quando si ANALIZZA, e
// nessuno rianalizza un documento archiviato. Una regola applicata solo in
// scrittura non protegge i dati già scritti.
{
  ok(deadlineRequiresVerification({ deadline: '2026-09-10', deadlineKind: null, storedFlag: false }) === true,
    'riga vecchia (natura mai dichiarata) → in lettura è DA VERIFICARE, senza riscriverla');
  ok(deadlineRequiresVerification({ deadline: '2026-09-10', deadlineKind: 'term', storedFlag: false }) === false,
    'riga nuova che ha risposto «termine» → resta un fatto');
  ok(deadlineRequiresVerification({ deadline: '2026-09-10', deadlineKind: 'term', storedFlag: true }) === true,
    'e il flag scritto dal validatore non viene mai perso per strada');
  ok(deadlineRequiresVerification({ deadline: null, deadlineKind: null, storedFlag: false }) === false,
    'senza data non c\'è niente da qualificare: la domanda non si pone');

  // ⚠️ La constatazione da sola, ESEGUITA e non solo esportata: è la domanda
  // «questa riga ha risposto?», e il resto della regola ci si appoggia.
  ok(deadlineNatureDeclared({ deadline: '2026-09-10', deadlineKind: 'event' }) === true,
    'una riga che ha risposto «evento» ha risposto');
  ok(deadlineNatureDeclared({ deadline: '2026-09-10', deadlineKind: null }) === false,
    'una riga muta non ha risposto');
  ok(deadlineNatureDeclared({ deadline: '2026-09-10', deadlineKind: 'termine' }) === false,
    'e una parola che non è fra le quattro previste non è una risposta');
  ok(deadlineNatureDeclared({ deadline: null, deadlineKind: null }) === true,
    'senza data la domanda non si pone, quindi non c\'è nulla da dichiarare');
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
  // ⚠️⚠️ QUESTA ASSERZIONE È CAMBIATA IL 2026-08-11, e prima era complice del
  // difetto: chiedeva solo che il ripiego fosse «uno dei tre», ed era `it`.
  // Siccome l'inglese non era nell'elenco, OGNI documento inglese cadeva lì:
  // 19 analisi su 19 in produzione dichiaravano «italiano» su testi inglesi.
  // Un ripiego che coincide con una risposta legittima è indistinguibile da
  // essa — la regola di casa, applicata a un enum.
  ok(r.language === 'other',
    'lingua non riconosciuta → «other», MAI una lingua vera: un ripiego non deve somigliare a una risposta', r.language);
}
{
  // ⚠️ LA COPPIA che tiene onesto il ripiego: l'inglese ora è rappresentabile,
  // quindi un documento inglese NON deve più finire in `other` né in `it`.
  const ai = base();
  ai.language = 'en' as never;
  ok(validateAndNormalize(ai as never, EXTRACTION).language === 'en',
    'un documento inglese si dichiara «en»: il rilevatore ha dove mettere la risposta giusta');

  const de = base();
  de.language = 'de' as never;
  ok(validateAndNormalize(de as never, EXTRACTION).language === 'de',
    'CONTROPROVA: le tre lingue del prodotto continuano a passare intatte');
}
{
  const r = validateAndNormalize({} as never, EXTRACTION);
  ok(!!r && typeof r.summary === 'string', 'output completamente vuoto non fa esplodere il validatore');
  ok(r.deadline.date === null && r.amounts.length === 0, 'e non produce dati dal nulla');
}

// ---------------------------------------------------------------------------
// 7) La forma dell'estrazione: una scansione non deve passare per «PDF letto»
//
// ⚠️ Questo blocco esiste per un caso vero, non per completezza. Il 2026-07-29
// un PDF di 455'452 byte su UNA pagina ha reso 44 caratteri ed è finito al
// modello come `native_pdf`: la guardia di allora era `length < 40`, e 44 la
// superava. L'analisi che ne è uscita aveva affidabilità 0.08 su una lettera
// raccomandata con una scadenza di due anni.
//
// La riga che conta è la PRIMA: se qualcuno un giorno rialza la soglia invece
// di guardare la densità, questo test lo ferma. La seconda è la controprova che
// la ricevuta cortissima e leggera NON viene bocciata — senza di quella si
// scambierebbe un difetto per un altro.
// ---------------------------------------------------------------------------
console.log('\n7) Forma dell\'estrazione: scansione o documento davvero letto (§4)');
{
  type Caso = { nome: string; chars: number; pages: number; bytes: number | null;
    metodo: 'native_pdf' | 'text' | 'ocr'; atteso: boolean };
  const casi: Caso[] = [
    // Il caso reale che ha originato tutto.
    { nome: 'il PDF del 2026-07-29 (scansione con testo residuo)',
      chars: 44, pages: 1, bytes: 455452, metodo: 'native_pdf', atteso: true },
    // ⚠️ La controprova: corta MA leggera → è un documento letto benissimo.
    { nome: 'ricevuta legittima di due righe, file leggero',
      chars: 80, pages: 1, bytes: 12288, metodo: 'native_pdf', atteso: false },
    { nome: 'pagina di testo vero',
      chars: 1800, pages: 1, bytes: 90000, metodo: 'native_pdf', atteso: false },
    { nome: 'PDF nativo con logo pesante ma testo sufficiente',
      chars: 300, pages: 1, bytes: 800000, metodo: 'native_pdf', atteso: false },
    { nome: 'scansione di 10 pagine',
      chars: 260, pages: 10, bytes: 3_500_000, metodo: 'native_pdf', atteso: true },
    // Metodi che non possono mentire sulla propria forma: mai bocciati.
    { nome: 'testo incollato cortissimo (pagine e byte non significano nulla)',
      chars: 44, pages: 1, bytes: 455452, metodo: 'text', atteso: false },
    { nome: 'OCR che ha reso poco (ha già fatto l\'unica cosa consigliabile)',
      chars: 44, pages: 1, bytes: 455452, metodo: 'ocr', atteso: false },
    // Senza la dimensione non si giudica: si lascia passare.
    { nome: 'dimensione del file ignota',
      chars: 44, pages: 1, bytes: null, metodo: 'native_pdf', atteso: false },
    { nome: 'dimensione del file a zero',
      chars: 44, pages: 1, bytes: 0, metodo: 'native_pdf', atteso: false },
  ];
  for (const c of casi) {
    const r = looksLikeScan({ chars: c.chars, pages: c.pages, bytes: c.bytes, extractionMethod: c.metodo });
    ok(r === c.atteso, c.nome,
      `${c.chars} car. / ${c.pages} pag. / ${c.bytes ?? 'ignoti'} byte → ${r ? 'OCR' : 'si fida'}`);
  }
  // Il pavimento assoluto resta quello di prima: se cambia, il testo incollato
  // e i .txt cambiano comportamento senza che nessuno se ne accorga.
  ok(MIN_CHARS_ABSOLUTE === 40, 'il pavimento assoluto è ancora 40 caratteri', String(MIN_CHARS_ABSOLUTE));
}

// ---------------------------------------------------------------------------
// Aiutanti condivisi dalle sezioni 8, 9 e 10.
//
// ⚠️ Un client Supabase finto che REGISTRA. Non simula il database: restituisce
// le righe che gli si danno e annota ogni scrittura, perché ciò che qui va
// dimostrato non è tanto che cosa viene salvato quanto che cosa NON viene
// chiamato — uno slot di quota, una riscrittura, un modello.
// ---------------------------------------------------------------------------
type Riga = Record<string, unknown>;
type Traccia = { tabella: string; azione: string; dati: Riga };

/**
 * Un client Supabase finto che REGISTRA. Non simula il database: restituisce
 * le righe che gli si danno e annota ogni scrittura, perché ciò che qui va
 * dimostrato non è che cosa viene salvato ma che cosa NON viene chiamato.
 */
function clientFinto(tabelle: Record<string, Riga[]>) {
  const tracce: Traccia[] = [];
  const from = (tabella: string) => {
    let esito: { data: unknown; error: null } = { data: tabelle[tabella] ?? [], error: null };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b, order: () => b, limit: () => b, lt: () => b, in: () => b,
      delete: () => {
        tracce.push({ tabella, azione: 'delete', dati: {} });
        esito = { data: null, error: null }; return b;
      },
      insert: (dati: Riga) => {
        tracce.push({ tabella, azione: 'insert', dati });
        esito = { data: [{ id: `${tabella}-1` }], error: null }; return b;
      },
      update: (dati: Riga) => {
        tracce.push({ tabella, azione: 'update', dati });
        esito = { data: null, error: null }; return b;
      },
      upsert: (dati: Riga) => {
        tracce.push({ tabella, azione: 'upsert', dati });
        esito = { data: [{ id: `${tabella}-1` }], error: null }; return b;
      },
      maybeSingle: () => Promise.resolve({ data: (esito.data as Riga[] | null)?.[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (esito.data as Riga[] | null)?.[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(esito).then(res, rej),
    };
    return b;
  };
  // ⚠️ La prenotazione dello slot passa da `rpc('try_consume_ai_quota_system')`.
  // Registrarla qui è ciò che rende verificabile «PRIMA di prenotare lo slot»:
  // senza, resterebbe un'affermazione nei commenti.
  const rpc = (nome: string) => {
    tracce.push({ tabella: `rpc:${nome}`, azione: 'rpc', dati: {} });
    // Uno slot CONCESSO, non negato: con `null` i due worker si fermerebbero
    // alla quota e il ramo del troncamento qui sotto non verrebbe mai raggiunto.
    return Promise.resolve({ data: 'slot-1', error: null });
  };
  return { sb: { from, rpc } as never, tracce };
}

/**
 * ⚠️ IL MODELLO FINTO ESISTE PER RENDERE VERE LE DUE ASSERZIONI SULLO SLOT.
 * Con `createMessage: null` i due worker non prenotano nulla in nessun caso, e
 * «nessuno slot AI prenotato» sarebbe rimasto verde anche a guardia spenta:
 * un test inerte, cioè il genere di verde che questo progetto ha già pagato
 * tre volte. Con una funzione VERA il percorso arriva davvero alla quota, e
 * l'asserzione dice qualcosa.
 */
function modelloFinto(stopReason = 'end_turn', testo = '{}') {
  const chiamate: number[] = [];
  const createMessage = () => {
    chiamate.push(1);
    return Promise.resolve({
      content: testo === null ? [] : [{ type: 'text', text: testo }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: stopReason,
    });
  };
  return { createMessage: createMessage as never, chiamate };
}

// La scansione vera del 2026-07-29: 44 caratteri su 455 KB, una pagina.
const SCANSIONE = {
  full_text: '2.5 2.0   7.5  3.5   4   8.0  5.5   5   15.0',
  pages: [{ pageNumber: 1, text: '2.5 2.0   7.5  3.5   4   8.0  5.5   5   15.0' }],
  extraction_method: 'native_pdf', ocr_confidence: null, truncated: false, page_count: 1,
};
const FILE_PESANTE = [{ file_size: 455452 }];
// La controprova: stesso testo cortissimo, ma file leggero → documento letto.
const FILE_LEGGERO = [{ file_size: 12288 }];


// ---------------------------------------------------------------------------
// 8) Perché il modello ha smesso di scrivere (§28)
//
// ⚠️ QUI SI ESEGUE `runAnalysisPipeline` DAVVERO, non una sua imitazione. Il
// client Supabase e il client AI sono finti, la funzione è quella che gira in
// produzione: è la stessa scelta del «cervello condiviso» in `_shared/`.
//
// Che cosa protegge. Un JSON tagliato a metà dal tetto di token diventava
// `AI_INVALID_OUTPUT` — «la risposta del modello non è in un formato valido»,
// cioè accusare il fornitore di un limite scelto da noi, e mandare chi legge a
// cercare il guasto dal lato sbagliato. La distinzione vive in un `if` di tre
// righe, ed è esattamente il genere di riga che una modifica al prompt o un
// aggiornamento dell'SDK spostano senza che nessuno se ne accorga.
//
// ⚠️ Il caso «troncato SENZA blocco di testo» è la CONTROPROVA dell'ordine: se
// qualcuno rimettesse il controllo del troncamento dopo quello del blocco
// testo, quel caso tornerebbe `AI_INVALID_OUTPUT` e questa riga diventerebbe
// rossa. Senza di lui il riordino passerebbe inosservato.
// ---------------------------------------------------------------------------
console.log('\n8) Perché il modello ha smesso di scrivere (§28)');
{
  // Il minimo indispensabile perché `saveExtraction` e l'aggiornamento di stato
  // arrivino in fondo: la pipeline si ferma prima di scrivere qualunque analisi.
  const sbFinto = {
    from: () => ({
      upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'ext-1' }, error: null }) }) }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    }),
  } as unknown as Parameters<typeof runAnalysisPipeline>[0];

  const risposta = (over: Partial<ModelMessage>): ModelMessage => ({
    content: [{ type: 'text', text: '{"language":"de"}' }],
    usage: { input_tokens: 10, output_tokens: 20 },
    stop_reason: 'end_turn',
    ...over,
  });

  async function codiceDi(msg: ModelMessage): Promise<string> {
    try {
      await runAnalysisPipeline(sbFinto, () => Promise.resolve(msg), {
        documentId: 'doc-1', companyId: 'comp-1', userId: null,
        extraction: EXTRACTION, extractionDurationMs: 1,
        companyContext: {
          legalName: 'Prova SA', canton: 'Ticino', municipality: 'Lugano',
          legalForm: 'SA', sector: 'costruzioni',
        },
        todayIso: '2026-07-29', provider: 'anthropic',
      });
      return 'NESSUN_ERRORE';
    } catch (e) {
      return (e as { code?: string }).code ?? 'SENZA_CODICE';
    }
  }

  const casi: { nome: string; msg: ModelMessage; atteso: string }[] = [
    { nome: 'troncato dal tetto di token → non si accusa il modello',
      msg: risposta({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"language":"d' }] }),
      atteso: 'AI_OUTPUT_TRUNCATED' },
    // ⚠️ Budget finito DENTRO il thinking: nessun blocco di testo da trovare.
    { nome: 'troncato senza alcun blocco di testo (l\'ordine dei controlli)',
      msg: risposta({ stop_reason: 'max_tokens', content: [] }),
      atteso: 'AI_OUTPUT_TRUNCATED' },
    { nome: 'rifiuto del modello → resta PROVIDER_ERROR',
      msg: risposta({ stop_reason: 'refusal' }),
      atteso: 'PROVIDER_ERROR' },
    // I due casi che NON devono cambiare comportamento: il ramo nuovo non deve
    // rubare nulla a quello vecchio.
    { nome: 'JSON malformato a fine turno → resta AI_INVALID_OUTPUT',
      msg: risposta({ content: [{ type: 'text', text: 'non sono JSON' }] }),
      atteso: 'AI_INVALID_OUTPUT' },
    { nome: 'nessun blocco di testo a fine turno → resta AI_INVALID_OUTPUT',
      msg: risposta({ content: [] }),
      atteso: 'AI_INVALID_OUTPUT' },
  ];

  for (const c of casi) {
    const code = await codiceDi(c.msg);
    ok(code === c.atteso, c.nome, code);
  }

  // ⚠️ Un codice senza messaggio è un riquadro d'errore VUOTO a schermo: la
  // registrazione in `ERROR_MESSAGES` è ciò che separa «errore dichiarato» da
  // «errore che non dice niente». Il typecheck garantisce la chiave, non che ci
  // sia scritto qualcosa.
  const msgTroncato = ERROR_MESSAGES.AI_OUTPUT_TRUNCATED ?? '';
  ok(msgTroncato.length > 20, 'il troncamento ha un messaggio, non una stringa vuota', String(msgTroncato.length));
  // Stessa regola del credito esaurito: aspettare non allarga un tetto.
  ok(!/riprova/i.test(msgTroncato), 'e NON invita a riprovare (riprovare dà lo stesso esito)');
}

// ---------------------------------------------------------------------------
// 9) La guardia §4 è COLLEGATA a Finanze e Contratti, non solo scritta
//
// ⚠️ PERCHÉ NON BASTA LA SEZIONE 7. Là si prova `looksLikeScan` da sola, cioè
// che la funzione sa riconoscere una scansione. Qui si prova la cosa diversa e
// più fragile: che i due worker gliela CHIEDANO davvero, e con i dati giusti.
//
// ⚠️⚠️ IL MODO IN CUI QUESTA GUARDIA SI SPEGNE È SILENZIOSO. `looksLikeScan` è
// conservativa per costruzione: senza `bytes` risponde `false` e lascia passare
// tutto. Basta quindi che qualcuno tolga `file_size` da una `select` — una
// modifica che sembra una pulizia — perché la guardia smetta di guardare senza
// che nulla fallisca, nessun tipo cambi e nessun errore compaia. È esattamente
// la forma di guasto che questo progetto ha già pagato con i permessi di
// colonna della 0013 e con i due controlli i18n che davano verde a vuoto.
//
// ⚠️ `test:finance` NON copre questo caso, e va detto invece di essere dedotto:
// il documento di prova di `test-finance.ts` è scritto con
// `extraction_method: 'text'` e senza `file_size`, quindi `looksLikeScan` esce
// `false` alla prima riga per DUE ragioni indipendenti. Quel test resta verde
// qualunque cosa succeda a questa guardia.
// ---------------------------------------------------------------------------
console.log('\n9) La guardia §4 è COLLEGATA a Finanze e Contratti (§4)');
{
  // ---- Finanze ------------------------------------------------------------
  {
    const { sb, tracce } = clientFinto({
      document_extractions: [SCANSIONE], documents: FILE_PESANTE,
    });
    const modello = modelloFinto();
    const esito = await processFinanceItem({ sb, createMessage: modello.createMessage }, {
      id: 'fin-1', company_id: 'comp-1', document_id: 'doc-1', type: 'supplier_invoice',
      processing_status: 'processing', extraction_attempts: 1, updated_at: '2026-07-29T00:00:00Z',
    } as never);

    ok(esito.outcome === 'failed' && esito.code === 'SCANNED_NO_TEXT',
      'Finanze: una scansione non diventa «non è una fattura»', JSON.stringify(esito));
    ok(!tracce.some((t) => t.azione === 'rpc') && modello.chiamate.length === 0,
      'Finanze: nessuno slot AI prenotato e nessuna chiamata — non si paga per del rumore');
    ok(tracce.some((t) => t.tabella === 'finance_items'
      && t.dati.processing_status === 'failed' && t.dati.error_code === 'SCANNED_NO_TEXT'),
      'Finanze: l\'esito è DEFINITIVO, quindi «Riprova estrazione» compare');
  }
  {
    const { sb, tracce } = clientFinto({ document_extractions: [SCANSIONE], documents: FILE_LEGGERO });
    const esito = await processFinanceItem({ sb, createMessage: modelloFinto().createMessage }, {
      id: 'fin-2', company_id: 'comp-1', document_id: 'doc-2', type: 'receipt',
      processing_status: 'processing', extraction_attempts: 1, updated_at: '2026-07-29T00:00:00Z',
    } as never);
    ok(esito.outcome !== 'failed' || esito.code !== 'SCANNED_NO_TEXT',
      'Finanze: la ricevuta corta e LEGGERA passa (è l\'AND che la salva)', JSON.stringify(esito));
    // ⚠️ La controprova della controprova: qui lo slot SI PRENOTA. Senza questa
    // riga «nessuno slot prenotato» del caso sopra non proverebbe che il
    // percorso ci sarebbe arrivato — proverebbe solo che non ci arriva mai.
    ok(tracce.some((t) => t.azione === 'rpc'),
      'Finanze: e su un documento legittimo lo slot si prenota davvero');
  }

  // ---- Contratti ----------------------------------------------------------
  {
    const { sb, tracce } = clientFinto({
      document_extractions: [SCANSIONE], documents: FILE_PESANTE, contract_extractions: [],
    });
    const modello = modelloFinto();
    const esito = await processContractDocument({ sb, createMessage: modello.createMessage } as never, {
      id: 'cd-1', contract_id: 'ct-1', company_id: 'comp-1', document_id: 'doc-1',
      relation: 'agreement', processing_status: 'processing', extraction_attempts: 1,
    } as never);

    ok(esito.kind === 'failed' && esito.code === 'SCANNED_NO_TEXT',
      'Contratti: una scansione non diventa «non è un contratto»', JSON.stringify(esito));
    ok(!tracce.some((t) => t.azione === 'rpc') && modello.chiamate.length === 0,
      'Contratti: nessuno slot AI prenotato e nessuna chiamata');
    // ⚠️ La differenza che conta: un verbale `failed` fa scrivere al trigger
    // `processing_status = 'failed'` e fa comparire «Riprova». `releaseDocument`
    // rimetterebbe `pending`, e dopo CONTRACT_MAX_ATTEMPTS il documento
    // resterebbe «In coda» per sempre, senza pulsante e senza spiegazione.
    ok(tracce.some((t) => t.tabella === 'contract_extractions' && t.azione === 'insert'
      && t.dati.status === 'failed' && t.dati.error_code === 'SCANNED_NO_TEXT'),
      'Contratti: si scrive un verbale, non si rimette in coda per sempre');
    ok(!tracce.some((t) => t.tabella === 'contract_documents'
      && t.dati.processing_status === 'pending'),
      'Contratti: NON si passa da releaseDocument');
  }
  {
    const { sb, tracce } = clientFinto({
      document_extractions: [SCANSIONE], documents: FILE_LEGGERO, contract_extractions: [],
    });
    const esito = await processContractDocument({ sb, createMessage: modelloFinto().createMessage } as never, {
      id: 'cd-2', contract_id: 'ct-1', company_id: 'comp-1', document_id: 'doc-2',
      relation: 'agreement', processing_status: 'processing', extraction_attempts: 1,
    } as never);
    ok(esito.kind !== 'failed' || esito.code !== 'SCANNED_NO_TEXT',
      'Contratti: il documento corto e LEGGERO passa la guardia', JSON.stringify(esito));
    ok(tracce.some((t) => t.azione === 'rpc'),
      'Contratti: e su un documento legittimo lo slot si prenota davvero');
  }

  // ---- Il troncamento, nei due worker -------------------------------------
  // ⚠️ La sezione 8 prova questo per Admin AI. Qui si prova che gli ALTRI DUE
  // moduli, che hanno ciascuno la propria copia del controllo, non ricadano
  // nella vecchia etichetta. Sono tre posti, ed è la ragione per cui questo
  // difetto va provato tre volte: la 0025 ha già ripetuto una trappola della
  // 0022 due migrazioni dopo, nella stessa identica forma.
  {
    const { sb } = clientFinto({ document_extractions: [SCANSIONE], documents: FILE_LEGGERO });
    const esito = await processFinanceItem(
      { sb, createMessage: modelloFinto('max_tokens', '{"supplier_na').createMessage },
      { id: 'fin-3', company_id: 'comp-1', document_id: 'doc-3', type: 'supplier_invoice',
        processing_status: 'processing', extraction_attempts: 1, updated_at: '2026-07-29T00:00:00Z' } as never,
    );
    ok(esito.outcome === 'failed' && esito.code === 'AI_OUTPUT_TRUNCATED',
      'Finanze: il troncamento non si traveste da AI_INVALID_OUTPUT', JSON.stringify(esito));
  }
  {
    const { sb } = clientFinto({
      document_extractions: [SCANSIONE], documents: FILE_LEGGERO, contract_extractions: [],
    });
    const esito = await processContractDocument(
      { sb, createMessage: modelloFinto('max_tokens', '{"counterpar').createMessage } as never,
      { id: 'cd-3', contract_id: 'ct-1', company_id: 'comp-1', document_id: 'doc-3',
        relation: 'agreement', processing_status: 'processing', extraction_attempts: 1 } as never,
    );
    ok(esito.kind === 'failed' && esito.code === 'AI_OUTPUT_TRUNCATED',
      'Contratti: il troncamento non si traveste da AI_REFUSED', JSON.stringify(esito));
  }
}

// ---------------------------------------------------------------------------
// 10) La provenienza di un dato: pagina, citazione, testo riletto, lavoro appeso
//
// Quattro difetti diversi con la stessa forma: il prodotto affermava qualcosa
// che non poteva sapere, e nessuno dei quattro produceva un errore.
// ---------------------------------------------------------------------------
console.log('\n10) Provenienza: pagina, citazione, testo riletto, lavoro appeso');
{
  // ---- (3) La pagina della citazione --------------------------------------
  // ⚠️ `DocViewer` sceglie la pagina da evidenziare leggendo `pageNumber`.
  // Senza, ripiega sulla PRIMA pagina che contiene quel testo: su un documento
  // di più pagine evidenzia la pagina sbagliata, e lo fa in silenzio.
  {
    const riga = buildAnalysisRow(validateAndNormalize(base() as never, EXTRACTION), ctx);
    const mitt = riga.sender_evidence as { pageNumber?: unknown } | null;
    const scad = riga.deadline_evidence as { pageNumber?: unknown } | null;
    ok(mitt?.pageNumber === 1, 'la citazione del mittente porta con sé la pagina', String(mitt?.pageNumber));
    ok(scad?.pageNumber === 1, 'e così quella della scadenza', String(scad?.pageNumber));
    // La controprova dell'asimmetria che si vedeva nella STESSA schermata:
    // `amounts` finisce nella riga intero, quindi la pagina è sempre arrivata.
    const a = (riga.amounts as { evidence?: { pageNumber?: unknown } }[])[0];
    ok(a === undefined || a.evidence === null || typeof a.evidence?.pageNumber !== 'undefined',
      'e gli importi, che passano da un\'altra strada, restano coerenti');
  }

  // ---- (5) L'importo che può far partire una regola ------------------------
  {
    const conCitazione = (quote: string | null, amount: number) => ({
      amount, currency: 'CHF', type: 'due', description: '', confidence: 0.9,
      evidence: quote === null ? null : { quote, pageNumber: 1 },
    });
    const ai = base();
    // Il primo ha fiducia più alta ma una citazione INVENTATA; il secondo una
    // citazione che si ritrova davvero nel testo.
    ai.amounts = [
      { ...conCitazione('mai scritto nel documento', 9999), confidence: 0.99 },
      conCitazione("Der ausstehende Betrag von CHF 4'820.00", 4820),
    ] as never;
    const riga = buildAnalysisRow(validateAndNormalize(ai as never, EXTRACTION), ctx);
    ok(riga.amount === 4820,
      'fra due importi vince quello con la citazione VERIFICATA, non la fiducia più alta',
      String(riga.amount));
  }
  {
    // Nessuna citazione verificata: l'importo resta scritto — buttarlo
    // cancellerebbe casi legittimi (§ prompt.ts:81) — ma non deve poter agire.
    const ai = base();
    ai.amounts = [{
      amount: 5000, currency: 'CHF', type: 'due', description: '', confidence: 0.9,
      evidence: { quote: 'frase mai scritta', pageNumber: 1 },
    }] as never;
    const riga = buildAnalysisRow(validateAndNormalize(ai as never, EXTRACTION), ctx);
    ok(riga.amount === 5000, 'un importo senza citazione verificata NON viene cancellato', String(riga.amount));
    ok(riga.amount_evidence === null, 'ma non porta con sé una citazione che non regge');

    // ⚠️ È QUI che si chiude: il fatto diventa incerto e la regola non parte.
    const fatto = aiFact({ value: 5000, currency: 'CHF', overallConfidence: 0.9, unverifiedQuote: true });
    ok(fatto.known === false && fatto.reason === 'unverified_quote',
      'il fatto è INCERTO, e per un motivo suo: non «fiducia bassa»', String(fatto.reason));

    const maggiore = evaluateCondition(
      { field: 'analysis.amount', operator: 'greater_than', value: 1000, currency: 'CHF' } as never,
      { 'analysis.amount': fatto },
    );
    ok(maggiore.outcome === 'unknown', '«più di 1000 CHF» non è né vero né falso: non si esegue', maggiore.outcome);

    // ⚠️ LA TRAPPOLA: `exists` calcola da `fact.known`, che per un fatto incerto
    // è `false`. Senza il motivo nell'elenco, «esiste un importo?» risponderebbe
    // NO su un documento che un importo ce l'ha — ribaltando le regole già scritte.
    const esiste = evaluateCondition(
      { field: 'analysis.amount', operator: 'exists' } as never,
      { 'analysis.amount': fatto },
    );
    ok(esiste.outcome === 'unknown', '«esiste un importo?» resta un ignoto, non diventa un «no»', esiste.outcome);

    // E la correzione a mano vince su tutto: la fonte è la persona.
    const corretto = aiFact({ value: 5000, corrected: true, unverifiedQuote: true });
    ok(corretto.known === true, 'un importo corretto a mano resta noto: la fonte è chi l\'ha scritto');
  }

  // ---- (4) Il testo riletto non si riscrive -------------------------------
  // ⚠️ `saveExtraction` scrive `ocr_confidence: null`: un upsert con valori
  // IDENTICI cancellerebbe comunque il punteggio di una trascrizione OCR.
  {
    const { sb, tracce } = clientFinto({});
    try {
      await runAnalysisPipeline(sb as never, () => Promise.resolve({
        content: [], usage: {}, stop_reason: 'max_tokens',
      }), {
        documentId: 'doc-1', companyId: 'comp-1', userId: null,
        extraction: EXTRACTION, extractionDurationMs: 1,
        companyContext: {
          legalName: 'Prova SA', canton: 'Ticino', municipality: 'Lugano',
          legalForm: 'SA', sector: 'costruzioni',
        },
        todayIso: '2026-07-29', provider: 'anthropic',
        reuseExtractionId: 'ext-esistente',
      });
    } catch { /* si ferma al troncamento: qui interessa solo che cosa ha scritto */ }
    ok(!tracce.some((t) => t.tabella === 'document_extractions'),
      'con un\'estrazione già salvata NON si riscrive la riga (né si azzera ocr_confidence)');
    ok(tracce.some((t) => t.tabella === 'documents' && t.dati.status === 'analyzing'),
      'ma il documento passa comunque in «analyzing»');
  }
  {
    // La controprova: senza l'id, la riga si scrive come sempre.
    const { sb, tracce } = clientFinto({});
    try {
      await runAnalysisPipeline(sb as never, () => Promise.resolve({
        content: [], usage: {}, stop_reason: 'max_tokens',
      }), {
        documentId: 'doc-2', companyId: 'comp-1', userId: null,
        extraction: EXTRACTION, extractionDurationMs: 1,
        companyContext: {
          legalName: 'Prova SA', canton: 'Ticino', municipality: 'Lugano',
          legalForm: 'SA', sector: 'costruzioni',
        },
        todayIso: '2026-07-29', provider: 'anthropic',
      });
    } catch { /* idem */ }
    ok(tracce.some((t) => t.tabella === 'document_extractions' && t.azione === 'upsert'),
      'e senza id l\'estrazione si salva come sempre');
  }

  // ---- (6) Il documento rimasto appeso ------------------------------------
  {
    const APPESO = [{ id: 'doc-1', company_id: 'comp-1' }];
    // Nessuna analisi: l'esecuzione è stata uccisa prima di produrre qualcosa.
    const { sb, tracce } = clientFinto({ documents: APPESO, document_analyses: [] });
    const r = await recoverStuckAnalyses(sb as never);

    ok(r.recovered === 1, 'un documento appeso da troppo tempo viene chiuso', JSON.stringify(r));
    ok(tracce.some((t) => t.tabella === 'documents' && t.dati.status === 'failed'),
      'documents.status diventa failed');
    // ⚠️⚠️ LA PARTE CHE NON SI PUÒ OMETTERE: `stateOf` decide da
    // `document_analyses.analysis_status`. Senza questa riga il documento
    // tornerebbe «non ancora analizzato» — un tentativo bruciato travestito da
    // lavoro mai cominciato.
    ok(tracce.some((t) => t.tabella === 'document_analyses' && t.azione === 'insert'
      && t.dati.analysis_status === 'failed' && t.dati.error_code === 'INTERRUPTED'),
      'e nasce la riga di analisi fallita, senza la quale stateOf direbbe «mai analizzato»');
  }
  {
    // ⚠️ La finestra fra «analisi scritta» e «stato aggiornato»: qui il lavoro
    // ERA finito. Scriverci sopra un fallimento cancellerebbe un risultato buono.
    const { sb, tracce } = clientFinto({
      documents: [{ id: 'doc-2', company_id: 'comp-1' }],
      document_analyses: [{ analysis_status: 'completed' }],
    });
    const r = await recoverStuckAnalyses(sb as never);
    ok(r.reconciled === 1 && r.recovered === 0,
      'se l\'analisi c\'era già, si allinea lo stato e non si inventa un fallimento', JSON.stringify(r));
    ok(!tracce.some((t) => t.tabella === 'document_analyses' && t.azione === 'insert'),
      'e non si tocca l\'analisi buona');
  }
}

// ---------------------------------------------------------------------------
console.log('\n11) La trascrizione OCR è output di un modello come gli altri');
// ---------------------------------------------------------------------------
// ⚠️ `parseOcrResponse` era l'unico percorso AI del prodotto SENZA alcun test e
// con la forma più esposta del difetto: `JSON.parse(raw.slice(raw.indexOf('{')))`
// — nessun recinto tolto, nessun bilanciamento, e con `indexOf` a -1 lo
// `slice(-1)` dava a `JSON.parse` l'ULTIMO CARATTERE della risposta. Un output
// assente diventava così un errore di sintassi su un carattere a caso.
{
  const rispostaOcr = (testo: string, stop = 'end_turn'): ModelMessage =>
    ({ content: [{ type: 'text', text: testo }], usage: {}, stop_reason: stop }) as ModelMessage;

  const pagine = '{"pages":[{"pageNumber":1,"text":"Rechnung Nr. 42"}],"fullText":"Rechnung Nr. 42"}';

  const nudo = prova(() => parseOcrResponse(rispostaOcr(pagine)));
  ok(nudo?.fullText === 'Rechnung Nr. 42' && nudo?.extractionMethod === 'ocr',
    'una trascrizione nuda si legge');

  const recintata = prova(() => parseOcrResponse(rispostaOcr('```json\n' + pagine + '\n```')));
  ok(recintata?.fullText === 'Rechnung Nr. 42',
    '⚠️ dentro un recinto markdown anche: prima i tre apici finali entravano in JSON.parse');

  const conCoda = prova(() => parseOcrResponse(rispostaOcr(pagine + '\n\nLa seconda pagina era illeggibile.')));
  ok(conCoda?.pages.length === 1 && conCoda?.fullText === 'Rechnung Nr. 42',
    '⚠️ e con una frase DOPO l\'oggetto: è il difetto che questo lavoro chiude');

  // Le graffe dentro il testo trascritto non chiudono l'oggetto: su un
  // documento vero capita (formule, codici, parentesi graffe stampate).
  const conGraffe = prova(() => parseOcrResponse(rispostaOcr('{"pages":[{"pageNumber":1,"text":"codice {A} riga"}],"fullText":"codice {A} riga"}')));
  ok(conGraffe?.fullText === 'codice {A} riga',
    'le graffe dentro il testo trascritto non interrompono l\'estrazione');

  let vuoto = false;
  try { parseOcrResponse(rispostaOcr('')); } catch { vuoto = true; }
  ok(vuoto, 'una risposta vuota è un guasto esplicito, non una trascrizione vuota plausibile');

  let troncata: string | null = null;
  try { parseOcrResponse(rispostaOcr('{"pages":[{"pageNumber":1,"text":"Rech', 'max_tokens')); }
  catch (e) { troncata = (e as Error & { code?: string }).code ?? null; }
  ok(troncata === 'AI_OUTPUT_TRUNCATED',
    '⚠️ e una trascrizione TAGLIATA dal tetto di token si dichiara tale: metà documento salvato come intero sarebbe la bugia peggiore di tutte');

  // ⚠️ CONTROPROVA sul controllo appena aggiunto: senza il ramo `max_tokens`
  // questa risposta cadrebbe nel parser e uscirebbe come «JSON incompleto» —
  // vero, e muto sulla causa. Il vecchio slice invece la accettava a metà? No:
  // esplodeva. La differenza sta nel CODICE, che ora nomina il colpevole.
  let senzaTetto: string | null = null;
  try { parseOcrResponse(rispostaOcr('{"pages":[{"pageNumber":1,"text":"Rech')); }
  catch (e) { senzaTetto = (e as Error & { code?: string }).code ?? null; }
  ok(senzaTetto !== 'AI_OUTPUT_TRUNCATED',
    'CONTROPROVA: lo stesso testo SENZA stop_reason non si dichiara troncato — il codice viene dal motivo, non dalla forma');
}

console.log(`\n${pass} passati, ${fail} falliti\n`);
process.exit(fail ? 1 : 0);
