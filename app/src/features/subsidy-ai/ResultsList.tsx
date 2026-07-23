import { Icon } from '@/components/ui/Icon';
import { EmptyCta } from '@/components/ui/states';
import { SUPPORT_TYPE_LABEL, labelSettore, type ProgramModel } from './programs';
import type { MatchResult } from './engine';
import type { Company } from '@/types/models';

function relClass(s: number) { return s >= 75 ? 'hi' : s >= 55 ? 'mid' : ''; }
function SupportChip({ prog }: { prog: ProgramModel }) {
  return <span className="ax-chip"><Icon name="banknote" className="ic-sm" /> {SUPPORT_TYPE_LABEL[prog.supportType]}</span>;
}

export function ResultsList({
  matches, company, sector, onOpen, onEditProfile,
}: {
  matches: MatchResult[];
  company: Company | null;
  sector: string | null;
  onOpen: (programId: string) => void;
  onEditProfile: () => void;
}) {
  const settoreLabel = labelSettore(sector);

  if (matches.length === 0) {
    return (
      <div className="card">
        <EmptyCta
          icon="banknote"
          title="Nessun programma rilevante con i criteri attuali"
          subtitle="Aggiungi ambiti di progetto o rivedi il settore nel profilo incentivi."
          action={<button className="btn btn-primary" onClick={onEditProfile}>Modifica profilo incentivi</button>}
        />
      </div>
    );
  }

  return (
    <>
      <div className="demo-banner">
        {matches.length} programmi <strong>rilevanti</strong> per <strong>{company?.legalName ?? 'la tua impresa'}</strong>
        {` (${company?.canton ?? '—'}${settoreLabel ? ', ' + settoreLabel : ''}). `}
        La <strong>Rilevanza</strong> indica quanto il programma sembra pertinente al progetto, <em>non</em> la probabilità di ottenere il contributo.
        L’idoneità va verificata programma per programma. <button type="button" className="btn-link" onClick={onEditProfile}>Modifica profilo</button>
      </div>

      {matches.map((m) => {
        const p = m.program;
        return (
          <div className="card prog-card" key={p.id}>
            <div className="prog-head">
              <div className={`rel-badge ${relClass(m.relevanceScore)}`}>
                <div className="rb-num">{m.relevanceScore}%</div><div className="rb-lbl">Rilevanza</div>
              </div>
              <div className="prog-main">
                <div className="prog-name">{p.name}</div>
                <div className="list-sub">{p.authority}</div>
                <div className="badge-row">
                  <SupportChip prog={p} />
                  <span className="badge badge-media">Idoneità: da verificare</span>
                  <span className="badge badge-neutral"><Icon name="calendar" className="ic-sm" /> {p.applicationWindow}</span>
                  {p.mustApplyBeforeStart && <span className="badge badge-alta"><Icon name="alert" className="ic-sm" /> Domanda prima di iniziare</span>}
                  <span className="badge badge-neutral">{m.reqToVerify} requisiti da verificare</span>
                  <span className={`badge badge-${m.priority.level}`}>Priorità {m.priority.level}</span>
                </div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => onOpen(p.id)}>Verifica idoneità <Icon name="arrowRight" className="ic-sm" /></button>
            </div>
          </div>
        );
      })}
    </>
  );
}
