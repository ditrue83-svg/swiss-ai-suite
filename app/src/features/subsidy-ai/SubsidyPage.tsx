// Subsidy AI — orchestratore a 3 tab: Profilo incentivi · Incentivi rilevanti · Le mie pratiche.
import { useMemo, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { useCompany } from '@/contexts/CompanyContext';
import { useAsync } from '@/hooks/useAsync';
import { programService } from '@/services/programService';
import { matchPrograms } from './engine';
import { buildMatchProfile } from '@/features/dashboard/overview';
import { ProfileForm } from './ProfileForm';
import { ResultsList } from './ResultsList';
import { ProgramDetail } from './ProgramDetail';
import { CasesList } from './CasesList';
import type { ProjectInterpretation } from '@/types/models';

type Tab = 'profile' | 'results' | 'cases';

export function SubsidyPage() {
  const t = useT();
  const { activeCompany, activeCompanyId, companyProfile } = useCompany();
  const companyId = activeCompanyId as string;

  // Catalogo reale dei programmi (dal DB), non più hardcoded.
  // L'errore NON va ignorato: un guasto di caricamento non è «nessun programma
  // rilevante» — sarebbe un fallback silenzioso, vietato dalla governance.
  const { data: programs, loading: programsLoading, error: programsError } = useAsync(() => programService.listActive(), [companyId]);

  const hasProjects = (companyProfile?.currentProjects.length ?? 0) > 0;
  const [tab, setTab] = useState<Tab>(hasProjects ? 'results' : 'profile');
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  // Interpretazione AI dell'ultima descrizione (transiente: non persistita).
  const [interpretation, setInterpretation] = useState<ProjectInterpretation | null>(null);

  const matches = useMemo(
    () => matchPrograms(buildMatchProfile(activeCompany, companyProfile), programs ?? []),
    [activeCompany, companyProfile, programs],
  );
  const selectedMatch = selectedProgramId ? matches.find((m) => m.program.id === selectedProgramId) ?? null : null;

  function openProgram(id: string) { setSelectedProgramId(id); window.scrollTo(0, 0); }

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('subsidy.title')}</div>
        <div className="page-desc">{t('subsidy.intro')}</div>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'profile' ? ' active' : ''}`} onClick={() => { setTab('profile'); setSelectedProgramId(null); }}>{t('subsidy.tabProfile')}</button>
        <button className={`tab${tab === 'results' ? ' active' : ''}`} onClick={() => { setTab('results'); setSelectedProgramId(null); }}>{t('subsidy.tabResults')}</button>
        <button className={`tab${tab === 'cases' ? ' active' : ''}`} onClick={() => { setTab('cases'); setSelectedProgramId(null); }}>{t('subsidy.tabCases')}</button>
      </div>

      {tab === 'profile' && <ProfileForm onSaved={(interp) => { setInterpretation(interp); setTab('results'); setSelectedProgramId(null); }} />}

      {tab === 'results' && (
        programsLoading && !programs ? (
          <div className="card mt-16"><span className="spinner" /> {t('subsidy.loadingPrograms')}</div>
        ) : programsError ? (
          <div className="card mt-16">
            <div className="warn-box">
              <Icon name="alert" />
              <span>
                <strong>{t('subsidy.catalogUnavailable')}</strong> {programsError}<br />
                {t('subsidy.catalogUnavailableSub')}
              </span>
            </div>
            <div className="row-wrap mt-12">
              <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
                <Icon name="refresh" className="ic-sm" /> {t('common.retry')}
              </button>
            </div>
          </div>
        ) : (programs && programs.length === 0) ? (
          <div className="card mt-16">
            <div className="warn-box">
              <Icon name="alert" />
              <span>
                <strong>{t('subsidy.catalogEmpty')}</strong> {t('subsidy.catalogEmptySub')}
              </span>
            </div>
          </div>
        ) : selectedMatch ? (
          <ProgramDetail
            match={selectedMatch}
            companyId={companyId}
            interpretation={interpretation}
            onBack={() => setSelectedProgramId(null)}
            onCreatedCase={() => { setSelectedProgramId(null); setTab('cases'); }}
          />
        ) : (
          <ResultsList
            matches={matches}
            company={activeCompany}
            sector={companyProfile?.sector ?? null}
            interpretation={interpretation}
            onOpen={openProgram}
            onEditProfile={() => setTab('profile')}
          />
        )
      )}

      {tab === 'cases' && <CasesList onGoResults={() => setTab(hasProjects ? 'results' : 'profile')} />}

      <div className="footnote">{t('subsidy.footnote')}</div>
    </>
  );
}
