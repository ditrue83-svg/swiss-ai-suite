// Subsidy AI — orchestratore a 3 tab: Profilo incentivi · Incentivi rilevanti · Le mie pratiche.
import { useMemo, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
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
        <div className="page-title">Swiss Subsidy AI</div>
        <div className="page-desc">
          Profilo aziendale → programmi <strong>rilevanti</strong> → verifica di <strong>idoneità</strong> con hard rule → pratica.
          Rilevanza e idoneità sono due cose distinte. Copertura: Confederazione + Cantone Ticino.
        </div>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'profile' ? ' active' : ''}`} onClick={() => { setTab('profile'); setSelectedProgramId(null); }}>1 · Profilo impresa</button>
        <button className={`tab${tab === 'results' ? ' active' : ''}`} onClick={() => { setTab('results'); setSelectedProgramId(null); }}>2 · Incentivi rilevanti</button>
        <button className={`tab${tab === 'cases' ? ' active' : ''}`} onClick={() => { setTab('cases'); setSelectedProgramId(null); }}>3 · Le mie pratiche</button>
      </div>

      {tab === 'profile' && <ProfileForm onSaved={(interp) => { setInterpretation(interp); setTab('results'); setSelectedProgramId(null); }} />}

      {tab === 'results' && (
        programsLoading && !programs ? (
          <div className="card mt-16"><span className="spinner" /> Caricamento dei programmi…</div>
        ) : programsError ? (
          <div className="card mt-16">
            <div className="warn-box">
              <Icon name="alert" />
              <span>
                <strong>Catalogo incentivi non disponibile.</strong> {programsError}<br />
                Non viene mostrato alcun risultato: significa che i programmi non sono stati caricati,
                <em> non</em> che non ce ne siano di rilevanti per la tua impresa.
              </span>
            </div>
            <div className="row-wrap mt-12">
              <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
                <Icon name="refresh" className="ic-sm" /> Riprova
              </button>
            </div>
          </div>
        ) : (programs && programs.length === 0) ? (
          <div className="card mt-16">
            <div className="warn-box">
              <Icon name="alert" />
              <span>
                <strong>Il catalogo dei programmi è vuoto.</strong> Nessun incentivo è stato caricato nel sistema,
                quindi non è possibile dire se la tua impresa sia idonea a qualcosa. Contatta il supporto.
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

      <div className="footnote">
        <strong>Programmi verificati sulle fonti ufficiali</strong> (con data di revisione). Alcuni dati cantonali sono marcati «da riverificare»
        perché variano per decreto. La «Rilevanza» misura la pertinenza al progetto, non la probabilità di ottenere il contributo; l’«Idoneità»
        è una stima basata sulle tue risposte e non sostituisce la valutazione dell’ente. Importi, requisiti e scadenze vanno sempre confermati sulla fonte ufficiale.
      </div>
    </>
  );
}
