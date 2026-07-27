// ============================================================================
// Il registro delle automazioni, visto dal browser.
//
// ⚠️ NON È UNA COPIA: È LO STESSO FILE.
// Il generatore di regole deve offrire esattamente i campi, gli operatori e le
// azioni che il motore accetterà, e il motore vive in una Edge Function. Due
// elenchi «tenuti allineati a mano» divergono al primo campo aggiunto da una
// parte sola, e la divergenza si vedrebbe come una regola che si può comporre e
// non si può attivare. Qui si importa il modulo canonico e basta.
//
// Perché è possibile: `_shared/automation/registry.ts` e i moduli che riesporta
// non hanno NESSUN import — né di Deno, né di npm, né del resto del progetto.
// Sono dati e funzioni pure. Se un domani qualcuno ci aggiungesse un
// `import … from 'npm:…'`, `npm run build` fallirebbe qui, ed è il posto giusto
// per accorgersene.
//
// (La stessa scelta NON è stata fatta per `runtime.ts`, `store.ts`, `engine.ts`
// e `executors.ts`, che parlano con il database e con Deno: quelli restano
// fuori dal bundle del browser.)
// ============================================================================
export * from '../../../supabase/functions/_shared/automation/registry.ts';
export * from '../../../supabase/functions/_shared/automation/contract.ts';
export {
  evaluateCondition, evaluateConditions, daysUntilDate,
  type ConditionResult, type Evaluation, type Outcome,
} from '../../../supabase/functions/_shared/automation/conditions.ts';
export {
  formatAmount, formatDate, placeholdersIn, renderRequired, renderTemplate,
  type RenderResult,
} from '../../../supabase/functions/_shared/automation/templates.ts';
export {
  validateWorkflow, type ValidationIssue,
} from '../../../supabase/functions/_shared/automation/validate.ts';
export {
  aiFact, emailDomain, known, missing, optional, uncertain, urgencyFrom,
  type Fact, type FactValue, type Facts,
} from '../../../supabase/functions/_shared/automation/facts.ts';
