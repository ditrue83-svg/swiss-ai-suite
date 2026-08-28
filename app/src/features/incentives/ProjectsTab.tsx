// ============================================================================
// Scheda 2 — PROGETTI. «Di che cosa stiamo parlando».
//
// §29 — il modulo 1.0 teneva i progetti in `company_profiles.current_projects`:
// un array di stringhe come `['innovazione','energia']`. Con quello si poteva
// rispondere «l'azienda si occupa anche di energia», non «questo progetto da
// CHF 180'000 con la SUPSI, che parte a settembre e non è ancora iniziato».
// Senza un progetto non esiste una domanda a cui il catalogo possa rispondere,
// e questa è la scheda che la formula.
//
// ⚠️ I CAMPI SONO SOLO QUELLI CHE IL MOTORE USA DAVVERO (§98). Un modulo da
//    trenta campi non lo compila nessuno, e i campi vuoti non valutano niente.
//    Ciò che serve a un criterio specifico si chiede quando quel criterio
//    compare, e la risposta finisce in `subsidy_answers`.
//
// ⚠️ I TRE BOOLEANI SONO A TRE VALORI: sì · no · non lo so. «Non lo so» è il
//    valore predefinito e NON è «no»: un criterio su un fatto ignoto resta
//    `unknown`, non «non soddisfatto». Una casella di spunta a due stati
//    trasformerebbe ogni campo non compilato in una negazione — cioè
//    renderebbe non idonea un'impresa di cui non sappiamo abbastanza.
//
// ⚠️ UN PROGETTO NON SI CANCELLA, SI ARCHIVIA. Non esiste alcun `delete` sulla
//    tabella: cancellarlo porterebbe via opportunità, valutazioni e — a
//    cascata — il legame delle pratiche che ne sono nate.
// ============================================================================
import { useState } from 'react';
import { Tag } from '@/components/ui/Tag';
import { Icon } from '@/components/ui/Icon';
import { Button, EmptyCta, ErrorState, SkeletonCard } from '@/components/ui/states';
import { Input, Select, Textarea } from '@/components/ui/forms';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { formatCurrency, formatDate } from '@/lib/format';
import { incentivesService } from '@/services/incentivesService';
import { SWISS_CANTONS } from '@/features/crm/crmModel';
import type { SubsidyProjectStage } from '@/types/database';
import type { IncentiveProject } from '@/types/models';
import {
  PROJECT_STAGES, STAGE_KEY, SUBSIDY_PROJECT_TYPES, SUBSIDY_SECTORS,
  subsidyErrorKey, validateProject,
} from './incentivesModel';
import styles from './incentives.module.css';

interface Props {
  companyId: string;
  projects: IncentiveProject[];
  showArchived: boolean;
  loading: boolean;
  onShowArchived: (v: boolean) => void;
  onChanged: () => void;
  onOpenOpportunities: (projectId: string) => void;
}

export function ProjectsTab({
  companyId, projects, showArchived, loading, onShowArchived, onChanged, onOpenOpportunities,
}: Props) {
  const t = useT();
  const L = useLabels();
  const [editing, setEditing] = useState<IncentiveProject | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = showArchived ? projects : projects.filter((p) => p.status === 'active');

  function messageOf(e: unknown): string {
    const key = subsidyErrorKey(e);
    return key ? t(key) : (e instanceof Error ? e.message : String(e));
  }

  async function setArchived(p: IncentiveProject, archived: boolean) {
    setBusyId(p.id);
    try {
      await incentivesService.setProjectArchived(p.id, archived);
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusyId(null);
    }
  }

  if (editing) {
    return (
      <ProjectForm
        companyId={companyId}
        project={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); onChanged(); }}
      />
    );
  }

  return (
    <>
      <div className="ct-toolbar">
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          {t('incentives.projects.add')}
        </Button>
        <label className="check-pill">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onShowArchived(e.target.checked)}
          />
          {t('incentives.projects.showArchived')}
        </label>
      </div>

      {error && <ErrorState message={error} />}

      {loading && projects.length === 0 ? (
        <SkeletonCard />
      ) : visible.length === 0 ? (
        <EmptyCta
          icon="banknote"
          title={t('incentives.projects.emptyTitle')}
          subtitle={t('incentives.projects.emptySub')}
          action={
            <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
              <Icon name="plus" className="ic-sm" /> {t('incentives.projects.add')}
            </button>
          }
        />
      ) : (
        <div className="card">
          {visible.map((p) => (
            <div key={p.id} className="list-row">
              <div className="list-main">
                <div className="list-title">
                  {p.title}
                  {p.status === 'archived' && (
                    <> <Tag>{t('incentives.projects.archived')}</Tag></>
                  )}
                </div>
                <div className="list-sub">
                  {t(STAGE_KEY[p.stage])}
                  {p.locationCanton && <> · {p.locationCanton}</>}
                  {p.sector && <> · {L.sector(p.sector)}</>}
                  {/* ⚠️ L'importo si scrive SOLO con la valuta: `formatCurrency`
                      torna il numero nudo quando la valuta manca, e nessun CHF
                      si aggiunge d'ufficio perché l'app è svizzera. */}
                  {p.budgetAmount !== null && (
                    <> · {formatCurrency(p.budgetAmount, p.budgetCurrency)}</>
                  )}
                </div>
                <div className="list-sub">
                  {t('incentives.projects.counts', {
                    opportunities: p.opportunityCount,
                    high: p.highRelevanceCount,
                  })}
                  {p.staleCount > 0 && <> · {t('incentives.projects.stale', { n: p.staleCount })}</>}
                </div>
                {p.projectTypes.length > 0 && (
                  <div className="badge-row">
                    {p.projectTypes.map((tp) => (
                      <Tag key={tp}>{L.projectType(tp)}</Tag>
                    ))}
                  </div>
                )}
              </div>
              <div className={styles.incRowSide}>
                {p.opportunityCount > 0 && (
                  <button type="button" className="mini-btn" onClick={() => onOpenOpportunities(p.id)}>
                    {t('incentives.projects.seeOpportunities')}
                  </button>
                )}
                <button type="button" className="mini-btn" onClick={() => setEditing(p)}>
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={busyId === p.id}
                  onClick={() => void setArchived(p, p.status !== 'archived')}
                >
                  {p.status === 'archived'
                    ? t('incentives.projects.restore')
                    : t('incentives.projects.archive')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Il modulo
// ---------------------------------------------------------------------------
type Tri = 'yes' | 'no' | 'unknown';

function triToBool(v: Tri): boolean | null {
  return v === 'yes' ? true : v === 'no' ? false : null;
}
function boolToTri(v: boolean | null): Tri {
  return v === true ? 'yes' : v === false ? 'no' : 'unknown';
}

function ProjectForm({
  companyId, project, onCancel, onSaved,
}: {
  companyId: string; project: IncentiveProject | null;
  onCancel: () => void; onSaved: () => void;
}) {
  const t = useT();
  const L = useLabels();
  const [title, setTitle] = useState(project?.title ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [stage, setStage] = useState<SubsidyProjectStage>(project?.stage ?? 'idea');
  const [canton, setCanton] = useState(project?.locationCanton ?? '');
  const [sector, setSector] = useState(project?.sector ?? '');
  const [startDate, setStartDate] = useState(project?.estimatedStartDate ?? '');
  const [endDate, setEndDate] = useState(project?.estimatedEndDate ?? '');
  const [amount, setAmount] = useState(project?.budgetAmount === null || project === null ? '' : String(project.budgetAmount));
  const [currency, setCurrency] = useState(project?.budgetCurrency ?? '');
  const [employees, setEmployees] = useState(
    project?.employeeImpact === null || project === null ? '' : String(project.employeeImpact),
  );
  const [research, setResearch] = useState<Tri>(boolToTri(project?.hasResearchPartner ?? null));
  const [innovation, setInnovation] = useState<Tri>(boolToTri(project?.hasInnovationPartner ?? null));
  const [international, setInternational] = useState<Tri>(boolToTri(project?.hasInternationalPartners ?? null));
  const [types, setTypes] = useState<string[]>(project?.projectTypes ?? []);
  const [goals, setGoals] = useState(project?.goals ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleType(tp: string) {
    setTypes((cur) => (cur.includes(tp) ? cur.filter((x) => x !== tp) : [...cur, tp]));
  }

  /** Numero da campo di testo: vuoto = `null`, non zero. */
  function parseNumber(raw: string): number | null {
    const s = raw.trim().replace(/'/g, '').replace(/\s/g, '');
    if (s === '') return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  async function submit() {
    const budgetAmount = parseNumber(amount);
    const draft = {
      title,
      budgetAmount,
      budgetCurrency: currency.trim().toUpperCase() || null,
      estimatedStartDate: startDate || null,
      estimatedEndDate: endDate || null,
    };
    // ⚠️ Si valida PRIMA di chiamare il server: il trigger garantisce, questa
    // funzione spiega. Senza, un importo senza valuta tornerebbe come `23514`.
    const problem = validateProject(draft);
    if (problem) { setError(t(problem)); return; }

    setBusy(true);
    setError(null);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      stage,
      location_canton: canton || null,
      sector: sector || null,
      estimated_start_date: startDate || null,
      estimated_end_date: endDate || null,
      budget_amount: budgetAmount,
      budget_currency: draft.budgetCurrency,
      employee_impact: parseNumber(employees),
      has_research_partner: triToBool(research),
      has_innovation_partner: triToBool(innovation),
      has_international_partners: triToBool(international),
      project_types: types,
      goals: goals.trim() || null,
    };
    try {
      if (project) await incentivesService.updateProject(project.id, payload);
      else await incentivesService.createProject(companyId, { ...payload, company_id: companyId });
      onSaved();
    } catch (e) {
      const key = subsidyErrorKey(e);
      setError(key ? t(key) : (e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        {project ? t('incentives.projects.editTitle') : t('incentives.projects.newTitle')}
      </div>
      <p className="muted-sm">{t('incentives.projects.formHint')}</p>

      {error && <div className="form-error mt-8">{error}</div>}

      <div className="mt-12">
        <Input
          id="pr-title"
          label={t('incentives.projects.fieldTitle')}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="mt-8">
        <Textarea
          id="pr-desc"
          label={t('incentives.projects.fieldDescription')}
          hint={t('incentives.projects.descriptionHint')}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="grid-2 mt-8">
        <Select
          id="pr-stage"
          label={t('incentives.projects.fieldStage')}
          hint={t('incentives.projects.stageHint')}
          value={stage}
          onChange={(e) => setStage(e.target.value as SubsidyProjectStage)}
        >
          {PROJECT_STAGES.map((s) => <option key={s} value={s}>{t(STAGE_KEY[s])}</option>)}
        </Select>
        {/* §71 — moltissimi programmi richiedono che la domanda preceda
            l'avvio, e un progetto già iniziato non li perde per un dettaglio:
            li perde del tutto. Per questo lo stadio si dichiara, e un
            progetto avviato non nasconde il programma — lo segnala. */}
        <Select
          id="pr-canton"
          label={t('incentives.projects.fieldCanton')}
          hint={t('incentives.projects.cantonHint')}
          value={canton}
          onChange={(e) => setCanton(e.target.value)}
        >
          <option value="">{t('incentives.projects.notSpecified')}</option>
          {SWISS_CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        {/* Dove si REALIZZA, che può differire dalla sede: un'impresa
            ticinese con un impianto a Zugo non accede ai programmi ticinesi
            per quell'impianto. */}
      </div>

      <div className="grid-2 mt-8">
        <Select
          id="pr-sector"
          label={t('incentives.projects.fieldSector')}
          value={sector}
          onChange={(e) => setSector(e.target.value)}
        >
          <option value="">{t('incentives.projects.notSpecified')}</option>
          {SUBSIDY_SECTORS.map((s) => <option key={s} value={s}>{L.sector(s)}</option>)}
        </Select>
        <Input
          id="pr-employees"
          label={t('incentives.projects.fieldEmployees')}
          hint={t('incentives.projects.employeesHint')}
          inputMode="numeric"
          value={employees}
          onChange={(e) => setEmployees(e.target.value)}
        />
      </div>

      <div className="grid-2 mt-8">
        <Input
          id="pr-start"
          label={t('incentives.projects.fieldStart')}
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          id="pr-end"
          label={t('incentives.projects.fieldEnd')}
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>

      <div className="grid-2 mt-8">
        <Input
          id="pr-amount"
          label={t('incentives.projects.fieldBudget')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          id="pr-currency"
          label={t('incentives.projects.fieldCurrency')}
          hint={t('incentives.projects.currencyHint')}
          maxLength={3}
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
        />
        {/* §67 — nessuna conversione e nessun CHF d'ufficio: un importo senza
            valuta non è un importo, e il database lo rifiuta. */}
      </div>

      <div className="field mt-8">
        <span className="group-label">{t('incentives.projects.fieldTypes')}</span>
        <div className="row-wrap" role="group" aria-label={t('incentives.projects.fieldTypes')}>
          {SUBSIDY_PROJECT_TYPES.map((tp) => (
            <button
              key={tp}
              type="button"
              aria-pressed={types.includes(tp)}
              className={`check-pill${types.includes(tp) ? ' on' : ''}`}
              onClick={() => toggleType(tp)}
            >
              {L.projectType(tp)}
            </button>
          ))}
        </div>
        <div className="field-hint">{t('incentives.projects.typesHint')}</div>
      </div>

      {/* I tre fatti che decidono l'accesso a interi programmi. A TRE valori. */}
      <div className="crm-sec">
        <div className="section-title">{t('incentives.projects.partners')}</div>
        <p className="muted-sm">{t('incentives.projects.partnersHint')}</p>
        <TriField
          id="pr-research"
          label={t('incentives.projects.researchPartner')}
          value={research}
          onChange={setResearch}
        />
        <TriField
          id="pr-innovation"
          label={t('incentives.projects.innovationPartner')}
          value={innovation}
          onChange={setInnovation}
        />
        <TriField
          id="pr-international"
          label={t('incentives.projects.internationalPartners')}
          value={international}
          onChange={setInternational}
        />
      </div>

      <div className="mt-8">
        <Textarea
          id="pr-goals"
          label={t('incentives.projects.fieldGoals')}
          rows={3}
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
        />
      </div>

      <div className="row-wrap mt-16">
        <Button variant="primary" loading={busy} onClick={() => void submit()}>
          {project ? t('common.save') : t('incentives.projects.create')}
        </Button>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

/**
 * Un fatto a TRE valori.
 *
 * ⚠️ Il valore predefinito è «non lo so» e non «no». La differenza non è
 * cosmetica: `false` dice al motore che il partner NON c'è — e su un programma
 * che lo richiede diventa un criterio non soddisfatto — mentre `null` lascia
 * il criterio `unknown`, che è la verità finché nessuno ha risposto.
 */
function TriField({
  id, label, value, onChange,
}: { id: string; label: string; value: Tri; onChange: (v: Tri) => void }) {
  const t = useT();
  const OPTIONS: Array<{ v: Tri; key: TKey }> = [
    { v: 'yes', key: 'common.yes' },
    { v: 'no', key: 'common.no' },
    { v: 'unknown', key: 'common.dontKnow' },
  ];
  return (
    <div className="field mt-8">
      <span className="group-label" id={`${id}-label`}>{label}</span>
      <div className="quiz-opts" role="group" aria-labelledby={`${id}-label`}>
        {OPTIONS.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={value === o.v}
            className={`quiz-opt${value === o.v ? (o.v === 'yes' ? ' sel-si' : o.v === 'no' ? ' sel-no' : ' sel-ns') : ''}`}
            onClick={() => onChange(o.v)}
          >
            {t(o.key)}
          </button>
        ))}
      </div>
    </div>
  );
}
