import { Icon } from '@/components/ui/Icon';
import { EmptyCta } from '@/components/ui/states';
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
                <div className="badge-row">
                  <SupportChip prog={p} />
                  {/* 0011 — se il programma oggi non è concedibile lo si dice
                      subito, prima dei badge sull'idoneità: sarebbe fuorviante
                      invitare a "verificare l'idoneità" per qualcosa che
                      comunque non viene concesso. */}
                  {p.availability === 'suspended'
                    ? <span className="badge badge-alta"><Icon name="alert" className="ic-sm" /> {t('subsidy.results.suspended')}</span>
                    : <span className="badge badge-media">{t('subsidy.results.eligibilityToVerify')}</span>}
                  <span className="badge badge-neutral"><Icon name="calendar" className="ic-sm" /> {p.applicationWindow}</span>
                  {p.mustApplyBeforeStart && <span className="badge badge-alta"><Icon name="alert" className="ic-sm" /> {t('subsidy.results.applyBeforeStart')}</span>}
                  <span className="badge badge-neutral">{t('subsidy.results.requirementsToVerify', { n: m.reqToVerify })}</span>
                  <span className={`badge badge-${m.priority.level}`}>{t('subsidy.results.priority', { level: L.urgency(m.priority.level) })}</span>
                </div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => onOpen(p.id)}>{t('subsidy.results.checkEligibility')} <Icon name="arrowRight" className="ic-sm" /></button>
            </div>
          </div>
        );
      })}
    </>
  );
}
