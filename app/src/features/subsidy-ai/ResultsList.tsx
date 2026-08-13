import { Icon } from '@/components/ui/Icon';
import { EmptyCta } from '@/components/ui/states';
import { EligibilityMark } from '@/components/ui/EligibilityMark';
import { SourceStamp } from '@/components/ui/SourceStamp';
import { PriorityMark } from '@/components/ui/PriorityMark';
import { WindowMark } from '@/components/ui/WindowMark';
import { MarkLegend } from '@/components/ui/MarkLegend';
import type { ProgramModel } from './programs';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import type { MatchResult } from './engine';
import { InterpretationPanel } from './Interpretation';
import type { Company, ProjectInterpretation } from '@/types/models';

function relClass(s: number) { return s >= 75 ? 'hi' : s >= 55 ? 'mid' : ''; }
function SupportChip({ prog }: { prog: ProgramModel }) {
  const L = useLabels();
  return <span className="ax-chip"><Icon name="banknote" className="ic-sm" /> {L.supportType(prog.supportType)}</span>;
}

export function ResultsList({
  matches, company, sector, interpretation, onOpen, onEditProfile,
}: {
  matches: MatchResult[];
  company: Company | null;
  sector: string | null;
  interpretation: ProjectInterpretation | null;
  onOpen: (programId: string) => void;
  onEditProfile: () => void;
}) {
  const t = useT();
  const L = useLabels();
  const settoreLabel = sector ? L.sector(sector) : '';

  // Spiegazione AI (se disponibile): riepilogo + pertinenza + avviso tempistica
  // quando il progetto risulta già avviato e c'è un programma con domanda-prima.
  const panel = interpretation
    ? <InterpretationPanel
        interpretation={interpretation}
        showTimingWarning={interpretation.timing.alreadyStarted === true && matches.some((m) => m.program.mustApplyBeforeStart)} />
    : null;

  if (matches.length === 0) {
    return (
      <>
        {panel}
        <div className="card">
          <EmptyCta
            icon="banknote"
            title={t('subsidy.results.emptyTitle')}
            subtitle={t('subsidy.results.emptySub')}
            action={<button className="btn btn-primary" onClick={onEditProfile}>{t('subsidy.results.editProfileFull')}</button>}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {panel}
      <div className="demo-banner">
        {t('subsidy.results.summary', {
          n: matches.length,
          company: company?.legalName ?? t('subsidy.results.yourCompany'),
          context: `${company?.canton ?? '—'}${settoreLabel ? ', ' + settoreLabel : ''}`,
        })}{' '}
        {t('subsidy.results.relevanceNote')}{' '}
        <button type="button" className="btn-link" onClick={onEditProfile}>{t('subsidy.results.editProfile')}</button>
      </div>

      {matches.map((m) => {
        const p = m.program;
        return (
          <div className="card prog-card" key={p.id}>
            <div className="prog-head">
              <div className={`rel-badge ${relClass(m.relevanceScore)}`}>
                <div className="rb-num">{m.relevanceScore}%</div><div className="rb-lbl">{t('subsidy.results.relevance')}</div>
              </div>
              <div className="prog-main">
                <div className="prog-name">{p.name}</div>
                <div className="list-sub">{p.authority}</div>
                {/* Due pastiglie, non sei. Prima ce n'erano sei con quattro
                    colori diversi, e una conteneva una frase intera di due
                    righe: una pastiglia serve a etichettare uno stato, non a
                    contenere un periodo. Restano pastiglia le due cose che
                    cambiano cosa fai — se il programma è concedibile e se la
                    domanda va presentata prima di iniziare — mentre tipo di
                    sostegno, requisiti, priorità e finestra di candidatura
                    diventano testo. */}
                <div className="badge-row">
                  {/* 0011 — se il programma oggi non è concedibile lo si dice
                      subito: sarebbe fuorviante invitare a «verificare
                      l'idoneità» per qualcosa che comunque non viene concesso.
                      ⚠️ È un FATTO DICHIARATO, non una marcatura: la
                      concedibilità di un programma non è la sua finestra di
                      candidatura né un giudizio d'idoneità, e prendere in
                      prestito il segno di una famiglia vicina direbbe una cosa
                      falsa con più autorevolezza. Cambia solo il colore, che
                      era il rosso degli errori. */}
                  {p.availability === 'suspended'
                    ? <span className="decl-flag"><Icon name="alert" className="ic-sm" /> {t('subsidy.results.suspended')}</span>
                    /* Prima del questionario l'idoneità è per definizione da
                       verificare: è il segno di famiglia, non una pastiglia
                       ambra identica a quella delle scadenze. */
                    : <EligibilityMark status="unknown" />}
                  {p.mustApplyBeforeStart && <span className="decl-flag"><Icon name="alert" className="ic-sm" /> {t('subsidy.results.applyBeforeStart')}</span>}
                  {/* La freschezza della fonte era visibile solo nel dettaglio:
                      la scheda invitava a «verificare l'idoneità» senza dire su
                      che dato. Gli stati dell'1.0 sono tre e si mappano sui
                      segni condivisi col 2.0, come già fa ProgramDetail. */}
                  <SourceStamp state={p.dataStatus === 'verified' ? 'fresh' : p.dataStatus === 'recheck' ? 'aging' : 'demo'} />
                </div>
                <div className="prog-meta">
                  <SupportChip prog={p} />
                  <span>{t('subsidy.results.requirementsToVerify', { n: m.reqToVerify })}</span>
                  <span className="mark-field">{t('marks.legend.priority')} <PriorityMark level={m.priority.level} /></span>
                </div>
                {/* ⚠️ LA FINESTRA DELL'1.0 È UNA FRASE, non uno stato: il
                    catalogo dice «domande entro il 31.03 di ogni anno» e nessuno
                    ha controllato oggi se sia davvero aperta. Il segno lo DICHIARA
                    («la fonte non lo dice») invece di lasciare che una data
                    scritta sembri una finestra aperta. */}
                <div className="prog-window">
                  <WindowMark status="unknown" />
                  <span>{p.applicationWindow}</span>
                </div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => onOpen(p.id)}>{t('subsidy.results.checkEligibility')} <Icon name="arrowRight" className="ic-sm" /></button>
            </div>
          </div>
        );
      })}

      {/* La legenda dei segni: la stessa di Documenti, Attività e Incentivi. */}
      <div className="card"><MarkLegend /></div>
    </>
  );
}
