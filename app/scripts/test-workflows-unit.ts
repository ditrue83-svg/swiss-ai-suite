// ============================================================================
// AI-Swisse — Automazioni: test DETERMINISTICI, offline.
//   npm run test:workflows-unit
//
// Nessuna rete, nessuna credenziale, nessun credito AI. Coprono le decisioni
// che si possono sbagliare in silenzio e che nessun test sul database
// coglierebbe, perché non riguardano il database:
//
//   1. IL REGISTRO — è il confine fra dati e codice: se un innesco dichiara un
//      campo che nessuno costruisce, o un'azione che nessuno esegue, la regola
//      si può comporre e non funzionerà mai;
//   2. LA VALIDAZIONE — campo inventato, azione inventata, segnaposto
//      inventato: devono essere RIFIUTATI, e i casi buoni devono passare;
//   3. GLI OPERATORI, uno per uno, su tutti i tipi;
//   4. LA LOGICA A TRE VALORI (§26): vero, falso e NON DETERMINABILE;
//   5. LE VALUTE (§27): CHF 5'000 non è EUR 5'000, e la risposta non è «no»;
//   6. L'INCERTEZZA (§25) e le CORREZIONI UMANE (§24);
//   7. I MODELLI DI TESTO (§31): un segnaposto senza valore non produce
//      «Verifica undefined»;
//   8. LA FRASE RIASSUNTIVA (§160), che una persona legge prima di attivare;
//   9. L'URGENZA: la copia del motore locale deve coincidere con l'originale;
//  10. I MODELLI INIZIALI (§75–§81): devono essere tutti attivabili;
//  11. LE COSTANTI e i codici, che UI e server dichiarano insieme.
//
// ⚠️ OGNI SEZIONE CONTIENE ALMENO UNA CONTROPROVA — un caso che DEVE fallire.
// Due versioni del controllo i18n e due del controllo sulle migrazioni sono
// passate per verdi senza guardare niente: da allora, su questo progetto, un
// controllo che non è stato messo alla prova non vale.
// ============================================================================
import {
  AUTOMATION_ERROR_CODES, AUTOMATION_LIMITS, AUTO_PAUSE_AFTER_FAILURES,
  EDGE_TIME_BUDGET_MS, MAX_ACTIONS, MAX_CHAIN_DEPTH, MAX_CONDITIONS,
  MAX_EVENT_ATTEMPTS, MIN_ANALYSIS_CONFIDENCE, OVERDUE_LOOKBACK_DAYS,
  eventBackoffSeconds,
} from '../supabase/functions/_shared/automation/contract.ts';
import {
  ACTIONS, AUTOMATION_EVENT_TYPES, OPERATORS_BY_TYPE, TRIGGERS, actionsForTrigger, findAction,
  findTrigger, isAutoExecutable,
  type AutomationEventType, type WorkflowAction, type WorkflowCondition,
} from '../supabase/functions/_shared/automation/registry.ts';
import { validateWorkflow } from '../supabase/functions/_shared/automation/validate.ts';
import {
  daysUntilDate, evaluateCondition, evaluateConditions,
} from '../supabase/functions/_shared/automation/conditions.ts';
import {
  aiFact, emailDomain, known, missing, optional, uncertain, urgencyFrom,
  type Facts,
} from '../supabase/functions/_shared/automation/facts.ts';
import {
  formatAmount, formatDate, placeholdersIn, renderRequired, renderTemplate,
} from '../supabase/functions/_shared/automation/templates.ts';
import { planAction, type ActionContext } from '../supabase/functions/_shared/automation/executors.ts';
// ⚠️ `loadFacts` importata per NOME e per essere ESEGUITA (sezione 14). Prima
// era raggiunta solo di rimbalzo, attraverso `engine.ts` importata da
// `test:workflows` — cioè sul database vero e sul solo cammino felice: nessun
// test le ha mai iniettato un guasto, che è esattamente ciò che era rotto.
import {
  eventDeadLetter, eventDone, eventFailed, eventRetry, loadFacts, recordWorkflowFailure,
  type ClaimedEvent,
} from '../supabase/functions/_shared/automation/store.ts';
// ⚠️ L'ORIGINALE dell'urgenza: la copia portabile del motore deve coincidere
// con questa, e la sezione 9 lo verifica su una matrice. Vedi il commento in
// cima a `urgencyFrom`.
import { urgencyFromType } from '../src/features/admin-ai/engine';
// ⚠️ `daysUntilMs` del server e `daysUntil` del motore locale non esistono più:
// erano due copie della stessa aritmetica SBAGLIATA, tenute allineate a
// vicenda. Ora entrambi i lati chiamano questa (2026-08-24).
import { calendarDaysUntil } from '../src/lib/calendarDays.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
import {
  AUTOMATION_TEMPLATES, describeCondition, isLegacyTrigger, summarySentence,
  triggersOffered, type NameResolver,
} from '../src/features/automations/automationModel';
import { it } from '../src/i18n/locales/it';
import type { TFunction, TKey } from '../src/i18n';

let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${label}`); }
  else { fail++; console.log(`  ${R}✗ ${label}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

/** Una `t()` finta che legge il dizionario italiano vero. */
const lookup = (key: string): string | undefined => {
  let node: unknown = it;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else return undefined;
  }
  return typeof node === 'string' ? node : undefined;
};
const t = ((key: TKey, vars?: Record<string, string | number>) => {
  const raw = lookup(key) ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m)) : raw;
}) as TFunction;

const names: NameResolver = { member: () => 'Andrea', tag: () => 'Da verificare' };
const UUID_A = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-01T10:00:00Z');

console.log(`${B}AI-Swisse — Automazioni: regole, offline${X}`);

// ===========================================================================
section('1 · Il registro: nessun innesco e nessuna azione dichiarati a vuoto');
// ===========================================================================
{
  // ⚠️ NON SI FISSA PIÙ IL NUMERO. La versione precedente pretendeva «sei
  // inneschi», e con i due di Finanze (0021) è diventata rossa senza che nulla
  // fosse rotto: un test che conta invece di verificare una proprietà va
  // aggiornato a ogni aggiunta legittima, e chi lo aggiorna finisce per
  // cambiare il numero senza guardare che cosa è stato aggiunto.
  // Quello che conta davvero è che ogni innesco DICHIARATO esista anche
  // nell'enum che il database accetta: un innesco offerto nel menu e ignoto al
  // database si può comporre e non scatterà mai.
  ok(TRIGGERS.length === AUTOMATION_EVENT_TYPES.length,
    'ogni tipo di evento del database ha il suo innesco nel registro, e viceversa',
    `registro ${TRIGGERS.length}, enum ${AUTOMATION_EVENT_TYPES.length}`);
  ok(TRIGGERS.every((t) => (AUTOMATION_EVENT_TYPES as readonly string[]).includes(t.key)),
    'nessun innesco nomina un evento che il database non conosce');

  // ⚠️⚠️ IL CONTROLLO CHE MANCAVA, e la sua assenza è costata sette inneschi.
  //    I due elenchi confrontati sopra vivono NELLO STESSO FILE TypeScript:
  //    coincidono per costruzione, e il commento che parla dell'«enum che il
  //    database accetta» non era vero. Il 2026-07-30 l'SQL dichiarava sette
  //    inneschi storici (0032) che il registro non conosceva: la
  //    schermata non li offriva, e nessun test se n'era accorto. Ora si legge
  //    l'SQL.
  const MIGRAZIONI = readdirSync(join(HERE, '..', 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(HERE, '..', 'supabase', 'migrations', f), 'utf8')).join('\n');
  const sqlEventi = new Set<string>();
  const creazioni = [...MIGRAZIONI.matchAll(/create type public\.automation_event_type as enum \(([\s\S]*?)\)/gi)];
  const creato = creazioni.at(-1);
  if (creato) {
    for (const m of creato[1].replace(/--[^\n]*/g, '').matchAll(/'([^']+)'/g)) sqlEventi.add(m[1]);
  }
  const dopoCreazione = creato ? MIGRAZIONI.slice(creato.index! + creato[0].length) : MIGRAZIONI;
  for (const m of dopoCreazione.matchAll(
    /alter type public\.automation_event_type add value if not exists '([^']+)'/gi)) {
    sqlEventi.add(m[1]);
  }
  ok(sqlEventi.size === AUTOMATION_EVENT_TYPES.length,
    'il registro dichiara ESATTAMENTE gli inneschi che l\u2019SQL ammette',
    `SQL ${sqlEventi.size}, registro ${AUTOMATION_EVENT_TYPES.length}`);
  const soloSql = [...sqlEventi].filter((e) => !(AUTOMATION_EVENT_TYPES as readonly string[]).includes(e));
  ok(soloSql.length === 0,
    'nessun innesco esiste nel database e manca dal registro: sarebbe un evento che nessuna regola pu\u00f2 usare',
    soloSql.join(', '));

  // ⚠️⚠️ E OGNI ENTITÀ DI UN INNESCO DEVE AVERE UN CARICATORE DI FATTI.
  //    Senza, la regola si compone dall'interfaccia, l'evento arriva, `loadFacts`
  //    torna `null` e l'evento viene scartato IN SILENZIO: una regola che
  //    sembra attiva e non fa niente. È la stessa bugia di un innesco senza
  //    produttore, vista dall'altro lato.
  const STORE = readFileSync(
    join(HERE, '..', 'supabase', 'functions', '_shared', 'automation', 'store.ts'), 'utf8');
  const entitaSenzaFatti = [...new Set(TRIGGERS.map((t) => t.entityType))]
    .filter((e) => !STORE.includes(`event.entity_type === '${e}'`));
  ok(entitaSenzaFatti.length === 0,
    'ogni entit\u00e0 nominata da un innesco ha un caricatore di fatti in store.ts',
    entitaSenzaFatti.join(', '));

  ok(ACTIONS.length === 6, 'sei azioni dichiarate', String(ACTIONS.length));

  let allFieldsSane = true, allOperatorsSane = true;
  for (const trigger of TRIGGERS) {
    if (!trigger.fields.length) allFieldsSane = false;
    const paths = new Set<string>();
    for (const f of trigger.fields) {
      if (paths.has(f.path)) allFieldsSane = false;      // due volte lo stesso campo
      paths.add(f.path);
      if (!f.labelKey || !lookup(f.labelKey)) allFieldsSane = false;   // etichetta mancante
      if (f.type === 'enum' && !f.options?.length) allFieldsSane = false;
      if (!OPERATORS_BY_TYPE[f.type]?.length) allOperatorsSane = false;
    }
  }
  ok(allFieldsSane, 'ogni campo ha un percorso unico e un’etichetta che esiste nei dizionari');
  ok(allOperatorsSane, 'ogni tipo di campo ha almeno un operatore');

  // ⚠️ Un'azione offerta su un innesco su cui non può funzionare è una regola
  // che si compone e non parte mai.
  const taskTrigger = findTrigger('document_analysis_completed')!;
  ok(!actionsForTrigger(taskTrigger).some((a) => a.key === 'assign_task'),
    '«assegna attività» NON è offerta su un innesco documentale');
  ok(actionsForTrigger(findTrigger('task_created')!).some((a) => a.key === 'assign_task'),
    '«assegna attività» è offerta su un innesco di attività');

  // ⚠️⚠️ OGNI INNESCO DEVE AVERE ALMENO UN'AZIONE OFFERIBILE, e questo controllo
  //    nasce da un difetto vissuto: alcuni inneschi storici si
  //    sceglievano dal menu, le condizioni si componevano, e la sezione
  //    «Allora» restava VUOTA — nessuna azione dichiarava le due entità nuove.
  //    Si arrivava fino in fondo per leggere «aggiungi almeno un'azione» senza
  //    poterne aggiungere una. Un innesco senza azioni è un vicolo cieco che
  //    l'interfaccia percorre tutto prima di dirlo.
  const senzaAzioni = TRIGGERS.filter((t) => actionsForTrigger(t).length === 0).map((t) => t.key);
  ok(senzaAzioni.length === 0,
    'ogni innesco ha almeno un\u2019azione che si pu\u00f2 scegliere',
    senzaAzioni.join(', '));

  // ⚠️ E «avvisa il responsabile» si offre SOLO dove un responsabile esiste
  //    davvero: `triggerHasOwner` deve coincidere con ciò che `store.ts`
  //    riempie in `assigneeUserId`. Un'opportunità non ha nessuno che l'abbia
  //    presa in carico — è ciò che la distingue da una pratica — e offrirlo
  //    farebbe comporre una regola che non avvisa mai nessuno.
  ok(ACTIONS.every(isAutoExecutable), 'tutte le azioni della versione 1 sono a basso rischio (§19)');
  ok(ACTIONS.every((a) => lookup(a.labelKey) !== undefined),
    'ogni azione ha un’etichetta che esiste nei dizionari');

  // CONTROPROVA: un innesco inesistente non si trova, e non si inventa.
  ok(findTrigger('invoice_received') === null,
    'un innesco NON implementato non risulta dichiarato (niente inneschi finti)');
  ok(findAction('send_email') === null && findAction('pay_invoice') === null,
    'le azioni vietate non esistono nel registro (§18)');
}

// ===========================================================================
section('2 · Validazione: ciò che è inventato viene RIFIUTATO (§150)');
// ===========================================================================
{
  const base = {
    name: 'Prova',
    triggerType: 'document_analysis_completed' as const,
    conditionMatch: 'all' as const,
    conditions: [{ field: 'document.category', operator: 'equals', value: 'taxes' }] as WorkflowCondition[],
    actions: [{
      key: 'create_task', config: { titleTemplate: 'Verifica {{document.title}}', priority: 'high', dueDate: 'none' },
    }] as WorkflowAction[],
  };

  // Il caso BUONO deve passare: senza questo, «rifiuta tutto» sembrerebbe un
  // validatore che funziona.
  ok(validateWorkflow(base, { forActivation: true }).length === 0,
    'una regola valida NON produce problemi (controprova positiva)',
    JSON.stringify(validateWorkflow(base, { forActivation: true })));

  const badField = validateWorkflow({ ...base, conditions: [{ field: 'analysis.segreto', operator: 'equals', value: 'x' }] }, { forActivation: true });
  ok(badField.some((i) => i.key === 'unknownField'), 'campo non registrato → rifiutato (§23)');

  const badOp = validateWorkflow({ ...base, conditions: [{ field: 'document.title', operator: 'eval' as never, value: 'x' }] }, { forActivation: true });
  ok(badOp.some((i) => i.key === 'unknownOperator'), 'operatore inventato → rifiutato');

  const wrongOp = validateWorkflow({ ...base, conditions: [{ field: 'analysis.deadline', operator: 'contains', value: 'x' }] }, { forActivation: true });
  ok(wrongOp.some((i) => i.key === 'operatorNotForType'), 'operatore non adatto al tipo → rifiutato');

  const badAction = validateWorkflow({ ...base, actions: [{ key: 'send_email' as never, config: {} as never }] }, { forActivation: true });
  ok(badAction.some((i) => i.key === 'unknownAction'), 'azione inventata → rifiutata (§150)');

  const badPlaceholder = validateWorkflow({
    ...base,
    actions: [{ key: 'create_task', config: { titleTemplate: 'X {{analysis.iban}}', priority: 'high', dueDate: 'none' } }] as WorkflowAction[],
  }, { forActivation: true });
  ok(badPlaceholder.some((i) => i.key === 'unknownPlaceholder'), 'segnaposto inventato → rifiutato (§31)');

  const noCurrency = validateWorkflow({
    ...base,
    conditions: [{ field: 'analysis.amount', operator: 'greater_than', value: 5000 }],
  }, { forActivation: true });
  ok(noCurrency.some((i) => i.key === 'currencyRequired'),
    'importo senza valuta → rifiutato: la domanda è incompleta (§27)');

  const noActions = validateWorkflow({ ...base, actions: [] }, { forActivation: true });
  ok(noActions.some((i) => i.key === 'noActions'), 'attivazione senza azioni → rifiutata (§54)');
  ok(validateWorkflow({ ...base, actions: [] }, { forActivation: false }).length === 0,
    'una BOZZA senza azioni si può salvare: è un lavoro a metà, non un errore');

  const wrongTriggerAction = validateWorkflow({
    ...base, actions: [{ key: 'assign_task', config: { assigneeUserId: UUID_A } }] as WorkflowAction[],
  }, { forActivation: true });
  ok(wrongTriggerAction.some((i) => i.key === 'actionNotForTrigger'),
    'azione fuori posto per l’innesco → rifiutata');

  const tooMany = validateWorkflow({
    ...base,
    conditions: Array.from({ length: MAX_CONDITIONS + 1 },
      () => ({ field: 'document.title', operator: 'contains', value: 'x' })) as WorkflowCondition[],
  }, { forActivation: true });
  ok(tooMany.some((i) => i.key === 'tooManyConditions'), `più di ${MAX_CONDITIONS} condizioni → rifiutate`);

  const urgencyOnTask = validateWorkflow({
    ...base, triggerType: 'task_created', conditions: [],
    actions: [{ key: 'create_task', config: { titleTemplate: 'X', priority: 'from_urgency', dueDate: 'none' } }] as WorkflowAction[],
  }, { forActivation: true });
  ok(urgencyOnTask.some((i) => i.key === 'urgencyNotAvailable'),
    '«priorità dall’urgenza» su un innesco che non ha urgenza → rifiutata');
}

// ===========================================================================
section('3 · Gli operatori, uno per uno');
// ===========================================================================
{
  const f = (facts: Facts, c: WorkflowCondition) => evaluateCondition(c, facts, NOW).outcome;
  const s: Facts = { 'x.s': known('Comune di Lugano') };
  const n: Facts = { 'x.n': known(5000, 'CHF') };
  const d: Facts = { 'x.d': known('2026-08-20') };
  const b: Facts = { 'x.b': known(true) };

  ok(f(s, { field: 'x.s', operator: 'equals', value: 'comune di lugano' }) === 'true',
    'equals ignora maiuscole e spazi ai bordi');
  ok(f(s, { field: 'x.s', operator: 'not_equals', value: 'Bellinzona' }) === 'true', 'not_equals');
  ok(f(s, { field: 'x.s', operator: 'contains', value: 'LUGANO' }) === 'true', 'contains');
  ok(f(s, { field: 'x.s', operator: 'not_contains', value: 'Zurigo' }) === 'true', 'not_contains');
  ok(f(s, { field: 'x.s', operator: 'starts_with', value: 'Comune' }) === 'true', 'starts_with');
  ok(f(s, { field: 'x.s', operator: 'in', value: ['Bellinzona', 'Comune di Lugano'] }) === 'true', 'in');
  ok(f(s, { field: 'x.s', operator: 'exists' }) === 'true', 'exists su un valore presente');
  ok(f({ 'x.s': missing() }, { field: 'x.s', operator: 'exists' }) === 'false', 'exists su un valore assente');
  ok(f({ 'x.s': missing() }, { field: 'x.s', operator: 'not_exists' }) === 'true', 'not_exists');

  ok(f(n, { field: 'x.n', operator: 'greater_than', value: 4999, currency: 'CHF' }) === 'true', 'greater_than');
  ok(f(n, { field: 'x.n', operator: 'greater_or_equal', value: 5000, currency: 'CHF' }) === 'true', 'greater_or_equal');
  ok(f(n, { field: 'x.n', operator: 'less_than', value: 5000, currency: 'CHF' }) === 'false', 'less_than');
  ok(f(n, { field: 'x.n', operator: 'less_or_equal', value: 5000, currency: 'CHF' }) === 'true', 'less_or_equal');
  ok(f({ 'x.n': known(5000.5, 'CHF') }, { field: 'x.n', operator: 'greater_than', value: '5000,25', currency: 'CHF' }) === 'true',
    'la virgola decimale è un separatore, non un errore di battitura');

  ok(f(d, { field: 'x.d', operator: 'within_days', value: 30 }) === 'true', 'within_days: 19 giorni ≤ 30');
  ok(f(d, { field: 'x.d', operator: 'within_days', value: 10 }) === 'false', 'within_days: 19 giorni > 10');
  // ⚠️ Scelta dichiarata: una scadenza GIÀ PASSATA rientra in «entro N giorni».
  // Escluderla produrrebbe silenzio proprio quando il problema è più grave.
  ok(f({ 'x.d': known('2026-07-01') }, { field: 'x.d', operator: 'within_days', value: 10 }) === 'true',
    'within_days comprende ciò che è già scaduto (scelta dichiarata)');

  ok(f(b, { field: 'x.b', operator: 'equals', value: 'true' }) === 'true', 'boolean confrontato come testo');
  ok(f(b, { field: 'x.b', operator: 'equals', value: 'false' }) === 'false', 'boolean falso');

  ok(daysUntilDate('2026-08-02', new Date('2026-08-01T23:30:00Z')) === 1,
    'i giorni sono di CALENDARIO: alle 23:30 «domani» resta domani');

  // CONTROPROVA: un operatore fuori dall'insieme chiuso non viene interpretato.
  ok(f(s, { field: 'x.s', operator: 'regex' as never, value: '.*' }) === 'unknown',
    'un operatore fuori dall’insieme chiuso NON viene eseguito');
}

// ===========================================================================
section('4 · Vero, falso e NON DETERMINABILE (§22/§26)');
// ===========================================================================
{
  const facts: Facts = {
    'a': known('x'),          // vero
    'b': known('y'),          // falso
    'c': missing(),           // ignoto
  };
  const T: WorkflowCondition = { field: 'a', operator: 'equals', value: 'x' };
  const F: WorkflowCondition = { field: 'b', operator: 'equals', value: 'zzz' };
  const U: WorkflowCondition = { field: 'c', operator: 'equals', value: 'x' };

  const allTF = evaluateConditions([T, F], 'all', facts, NOW);
  ok(!allTF.matched && allTF.evaluable, 'TUTTE con un falso → non corrisponde, e si è potuto decidere');

  const anyTF = evaluateConditions([T, F], 'any', facts, NOW);
  ok(anyTF.matched && anyTF.evaluable, 'ALMENO UNA con un vero → corrisponde');

  const allTU = evaluateConditions([T, U], 'all', facts, NOW);
  ok(!allTU.matched && !allTU.evaluable,
    'TUTTE con un ignoto → NON si esegue, e lo si dichiara (§26)');

  // ⚠️ Falso e ignoto fa FALSO: è la logica a tre valori, e serve a non
  // riempire lo storico di «non valutabile» quando la risposta è chiara.
  const allFU = evaluateConditions([F, U], 'all', facts, NOW);
  ok(!allFU.matched && allFU.evaluable,
    'TUTTE con un falso E un ignoto → «non corrisponde», non «non valutabile»');

  const anyFU = evaluateConditions([F, U], 'any', facts, NOW);
  ok(!anyFU.matched && !anyFU.evaluable, 'ALMENO UNA con solo falso e ignoto → non determinabile');

  const none = evaluateConditions([], 'all', facts, NOW);
  ok(none.matched && none.evaluable, 'nessuna condizione → corrisponde sempre (dichiarato nella UI)');

  // CONTROPROVA: se «ignoto» fosse trattato come «falso», questo caso direbbe
  // evaluable=true — e la regola verrebbe saltata in silenzio invece che
  // dichiarata non valutabile.
  ok(evaluateConditions([U], 'all', facts, NOW).evaluable === false,
    'un solo ignoto non diventa mai un «no» silenzioso');
}

// ===========================================================================
section('5 · Valute: non si convertono, e la risposta non è «no» (§27)');
// ===========================================================================
{
  const chf: Facts = { 'amount': known(9000, 'CHF') };
  const eur: Facts = { 'amount': known(9000, 'EUR') };
  const c: WorkflowCondition = { field: 'amount', operator: 'greater_than', value: 5000, currency: 'CHF' };

  ok(evaluateCondition(c, chf, NOW).outcome === 'true', 'CHF 9000 > CHF 5000');
  const other = evaluateCondition(c, eur, NOW);
  ok(other.outcome === 'unknown' && other.reason === 'currency_mismatch',
    'EUR 9000 confrontato con CHF 5000 → NON determinabile, non «no»');

  const noCur = evaluateCondition(c, { 'amount': known(9000, null) }, NOW);
  ok(noCur.outcome === 'unknown', 'importo senza valuta → non determinabile');
}

// ===========================================================================
section('6 · Incertezza e correzioni umane (§24/§25)');
// ===========================================================================
{
  const low = aiFact({ value: 'Comune Lugamo', overallConfidence: 0.2 });
  ok(!low.known && low.reason === 'low_confidence',
    'un dato AI sotto soglia NON è un fatto certo');

  const corrected = aiFact({ value: 'Comune di Lugano', corrected: true, overallConfidence: 0.2 });
  ok(corrected.known && corrected.value === 'Comune di Lugano',
    'una CORREZIONE UMANA vince su qualunque punteggio (§24)');

  const high = aiFact({ value: 'AFC', overallConfidence: 0.9 });
  ok(high.known, 'un dato AI sopra soglia è utilizzabile');

  const noSignal = aiFact({ value: 'AFC' });
  ok(noSignal.known,
    'senza alcun segnale di affidabilità il valore resta utilizzabile: dedurre incertezza dall’assenza di una misura sarebbe inventare a rovescio');

  const labelled = aiFact({ value: 'AFC', confidenceLabel: 'bassa' });
  ok(!labelled.known, 'l’etichetta «bassa» rende incerto anche senza punteggio');

  ok(aiFact({ value: null }).known === false && aiFact({ value: '' }).known === false,
    'un valore assente o vuoto non è un fatto');

  ok(MIN_ANALYSIS_CONFIDENCE > 0 && MIN_ANALYSIS_CONFIDENCE < 1, 'la soglia è una frazione');

  ok(optional('x').known && !optional(null).known && !optional('   ').known,
    'optional() distingue presente, assente e vuoto');
  ok(uncertain('x').known === false, 'uncertain() non è mai un fatto');

  ok(emailDomain('Andrea@ESTV.admin.ch') === 'estv.admin.ch', 'il dominio si legge in minuscolo');
  ok(emailDomain('senza-chiocciola') === null, 'un indirizzo senza @ non ha dominio');
}

// ===========================================================================
section('7 · Modelli di testo: mai «Verifica undefined» (§29/§31/§119)');
// ===========================================================================
{
  const facts: Facts = {
    'document.title': known('Sollecito IVA Q2'),
    'analysis.sender': missing(),
    'analysis.deadline': known('2026-08-31'),
    'analysis.amount': known(4820, 'CHF'),
  };

  const good = renderTemplate('Verifica {{document.title}}', facts);
  ok(good.text === 'Verifica Sollecito IVA Q2' && good.missing.length === 0, 'sostituzione semplice');

  const withDate = renderTemplate('Scade il {{analysis.deadline}}', facts);
  ok(withDate.text === 'Scade il 31.08.2026', 'le date si scrivono come in Svizzera');

  const withAmount = renderTemplate('{{analysis.amount}}', facts);
  ok(withAmount.text === 'CHF 4’820', 'gli importi portano la valuta e l’apostrofo delle migliaia',
    withAmount.text);

  const bad = renderRequired('Verifica {{analysis.sender}}', facts);
  ok('missing' in bad, 'un segnaposto senza valore NON produce un titolo: l’azione si salta (§31)');

  const badText = renderTemplate('Verifica {{analysis.sender}}', facts);
  ok(!badText.text.includes('undefined') && !badText.text.includes('{{'),
    'in nessun caso compare «undefined» o una graffa in pagina');

  ok(placeholdersIn('a {{x.y}} b {{X.Y}} c').length === 1,
    'i segnaposto si contano una volta sola, indipendentemente dalle maiuscole');
  ok(placeholdersIn('{{ document.title }}')[0] === '{{document.title}}',
    'la forma canonica non dipende dagli spazi');
  ok(placeholdersIn('{{eval(1+1)}}').length === 0,
    'ciò che non è un percorso semplice NON è un segnaposto (§105)');

  ok(formatDate('2026-01-05') === '05.01.2026', 'formato data');
  ok(formatAmount(1234567.5, 'CHF') === 'CHF 1’234’567.50', 'formato importo', formatAmount(1234567.5, 'CHF'));

  const onlySymbols = renderRequired('— {{analysis.sender}} —', facts);
  ok('missing' in onlySymbols, 'un testo rimasto senza lettere non è un titolo');
}

// ===========================================================================
section('8 · La frase che si legge prima di attivare (§160/§161)');
// ===========================================================================
{
  const draft = {
    triggerType: 'document_analysis_completed' as const,
    conditionMatch: 'all' as const,
    conditions: [
      { field: 'document.category', operator: 'equals' as const, value: 'taxes' },
      { field: 'analysis.urgency', operator: 'equals' as const, value: 'alta' },
    ],
    actions: [{
      key: 'create_task' as const,
      config: { titleTemplate: 'Verifica {{document.title}}', priority: 'high' as const, dueDate: 'none' as const, assigneeUserId: UUID_A },
    }],
  };
  const sentence = summarySentence(t, draft, names);
  ok(sentence.startsWith('Quando viene analizzato un documento'), 'comincia con «Quando»', sentence);
  ok(sentence.includes('Imposte') && sentence.includes('alta'),
    'nomina le condizioni con le ETICHETTE, non con le chiavi tecniche', sentence);
  ok(sentence.includes('Andrea'), 'nomina la persona, non il suo identificativo', sentence);
  ok(!sentence.includes('taxes') && !sentence.includes('create_task') && !sentence.includes(UUID_A),
    'nessuna chiave tecnica e nessun identificativo nella frase', sentence);
  ok(sentence.endsWith('.'), 'è una frase, non un elenco');

  const noConditions = summarySentence(t, { ...draft, conditions: [] }, names);
  ok(noConditions.includes('senza condizioni'),
    'una regola senza condizioni lo DICE: si applica a tutto ciò che passa');

  const description = describeCondition(t, findTrigger('document_analysis_completed')!, draft.conditions[0], names);
  ok(description === 'Categoria è Imposte', 'una condizione si legge come una frase', description);
}

// ===========================================================================
section('9 · L’urgenza: la copia deve coincidere con l’originale');
// ===========================================================================
{
  // ⚠️ È IL TEST CHE TIENE INSIEME DUE IMPLEMENTAZIONI.
  // `urgencyFrom` (portabile, gira in Deno) è un doppione dichiarato di
  // `urgencyFromType` + `daysUntil` (browser). Se divergono, la schermata di
  // analisi e la regola raccontano due cose diverse sullo stesso documento.
  //
  // ⚠️ Il confronto è in DUE PEZZI, e la prima versione di questo test li aveva
  // confusi dando un rosso che non c'era: `daysUntil` legge `Date.now()`
  // internamente e non accetta un istante, quindi passargli una data costruita
  // su un «adesso» finto confronta due momenti diversi. Si verifica separatamente
  // che il CALCOLO DEI GIORNI coincida (con l'orologio vero, l'unico che
  // l'originale sa leggere) e che la MAPPATURA giorni → urgenza coincida.
  const types = [
    'reminder', 'sollecito', 'invoice', 'payment_request', 'official_decision',
    'inspection_notice', 'declaration_request', 'request_for_documents',
    'information', 'tax_document', 'contract_related', 'decisione', 'controllo', '',
  ];
  const offsets = [-30, -1, 0, 1, 5, 10, 11, 29, 30, 31, 90];

  // (a) Il calcolo dei giorni. Le date sono a mezzogiorno per stare lontane dal
  //     confine dell'arrotondamento: un millisecondo di scarto fra le due
  //     letture dell'orologio non deve poter cambiare il risultato.
  const realNow = new Date();

  // ⚠️⚠️ QUESTO BLOCCO È CAMBIATO IL 2026-08-24, E IL PERCHÉ VALE PIÙ DEL COME.
  //
  // Prima confrontava `daysUntilMs` (server) con `daysUntil` (motore locale) e
  // chiedeva che coincidessero. Coincidevano: erano la STESSA aritmetica
  // sbagliata, copiata di proposito — il commento in `facts.ts` lo dichiarava
  // («allinearsi a una versione migliore significherebbe divergere»). Un
  // controllo di coerenza fra due copie non vede mai il difetto che entrambe
  // hanno: misura la copia, non la risposta.
  //
  // E le date erano costruite a MEZZOGIORNO, «per stare lontane dal confine
  // dell'arrotondamento» — cioè lontane dall'unico posto in cui il difetto si
  // manifesta. Ora si prova proprio lì.
  //
  // Oggi i due lati chiamano la stessa funzione, quindi «coincidono» sarebbe
  // vero per costruzione. Al suo posto: la CONTROPROVA, cioè l'aritmetica
  // vecchia riprodotta qui accanto, che DEVE dare una risposta diversa. Se un
  // giorno qualcuno la rimettesse, questo caso lo dice.
  const vecchiaAritmetica = (iso: string, now: Date): number | null =>
    iso ? Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000) : null;

  // Sera a ovest di Greenwich: in locale è ancora il 24, in UTC è già il 25.
  const seraAOvest = new Date('2026-08-25T01:00:00Z');
  const giornoLocaleDiAllora = new Date(2026, 7, 24);       // 24 agosto, locale
  const calendario = calendarDaysUntil('2026-08-25', giornoLocaleDiAllora);
  const millisecondi = vecchiaAritmetica('2026-08-25', seraAOvest);
  ok(calendario === 1,
    'una scadenza di domani è a UN giorno, anche di sera', `calendario=${calendario}`);
  ok(millisecondi === 0,
    'CONTROPROVA: l’aritmetica a millisecondi diceva ZERO — «scade oggi»', `ms=${millisecondi}`);
  ok(calendario !== millisecondi,
    'le due risposte DIVERGONO: è il difetto, riprodotto');

  // E le soglie dell'urgenza continuano a poggiare sullo stesso conto sui due
  // lati — che ora è quello giusto.
  let dayMismatches = 0;
  const dayDetail: string[] = [];
  for (const offset of offsets) {
    const iso = new Date(realNow.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const atteso = offset;
    const avuto = calendarDaysUntil(iso, realNow);
    if (avuto !== atteso) { dayMismatches++; dayDetail.push(`${offset}: ${avuto} ≠ ${atteso}`); }
  }
  ok(dayMismatches === 0,
    'una data pura a N giorni risponde N, per ogni scarto provato', dayDetail.join('; '));
  ok(calendarDaysUntil(null, realNow) === null,
    'senza scadenza non c’è un numero di giorni — e non è zero');

  // (b) La mappatura giorni → urgenza, su tutta la matrice.
  let mismatches = 0;
  const detail: string[] = [];
  for (const type of types) {
    for (const offset of offsets) {
      const deadline = new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
      const mine = urgencyFrom(type, deadline, NOW);
      const theirs = urgencyFromType(type, calendarDaysUntil(deadline, NOW));
      if (mine !== theirs) { mismatches++; detail.push(`${type}/${offset}: ${mine} ≠ ${theirs}`); }
    }
    if (urgencyFrom(type, null, NOW) !== urgencyFromType(type, null)) {
      mismatches++; detail.push(`${type}/senza scadenza`);
    }
  }
  ok(mismatches === 0,
    `la mappatura urgenza coincide con quella del motore locale su ${types.length * (offsets.length + 1)} casi`,
    detail.slice(0, 5).join('; '));

  // CONTROPROVA: la matrice deve poter distinguere i tre valori, altrimenti
  // «coincidono» non significherebbe niente.
  const seen = new Set(offsets.map((o) =>
    urgencyFrom('information', new Date(NOW.getTime() + o * 86_400_000).toISOString().slice(0, 10), NOW)));
  ok(seen.size === 3, 'la matrice produce davvero tutte e tre le urgenze', [...seen].join(','));
}

// ===========================================================================
section('10 · I modelli iniziali sono tutti attivabili (§75–§81)');
// ===========================================================================
{
  let allValid = true;
  const problems: string[] = [];
  for (const tpl of AUTOMATION_TEMPLATES) {
    // I modelli che hanno bisogno di un'etichetta la ricevono all'installazione:
    // qui si mette un identificativo finto per provare tutto il resto.
    const actions = tpl.actions.map((a) => (a.key === 'add_document_tag'
      ? { key: a.key, config: { tagId: UUID_A } } as WorkflowAction : a));
    const issues = validateWorkflow(
      { name: t(tpl.nameKey), triggerType: tpl.triggerType, conditionMatch: tpl.conditionMatch,
        conditions: tpl.conditions, actions },
      { forActivation: true },
    );
    if (issues.length) { allValid = false; problems.push(`${tpl.id}: ${issues.map((i) => i.key).join(',')}`); }
    if (!lookup(tpl.nameKey) || !lookup(tpl.descriptionKey)) {
      allValid = false; problems.push(`${tpl.id}: etichette mancanti`);
    }
  }
  ok(allValid, `tutti i ${AUTOMATION_TEMPLATES.length} modelli superano la validazione`, problems.join(' | '));

  const invoice = AUTOMATION_TEMPLATES.find((x) => x.id === 'large_invoice')!;
  ok(invoice.conditions.some((c) => c.currency === 'CHF'),
    'il modello «fattura importante» dichiara la valuta (§27)');
  ok(invoice.actions.every((a) => a.key === 'create_task'),
    'il modello «fattura importante» VERIFICA e non paga (§78/§191)');

  ok(AUTOMATION_TEMPLATES.every((x) => x.actions.length > 0),
    'nessun modello è una regola vuota');
}

// ===========================================================================
section('11 · Le costanti che UI e server dichiarano insieme');
// ===========================================================================
{
  ok(AUTOMATION_LIMITS.maxActions === MAX_ACTIONS
    && AUTOMATION_LIMITS.maxConditions === MAX_CONDITIONS
    && AUTOMATION_LIMITS.maxChainDepth === MAX_CHAIN_DEPTH
    && AUTOMATION_LIMITS.maxEventAttempts === MAX_EVENT_ATTEMPTS,
    'l’oggetto dei limiti coincide con le costanti singole');

  ok(MAX_CHAIN_DEPTH >= 2 && MAX_CHAIN_DEPTH <= 10,
    'la profondità massima della catena è bassa ma non degenere (§70)');
  ok(EDGE_TIME_BUDGET_MS < 150_000,
    'il budget di tempo sta sotto i 150 secondi che uccidono l’isolate');
  ok(AUTO_PAUSE_AFTER_FAILURES > 1, 'un guasto isolato non mette in pausa una regola (§104)');
  ok(OVERDUE_LOOKBACK_DAYS <= 7,
    'la scansione delle scadute guarda indietro poco: non è un backfill (§164)');

  const b1 = eventBackoffSeconds(1, () => 0);
  const b3 = eventBackoffSeconds(3, () => 0);
  ok(b3 > b1, 'l’attesa fra i tentativi cresce');
  ok(eventBackoffSeconds(20, () => 1) <= 3600 * 1.25, 'l’attesa ha un tetto');
  ok(eventBackoffSeconds(2, () => 0) !== eventBackoffSeconds(2, () => 1),
    'c’è del jitter: due worker non ritentano allo stesso istante');

  // Ogni codice che il motore può produrre deve avere una frase: un codice
  // senza etichetta comparirebbe grezzo in pagina.
  const missingLabels = AUTOMATION_ERROR_CODES.filter((code) => {
    if (code === 'unknown' || code === 'chain_depth_exceeded' || code === 'entity_company_mismatch') return false;
    const map: Record<string, string> = {
      config_invalid: 'configInvalid', entity_missing: 'entityMissing',
      condition_not_evaluable: 'notEvaluable', template_value_missing: 'templateMissing',
      value_not_derivable: 'valueNotDerivable', assignee_not_member: 'assigneeNotMember',
      tag_missing: 'tagMissing', no_recipient: 'noRecipient', manual_category: 'manualCategory',
      already_set: 'alreadySet', duplicate: 'duplicate', action_failed: 'generic',
    };
    return !lookup(`automations.outcome.${map[code]}`);
  });
  ok(missingLabels.length === 0,
    'ogni codice di errore del motore ha una frase nei dizionari', missingLabels.join(', '));
}

// ===========================================================================
section('12 · La prova a vuoto non scrive: lo dice il tipo, non la buona fede');
// ===========================================================================
{
  // Un client che REGISTRA ogni chiamata e non ne consente nessuna di
  // scrittura: se `planAction` provasse a scrivere, il test fallirebbe.
  const calls: string[] = [];
  const sb = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'gte']) chain[m] = self;
      chain.maybeSingle = async () => ({ data: null, error: null });
      chain.single = async () => ({ data: null, error: null });
      for (const m of ['insert', 'update', 'delete', 'upsert']) {
        chain[m] = () => { calls.push(`WRITE:${table}`); return chain; };
      }
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  };

  const ctx: ActionContext = {
    companyId: 'c', runId: null, workflowId: 'w', workflowName: 'Prova',
    facts: { 'document.title': known('Sollecito IVA'), 'analysis.urgency': known('alta') },
    entityType: 'document', entityId: 'd', documentId: 'd',
    emailMessageId: null, taskId: null, contractId: null, contractMilestoneId: null,
    crmOrganizationId: null, crmOpportunityId: null,
    assigneeUserId: null, now: NOW,
  };

  const plan = await planAction(sb as never, ctx, {
    key: 'create_task',
    config: { titleTemplate: 'Verifica {{document.title}}', priority: 'from_urgency', dueDate: 'none' },
  } as WorkflowAction);

  ok(plan.outcome === 'ready', 'il piano si costruisce');
  ok(!calls.some((c) => c.startsWith('WRITE:')),
    'costruire il piano NON scrive niente: è ciò che rende vera la prova a vuoto (§148)');
  ok(plan.outcome === 'ready' && (plan.preview.priority === 'high'),
    'la priorità «dall’urgenza» diventa alta quando l’urgenza è alta');

  const noUrgency = await planAction(sb as never, { ...ctx, facts: { 'document.title': known('X') } }, {
    key: 'create_task',
    config: { titleTemplate: 'Verifica {{document.title}}', priority: 'from_urgency', dueDate: 'none' },
  } as WorkflowAction);
  ok(noUrgency.outcome === 'skip' && noUrgency.errorCode === 'value_not_derivable',
    'senza urgenza la priorità NON si inventa: l’azione si salta e lo dichiara');
}

// ===========================================================================
section('13 · Il CRM dentro le automazioni (0026 — §136–§139)');
// ===========================================================================
{
  // (a) I tre modelli scrivibili con gli inneschi che esistono. Il quarto —
  //     «cliente inattivo», §139 — non c'è, e il test lo DICHIARA invece di
  //     lasciar credere che sia stato dimenticato: nessun innesco scatta al
  //     passare del tempo su una controparte.
  const crmIds = ['crm_follow_up_overdue', 'crm_opportunity_unowned', 'crm_new_customer'];
  const found = crmIds.filter((id) => AUTOMATION_TEMPLATES.some((x) => x.id === id));
  ok(found.length === crmIds.length, 'i tre modelli del CRM sono offerti nel generatore',
    `mancano: ${crmIds.filter((id) => !found.includes(id)).join(', ')}`);
  ok(!AUTOMATION_TEMPLATES.some((x) => x.triggerType === 'crm_organization_created'
    && x.id.includes('inactive')),
    'nessun modello finge di sorvegliare l’inattività di un cliente (§139 non è implementabile oggi)');

  // (a-bis) Blocco C / D-10 (2026-08-26): i modelli sulle trattative e gli
  //     inneschi dei moduli fuori perimetro restano nel codice ma si nascondono
  //     in UI dietro `VITE_LEGACY_MODULES`. Il flag non entra in questo file:
  //     le funzioni sono pure e lo ricevono come parametro.
  //     0053 — anche «fattura emessa scaduta»: Finanze è fuori perimetro quanto
  //     il CRM, e un modello che si offre per un modulo nascosto è una porta
  //     che non porta da nessuna parte.
  ok(AUTOMATION_TEMPLATES.filter((x) => x.legacyOnly).map((x) => x.id).sort().join(',')
      === 'crm_follow_up_overdue,crm_opportunity_unowned,finance_issued_overdue',
    'solo i modelli sulle trattative e la fattura emessa portano la marcatura legacy (D-10)');
  ok(isLegacyTrigger('crm_follow_up_due') && isLegacyTrigger('finance_item_ready')
    && isLegacyTrigger('contract_verified') && !isLegacyTrigger('document_analysis_completed')
    && !isLegacyTrigger('task_created'),
    'isLegacyTrigger riconosce gli inneschi dei tre moduli fuori perimetro');
  ok(triggersOffered(false).length > 0 && triggersOffered(false).every((t) => !isLegacyTrigger(t.key)),
    'con i moduli nascosti il costruttore non offre inneschi legacy');
  ok(triggersOffered(true).length === TRIGGERS.length,
    'con VITE_LEGACY_MODULES=on il costruttore offre tutto il registro');
  ok(triggersOffered(false, 'crm_follow_up_due').some((t) => t.key === 'crm_follow_up_due'),
    'l’innesco di una regola esistente resta nell’elenco: una tendina non mente');

  // (b) ⚠️ IL DIFETTO CHE QUESTO CASO SORVEGLIA: un'attività creata da una
  //     regola CRM deve NASCERE COLLEGATA alla controparte. Fino al 2026-07-30
  //     `linkEntity` era spuntata e non collegava niente, perché il motore non
  //     passava l'organizzazione: l'attività compariva nel Work Hub e non sulla
  //     scheda del cliente, cioè nel solo posto per cui il modulo esiste.
  const crmTasks = AUTOMATION_TEMPLATES
    .filter((x) => crmIds.includes(x.id))
    .flatMap((x) => x.actions.filter((a) => a.key === 'create_task'));
  ok(crmTasks.length > 0 && crmTasks.every((a) => (a.config as { linkEntity?: boolean }).linkEntity !== false),
    'le attività dei modelli CRM nascono collegate alla controparte');

  // (c) Il collegamento non è una dichiarazione: si verifica sul PIANO.
  const crmCtx: ActionContext = {
    companyId: 'c', runId: null, workflowId: 'w', workflowName: 'Prova',
    facts: { 'organization.name': known('Bernasconi Impianti SA'), 'opportunity.title': known('Impianto') },
    entityType: 'crm_opportunity', entityId: 'o',
    documentId: null, emailMessageId: null, taskId: null,
    contractId: null, contractMilestoneId: null,
    crmOrganizationId: 'org-1', crmOpportunityId: 'opp-1',
    assigneeUserId: 'u-1', now: NOW,
  };
  const sbNoop = {
    from: () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'gte']) chain[m] = self;
      chain.maybeSingle = async () => ({ data: null, error: null });
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  const crmPlan = await planAction(sbNoop as never, crmCtx, {
    key: 'create_task',
    config: {
      titleTemplate: '{{organization.name}} — {{opportunity.title}}',
      priority: 'medium', dueDate: 'in_days', dueDateDays: 0, linkEntity: true,
    },
  } as WorkflowAction);
  const row = crmPlan.outcome === 'ready' && crmPlan.write.kind === 'create_task'
    ? crmPlan.write.row as Record<string, unknown> : {};
  ok(row.crm_organization_id === 'org-1' && row.crm_opportunity_id === 'opp-1',
    'l’attività pianificata porta la controparte E la trattativa',
    `org=${String(row.crm_organization_id)} opp=${String(row.crm_opportunity_id)}`);

  // CONTROPROVA: senza «collega», nessun collegamento. Un test che vede solo il
  // caso positivo non distingue «lo scrive» da «lo scrive sempre».
  const unlinked = await planAction(sbNoop as never, crmCtx, {
    key: 'create_task',
    config: {
      titleTemplate: '{{organization.name}}', priority: 'medium',
      dueDate: 'none', linkEntity: false,
    },
  } as WorkflowAction);
  const row2 = unlinked.outcome === 'ready' && unlinked.write.kind === 'create_task'
    ? unlinked.write.row as Record<string, unknown> : {};
  ok(row2.crm_organization_id === null && row2.crm_opportunity_id === null,
    'togliendo «collega» il collegamento sparisce davvero');

  // (d) ⚠️ IL SECONDO DIFETTO: «avvisa il responsabile» era rifiutato ovunque
  //     tranne che sulle attività, mentre `store.ts` calcola il responsabile
  //     anche per contratti, controparti e trattative citando §84 e §136. Il
  //     motore sapeva a chi scrivere e il generatore non lasciava dirlo.
  const owned: AutomationEventType[] = [
    'crm_follow_up_due', 'crm_opportunity_created', 'crm_organization_created',
    'contract_verified', 'task_became_overdue',
  ];
  const ownedOk = owned.every((trigger) => validateWorkflow({
    name: 'x', triggerType: trigger, conditionMatch: 'all', conditions: [],
    actions: [{ key: 'create_notification', config: { recipient: 'assignee', messageTemplate: 'x' } }],
  }, { forActivation: true }).length === 0);
  ok(ownedOk, 'si può avvisare il responsabile dove un responsabile esiste');

  // CONTROPROVA: dove il responsabile NON esiste la regola resta invalida —
  // altrimenti avremmo solo allargato il permesso a tutto.
  const noOwner = validateWorkflow({
    name: 'x', triggerType: 'document_analysis_completed', conditionMatch: 'all', conditions: [],
    actions: [{ key: 'create_notification', config: { recipient: 'assignee', messageTemplate: 'x' } }],
  }, { forActivation: true });
  ok(noOwner.some((i) => i.key === 'recipientNotAvailable'),
    'su un documento «avvisa il responsabile» resta rifiutato: là non c’è nessuno');

  // (e) ⚠️ NESSUN TESTO DENTRO UN MODELLO. Il titolo di un'attività creata da
  //     una regola resta nel database com'è nato: una parola italiana scritta
  //     qui comparirebbe identica nella schermata tedesca. Sono ammessi solo
  //     segnaposti e separatori — questo controllo vale per TUTTI i modelli,
  //     non solo per quelli del CRM.
  const withText: string[] = [];
  for (const tpl of AUTOMATION_TEMPLATES) {
    for (const a of tpl.actions) {
      const cfg = a.config as { titleTemplate?: string; messageTemplate?: string; descriptionTemplate?: string };
      for (const text of [cfg.titleTemplate, cfg.messageTemplate, cfg.descriptionTemplate]) {
        if (!text) continue;
        const residuo = text.replace(/\{\{[^}]+\}\}/g, '').replace(/[\s—–\-·:,.|/]+/g, '');
        if (residuo !== '') withText.push(`${tpl.id}: «${residuo}»`);
      }
    }
  }
  ok(withText.length === 0,
    'nessun modello scrive testo in una lingua sola dentro un titolo o un messaggio',
    withText.join(' | '));
}

// ===========================================================================
section('14 · I FATTI non nascono da un guasto: `loadFacts` solleva, non inventa');
// ===========================================================================
//
// ⚠️⚠️ PERCHÉ QUESTA SEZIONE ESISTE, e perché è la più importante del file.
// Fino al 2026-08-11 i caricatori di `loadFacts` scartavano l'errore delle loro
// letture. Il risultato era `null`, e da `null` nasce un `missing()` — un fatto
// DICHIARATO assente.
//
// Ma `missing()` non è un ignoto per tutti gli operatori. Il primo caso qui
// sotto lo dimostra invece di affermarlo: con `not_exists`, un fatto mancante
// rende la condizione **vera**. Quindi una regola scritta «campo non_esiste»
// partiva perché il database aveva singhiozzato — non un'automazione mancata,
// quella SBAGLIATA, eseguita davvero.
{
  // --- 14.1 La conseguenza, provata e non asserita -------------------------
  ok(evaluateCondition({ field: 'x.s', operator: 'not_exists' }, { 'x.s': missing() }, NOW).outcome === 'true',
    '⚠️⚠️ un fatto MANCANTE rende vera una condizione `not_exists`: è la ragione per cui un guasto non può diventare un fatto');
  ok(evaluateCondition({ field: 'x.s', operator: 'not_exists' }, { 'x.s': uncertain('v') }, NOW).outcome === 'unknown',
    '…mentre un fatto INCERTO resta «non lo so»: la salvaguardia esiste, e `missing` non è nel suo elenco');

  // --- Un PostgREST finto che sa fallire su una tabella scelta -------------
  type Riga = Record<string, unknown>;
  const sbFinto = (tabelle: Record<string, Riga[]>, rotta?: string) => ({
    from: (tabella: string) => {
      const filtri: ((r: Riga) => boolean)[] = [];
      const righe = () => (tabelle[tabella] ?? []).filter((r) => filtri.every((f) => f(r)));
      const errore = () => (tabella === rotta ? { code: '57014', message: 'statement timeout' } : null);
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ['select', 'order', 'limit']) chain[m] = self;
      chain.eq = (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return chain; };
      chain.neq = (c: string, v: unknown) => { filtri.push((r) => r[c] !== v); return chain; };
      chain.in = (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return chain; };
      chain.is = (c: string, v: unknown) => { filtri.push((r) => (v === null ? r[c] == null : r[c] === v)); return chain; };
      chain.maybeSingle = async () => {
        const e = errore();
        return e ? { data: null, error: e } : { data: righe()[0] ?? null, error: null };
      };
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const e = errore();
        return Promise.resolve(e ? { data: null, error: e } : { data: righe(), error: null }).then(res, rej);
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  });

  const evento = (over: Partial<ClaimedEvent> = {}): ClaimedEvent => ({
    id: 'e-1', company_id: 'A', event_type: 'task_created', entity_type: 'task',
    entity_id: 't-1', payload: {}, occurred_at: NOW.toISOString(), origin: 'system',
    correlation_id: 'k-1', root_event_id: null, chain_depth: 0, attempts: 0, lock_id: 'l-1',
    ...over,
  } as ClaimedEvent);

  const solleva = async (fn: () => Promise<unknown>): Promise<Error | null> => {
    try { await fn(); return null; } catch (e) { return e as Error; }
  };

  const MONDO: Record<string, Riga[]> = {
    tasks: [{ id: 't-1', company_id: 'A', title: 'Rendiconto', priority: 'high', status: 'open',
      source: 'manual', assignee_user_id: 'u-1', due_date: '2026-09-01', authority: null, document_id: 'd-1' }],
    documents: [{ id: 'd-1', company_id: 'A', title: 'Fattura', source_type: 'upload',
      category: 'invoice', category_source: 'ai' }],
    document_analyses: [], analysis_corrections: [], finance_items: [],
    crm_organizations: [{ id: 'o-1', company_id: 'A', display_name: 'Rossi SA',
      account_owner_user_id: 'u-1', relationship_status: 'active', canton: 'TI', city: 'Lugano',
      source: 'manual', last_contact_at: null }],
    crm_organization_roles: [], crm_opportunities: [],
    finance_issued_invoices: [{ id: 'f-1', company_id: 'A', organization_id: 'o-1',
      invoice_number: '2026-0014', due_date: '2026-08-20', total_amount: 1250.5, currency: 'CHF' }],
  };

  // --- 14.2 Ogni caricatore SOLLEVA sul proprio guasto ---------------------
  const casi: { nome: string; rotta: string; codice: string; evt: ClaimedEvent }[] = [
    { nome: 'l\'ATTIVITÀ', rotta: 'tasks', codice: 'facts_task', evt: evento() },
    { nome: 'il DOCUMENTO', rotta: 'documents', codice: 'facts_document',
      evt: evento({ entity_type: 'document', entity_id: 'd-1', event_type: 'document_analysis_completed' }) },
    { nome: 'le ANALISI del documento', rotta: 'document_analyses', codice: 'facts_document_analyses',
      evt: evento({ entity_type: 'document', entity_id: 'd-1', event_type: 'document_analysis_completed' }) },
    { nome: 'le CORREZIONI umane', rotta: 'analysis_corrections', codice: 'facts_document_corrections',
      evt: evento({ entity_type: 'document', entity_id: 'd-1', event_type: 'document_analysis_completed' }) },
    { nome: 'la VOCE FINANZIARIA', rotta: 'finance_items', codice: 'facts_finance_item',
      evt: evento({ entity_type: 'document', entity_id: 'd-1', event_type: 'document_analysis_completed' }) },
    { nome: 'l\'ORGANIZZAZIONE del CRM', rotta: 'crm_organizations', codice: 'facts_crm_organization',
      evt: evento({ entity_type: 'crm_organization', entity_id: 'o-1', event_type: 'crm_organization_created' }) },
    { nome: 'i RUOLI del CRM', rotta: 'crm_organization_roles', codice: 'facts_crm_roles',
      evt: evento({ entity_type: 'crm_organization', entity_id: 'o-1', event_type: 'crm_organization_created' }) },
    { nome: 'la FATTURA EMESSA', rotta: 'finance_issued_invoices', codice: 'facts_finance_issued_invoice',
      evt: evento({ entity_type: 'finance_issued_invoice', entity_id: 'f-1', event_type: 'finance_issued_invoice_overdue' }) },
  ];

  for (const c of casi) {
    const e = await solleva(() => loadFacts(sbFinto(MONDO, c.rotta) as never, c.evt, NOW));
    ok(e !== null && e.message.startsWith(`${c.codice}:`),
      `⚠️ guasto su ${c.nome}: solleva con il codice «${c.codice}», invece di produrre fatti mancanti`,
      e ? e.message : 'nessuna eccezione: il guasto è diventato un fatto');
  }

  // --- 14.3 …e l'ASSENZA legittima resta un `null`, senza sollevare --------
  // È l'altra metà della coppia. Se un giorno tornassero a coincidere — se cioè
  // qualcuno facesse sollevare anche l'assenza, o tacere di nuovo il guasto —
  // una di queste due asserzioni diventa rossa.
  {
    const e = await solleva(() => loadFacts(sbFinto({ ...MONDO, tasks: [] }) as never, evento(), NOW));
    ok(e === null, 'un\'attività DAVVERO sparita non solleva: il motore la ricalcola, ed è un caso legittimo',
      e ? `ha sollevato: ${e.message}` : '');
  }
  {
    const facts = await loadFacts(sbFinto(MONDO) as never, evento(), NOW);
    ok(facts !== null && facts.facts['task.priority']?.known === true,
      'e sul cammino normale i fatti si costruiscono come sempre', JSON.stringify(facts?.facts['task.priority']));
  }
  {
    // 0053 — il caricatore della fattura emessa: fatti riletti dalla riga,
    // importo con la sua valuta, e responsabile dalla RELAZIONE col cliente
    // (la catena di §136 senza l'anello della trattativa).
    const facts = await loadFacts(sbFinto(MONDO) as never, evento({
      entity_type: 'finance_issued_invoice', entity_id: 'f-1',
      event_type: 'finance_issued_invoice_overdue',
    }), NOW);
    ok(facts !== null
      && facts.facts['issued_invoice.total_amount']?.known === true
      && facts.facts['issued_invoice.total_amount']?.currency === 'CHF'
      && facts.crmOrganizationId === 'o-1'
      && facts.assigneeUserId === 'u-1',
      '0053 — la fattura emessa: fatti dalla riga, valuta sull’importo, responsabile dalla relazione',
      JSON.stringify(facts?.facts['issued_invoice.total_amount']));
  }

  // --- 14.4 Il codice è quello che il worker registra ----------------------
  // `codeOf()` prende la PRIMA PAROLA del messaggio: se un codice contenesse
  // uno spazio o un carattere fuori dall'identificatore, il log direbbe
  // «unknown» su un guasto che un nome ce l'aveva.
  const codici = casi.map((c) => c.codice);
  ok(codici.every((c) => /^[a-z_]{3,40}$/.test(c)),
    '⚠️ ogni codice è un identificatore che `codeOf()` sa estrarre: altrimenti il log direbbe «unknown»',
    codici.filter((c) => !/^[a-z_]{3,40}$/.test(c)).join(', '));
}

// ===========================================================================
section('15 · La CODA e il contatore: nessuna scrittura di esito può tacere');
// ===========================================================================
//
// Le quattro scritture che chiudono un evento — fatto, ritenta, fallito,
// lettera morta — scartavano l'errore. Ognuna lasciava la riga `processing`
// con il lease vecchio: riprenotata alla scadenza, rilavorata, per sempre,
// mentre il worker aveva già contato l'esito e risposto 200. La coda non si
// svuotava e il report diceva che si era svuotata.
//
// ⚠️ E il contatore della pausa automatica era battuto dallo stesso silenzio,
// che è più grave: il commento di `recordWorkflowFailure` chiama «fallire
// diecimila volte» il difetto peggiore possibile su questo progetto, e la
// lettura del contatore scartava l'errore — quindi `failures` ripartiva da 1 a
// ogni giro e la soglia non arrivava mai.
{
  type Riga = Record<string, unknown>;
  /** Un client che fallisce le scritture (o le letture) su richiesta. */
  const sbScritture = (opts: { rompiUpdate?: boolean; rompiSelect?: boolean; riga?: Riga } = {}) => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      let scrivendo = false;
      for (const m of ['select', 'order', 'limit']) chain[m] = () => chain;
      for (const m of ['eq', 'neq', 'in', 'is']) chain[m] = () => chain;
      chain.update = () => { scrivendo = true; return chain; };
      chain.insert = () => { scrivendo = true; return chain; };
      chain.maybeSingle = async () => (opts.rompiSelect
        ? { data: null, error: { code: '57014', message: 'timeout' } }
        : { data: opts.riga ?? null, error: null });
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const rotto = scrivendo ? opts.rompiUpdate : opts.rompiSelect;
        return Promise.resolve(rotto
          ? { data: null, error: { code: '57014', message: 'timeout' } }
          : { data: [], error: null }).then(res, rej);
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  });

  const solleva = async (fn: () => Promise<unknown>): Promise<Error | null> => {
    try { await fn(); return null; } catch (e) { return e as Error; }
  };

  const quattro: [string, string, (sb: never) => Promise<void>][] = [
    ['eventDone', 'queue_done', (sb) => eventDone(sb, 'e-1', 'l-1')],
    ['eventRetry', 'queue_retry', (sb) => eventRetry(sb, 'e-1', 'l-1', 60, 'x')],
    ['eventFailed', 'queue_failed', (sb) => eventFailed(sb, 'e-1', 'l-1', 'x')],
    ['eventDeadLetter', 'queue_dead_letter', (sb) => eventDeadLetter(sb, 'e-1', 'l-1', 'x')],
  ];
  for (const [nome, codice, chiama] of quattro) {
    const e = await solleva(() => chiama(sbScritture({ rompiUpdate: true }) as never));
    ok(e !== null && e.message.startsWith(`${codice}:`),
      `⚠️ \`${nome}\` solleva con «${codice}» invece di lasciare la riga in coda a girare per sempre`,
      e ? e.message : 'nessuna eccezione: la scrittura fallita è passata inosservata');
    const buono = await solleva(() => chiama(sbScritture() as never));
    ok(buono === null, `…e sul cammino normale \`${nome}\` non solleva`, buono?.message);
  }

  // --- Il contatore della pausa automatica ---------------------------------
  {
    const e = await solleva(() => recordWorkflowFailure(sbScritture({ rompiSelect: true }) as never, 'w-1', 'x', 3));
    ok(e !== null && e.message.startsWith('workflow_failures_read:'),
      '⚠️⚠️ la LETTURA del contatore solleva: se tacesse, `failures` ripartirebbe da 1 a ogni giro e la pausa automatica non arriverebbe MAI — il difetto che quel meccanismo esiste per impedire',
      e ? e.message : 'nessuna eccezione');
  }
  {
    const e = await solleva(() => recordWorkflowFailure(
      sbScritture({ rompiUpdate: true, riga: { consecutive_failures: 0, status: 'active' } }) as never,
      'w-1', 'x', 3));
    ok(e !== null && e.message.startsWith('workflow_failures_write:'),
      '⚠️ e anche l\'INCREMENTO: perderlo in silenzio ferma il contatore sotto la soglia per sempre',
      e ? e.message : 'nessuna eccezione');
  }
  {
    // Alla soglia il gesto è un altro — la messa in pausa — e ha il suo codice.
    const e = await solleva(() => recordWorkflowFailure(
      sbScritture({ rompiUpdate: true, riga: { consecutive_failures: 5, status: 'active' } }) as never,
      'w-1', 'x', 3));
    ok(e !== null && e.message.startsWith('workflow_pause:'),
      '⚠️ alla soglia, la MESSA IN PAUSA fallita solleva: restituire «paused» su una regola rimasta attiva è peggio del guasto che descrive',
      e ? e.message : 'nessuna eccezione');
  }
  {
    const esito = await recordWorkflowFailure(
      sbScritture({ riga: { consecutive_failures: 0, status: 'active' } }) as never, 'w-1', 'x', 3);
    ok(esito === 'attention', 'e sul cammino normale il contatore sale e la regola chiede attenzione', esito);
  }
}

console.log(`\n${B}Risultato${X}  ${pass} superati, ${fail} falliti\n`);
process.exit(fail ? 1 : 0);
