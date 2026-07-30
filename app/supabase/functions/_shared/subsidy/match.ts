// ============================================================================
// IL MATCHING SERVER-SIDE — §76, §77.
//
// Nel modulo 1.0 il match era un `useMemo` nel browser: esisteva solo mentre
// qualcuno teneva la pagina aperta, non produceva niente di persistente, e
// nessun avviso poteva nascerne. Qui il match è un fatto che resta.
//
// ⚠️ L'IDEMPOTENZA È NELL'IMPRONTA, NON IN UN LEASE (§60, §79). Due esecuzioni
// sovrapposte del worker calcolano lo stesso fingerprint e la seconda scrittura
// viene respinta dall'indice unico `uq_subsidy_assessments_fingerprint`. È più
// solido di una prenotazione: un lease scaduto mentre il lavoro è ancora in
// corso lascerebbe passare il doppione, l'indice no.
//
// ⚠️ NON SI RIVALUTA TUTTO OGNI VOLTA (§78). Il flag `assessment_stale` è la
// coda: lo alzano i trigger quando cambia qualcosa che conta, e il worker
// lavora a lotti. Rivalutare l'intero catalogo per ogni azienda a ogni giro
// sarebbe la richiesta che non finisce mai.
// ============================================================================

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { assess } from './assess.ts';
import { computeRelevance } from './relevance.ts';
import { deriveNotStarted, mergeFacts, type Fact, type FactMap } from './facts.ts';
import { REASSESS_BATCH, SUBSIDY_ENGINE_VERSION } from './contract.ts';
import {
  loadAnswers, loadCompanyFacts, loadCurrentCalls, loadPublishedCatalog, loadActiveProjects,
  type CompanyFactsRow, type ProjectRow, type PublishedProgram,
} from './store.ts';

const certain = (value: Fact['value'], source: Fact['source'], reference?: string): Fact =>
  ({ value, source, confidence: 1, reference: reference ?? null });

/**
 * I fatti dell'impresa.
 *
 * ⚠️ `company.has_uid` è vero SOLO se l'IDI c'è ed è plausibile. Nel database
 * di produzione esiste già una riga con `uid_che = 'CHE'` — un valore rimasto
 * da un salvataggio incompleto — e trattarlo come «ha un IDI» renderebbe
 * soddisfatto un criterio su un dato che non identifica nessuno.
 */
export function companyFacts(c: CompanyFactsRow): FactMap {
  const out: FactMap = {};
  if (c.canton) out['company.canton'] = certain(c.canton, 'company_profile');
  out['company.country'] = certain(c.country ?? 'CH', 'company_profile');
  if (c.legalForm) out['company.legal_form'] = certain(c.legalForm, 'company_registry');
  if (c.sector) out['company.sector'] = certain(c.sector, 'company_profile');
  if (typeof c.employeeCount === 'number') {
    out['company.employee_count'] = certain(c.employeeCount, 'company_profile');
  }
  const uid = (c.uidChe ?? '').replace(/[^0-9]/g, '');
  out['company.has_uid'] = certain(uid.length === 9, 'company_registry', c.uidChe ?? undefined);
  if (typeof c.ownsProperty === 'boolean') {
    out['company.owns_property'] = certain(c.ownsProperty, 'company_profile');
  }
  if (typeof c.vehicleCount === 'number') {
    out['company.vehicle_count'] = certain(c.vehicleCount, 'company_profile');
  }
  return out;
}

/** I fatti del progetto. Battono quelli dell'impresa dove si sovrappongono. */
export function projectFacts(p: ProjectRow): FactMap {
  const out: FactMap = {};
  out['project.stage'] = certain(p.stage, 'project');
  out['project.types'] = certain(p.projectTypes, 'project');
  if (p.locationCanton) out['project.canton'] = certain(p.locationCanton, 'project');
  out['project.country'] = certain(p.locationCountry, 'project');
  if (p.sector) out['project.sector'] = certain(p.sector, 'project');
  if (p.budgetAmount != null) out['project.budget_amount'] = certain(p.budgetAmount, 'project');
  if (p.budgetCurrency) out['project.budget_currency'] = certain(p.budgetCurrency, 'project');
  if (p.estimatedStartDate) out['project.start_date'] = certain(p.estimatedStartDate, 'project');
  if (p.estimatedEndDate) out['project.end_date'] = certain(p.estimatedEndDate, 'project');
  if (typeof p.employeeImpact === 'number') {
    out['project.employee_impact'] = certain(p.employeeImpact, 'project');
  }
  if (typeof p.hasResearchPartner === 'boolean') {
    out['project.has_research_partner'] = certain(p.hasResearchPartner, 'project');
  }
  if (typeof p.hasInnovationPartner === 'boolean') {
    out['project.has_innovation_partner'] = certain(p.hasInnovationPartner, 'project');
  }
  if (typeof p.hasInternationalPartners === 'boolean') {
    out['project.has_international_partners'] = certain(p.hasInternationalPartners, 'project');
  }
  const notStarted = deriveNotStarted(p.stage);
  if (notStarted !== null) out['project.not_started'] = certain(notStarted, 'project');
  return out;
}

export interface MatchReport {
  projectsScanned: number;
  opportunitiesCreated: number;
  assessmentsWritten: number;
  assessmentsSkipped: number;
  errors: string[];
}

/**
 * Rivaluta i progetti di un lotto contro il catalogo pubblicato.
 *
 * ⚠️ Il PROGETTO viene prima del programma: si parte dai progetti attivi e per
 * ciascuno si guarda il catalogo, non il contrario. È l'ordine del principio
 * «PROGETTO PRIMA DEL PROGRAMMA», e ha una conseguenza concreta: un'impresa
 * senza progetti non riceve opportunità di progetto, e la schermata lo dice
 * invece di riempirsi di programmi generici.
 */
export async function runMatching(
  sb: SupabaseClient,
  opts: { companyId?: string | null; today: string; limit?: number; deadlineMs?: number; now?: () => number } = {
    today: new Date().toISOString().slice(0, 10),
  },
): Promise<MatchReport> {
  const report: MatchReport = {
    projectsScanned: 0, opportunitiesCreated: 0,
    assessmentsWritten: 0, assessmentsSkipped: 0, errors: [],
  };
  const now = opts.now ?? (() => Date.now());
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;

  const catalog = await loadPublishedCatalog(sb);
  if (catalog.length === 0) return report;

  const calls = await loadCurrentCalls(sb, catalog.map((c) => c.programId));
  const projects = await loadActiveProjects(sb, opts.companyId ?? null, opts.limit ?? REASSESS_BATCH);

  const factsByCompany = new Map<string, FactMap>();

  for (const project of projects) {
    if (now() > deadline) break;
    report.projectsScanned++;

    let cFacts = factsByCompany.get(project.companyId);
    if (!cFacts) {
      const row = await loadCompanyFacts(sb, project.companyId);
      cFacts = row ? companyFacts(row) : {};
      factsByCompany.set(project.companyId, cFacts);
    }

    const { facts, conflicts } = mergeFacts(cFacts, projectFacts(project));

    for (const prog of catalog) {
      if (now() > deadline) break;

      const relevance = computeRelevance({
        // ⚠️ Il cantone del PROGETTO viene prima di quello dell'impresa:
        //    un'impresa di Lugano che risana un capannone a Zugo non accede ai
        //    programmi ticinesi per quell'intervento.
        canton: project.locationCanton ?? (cFacts['company.canton']?.value as string ?? null),
        country: project.locationCountry ?? 'CH',
        sector: project.sector ?? (cFacts['company.sector']?.value as string ?? null),
        employeeCount: (cFacts['company.employee_count']?.value as number) ?? null,
        projectTypes: project.projectTypes,
        budgetAmount: project.budgetAmount,
        budgetCurrency: project.budgetCurrency,
        hasResearchPartner: project.hasResearchPartner,
        stage: project.stage,
      }, prog.relevance);

      if (!relevance) continue;

      const call = calls.get(prog.programId) ?? null;
      const answers = await loadAnswers(sb, project.companyId, project.id, prog.versionId);

      const result = assess({
        programVersionId: prog.versionId,
        rules: prog.rules,
        facts, conflicts, answers, relevance, call,
        checkedAt: {
          requirements: prog.lastCheckedAt,
          availability: prog.availabilityCheckedAt,
          call: call?.checkedAt ?? null,
        },
        today: opts.today,
      });

      // L'opportunità: si crea se non c'è, si aggiorna se c'è.
      const { data: existing, error: exErr } = await sb
        .from('subsidy_opportunities')
        .select('id, last_fingerprint, dismissed_at')
        .eq('project_id', project.id)
        .eq('program_version_id', prog.versionId)
        .maybeSingle();
      if (exErr) { report.errors.push(`opp_read:${exErr.message}`); continue; }

      let opportunityId = existing?.id ?? null;
      if (!opportunityId) {
        const { data: created, error: cErr } = await sb
          .from('subsidy_opportunities')
          .insert({
            company_id: project.companyId, project_id: project.id, kind: 'project',
            program_id: prog.programId, program_version_id: prog.versionId,
            call_id: call?.id ?? null,
          })
          .select('id').single();
        if (cErr || !created) { report.errors.push(`opp_insert:${cErr?.message ?? 'unknown'}`); continue; }
        opportunityId = created.id;
        report.opportunitiesCreated++;
      }

      // ⚠️ §60 — stessa impronta, nessuna valutazione nuova. Senza questo
      //    controllo la storia delle valutazioni si riempirebbe di righe
      //    identiche a ogni giro del worker, e il cambiamento vero non si
      //    distinguerebbe più dal rumore.
      if (existing?.last_fingerprint === result.fingerprint) {
        // Il flag va comunque abbassato: gli ingressi sono cambiati in qualcosa
        // che non conta, e lasciarlo alzato farebbe riprovare all'infinito.
        await sb.from('subsidy_opportunities')
          .update({ assessment_stale: false }).eq('id', opportunityId);
        report.assessmentsSkipped++;
        continue;
      }

      const { data: assessment, error: aErr } = await sb
        .from('subsidy_assessments')
        .insert({
          company_id: project.companyId, opportunity_id: opportunityId,
          program_version_id: prog.versionId, call_id: call?.id ?? null,
          relevance_level: result.relevanceLevel, relevance_score: result.relevanceScore,
          relevance_reasons: result.relevanceReasons,
          eligibility_status: result.eligibilityStatus,
          completeness: result.completeness, timing: result.timing,
          source_freshness: result.freshness,
          facts_used: Object.fromEntries(
            Object.entries(facts).map(([k, f]) => [k, { value: f.value, source: f.source, confidence: f.confidence }]),
          ),
          missing_facts: result.missingFacts,
          conflicts: result.conflicts,
          fingerprint: result.fingerprint,
          engine_version: SUBSIDY_ENGINE_VERSION,
          trigger_source: 'worker',
        })
        .select('id').single();

      if (aErr) {
        // ⚠️ Un conflitto sull'indice di impronta NON è un errore: significa
        //    che un'altra esecuzione ha già scritto la stessa valutazione. È
        //    l'idempotenza che funziona, e contarla fra gli errori farebbe
        //    sembrare rotto un worker che sta lavorando bene.
        if (aErr.code === '23505') { report.assessmentsSkipped++; continue; }
        report.errors.push(`assessment:${aErr.message}`);
        continue;
      }
      report.assessmentsWritten++;

      if (assessment && result.criteria.length) {
        const { error: crErr } = await sb.from('subsidy_criterion_results').insert(
          result.criteria.map((c) => ({
            company_id: project.companyId, assessment_id: assessment.id,
            rule_key: c.ruleKey, hardness: c.hardness, state: c.state,
            observed_value: c.observedValue, value_source: c.valueSource,
            reason_code: c.reasonCode, sort_order: c.sortOrder,
          })),
        );
        if (crErr) report.errors.push(`criteria:${crErr.message}`);
      }

      // ⚠️ IL CONTEGGIO DEI CRITERI APERTI LO SCRIVE IL WORKER, NON IL TRIGGER.
      //    `subsidy_assessment_applied` gira `after insert` sulla valutazione,
      //    cioè PRIMA che i criteri esistano: la sua sottointerrogazione
      //    troverebbe zero righe e ogni opportunità risulterebbe «senza criteri
      //    aperti» — cioè completa — proprio mentre non lo è. Il trigger
      //    resta perché serve quando i criteri sono zero davvero; il valore
      //    vero lo scrive qui chi i criteri li ha appena contati.
      const openCount = result.criteria.filter(
        (c) => c.state === 'unknown' || c.state === 'conflicting' || c.state === 'not_evaluable',
      ).length;
      const { error: uErr } = await sb.from('subsidy_opportunities')
        .update({ assessment_stale: false, open_criteria_count: openCount })
        .eq('id', opportunityId);
      if (uErr) report.errors.push(`opp_update:${uErr.message}`);
    }
  }

  return report;
}
