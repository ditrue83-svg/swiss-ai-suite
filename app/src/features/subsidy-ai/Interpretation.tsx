// Pannello "interpretazione AI" del progetto: riepilogo + aree pertinenti (con
// evidence) + avviso tempistica. È una SPIEGAZIONE della pertinenza, NON una
// dichiarazione di idoneità (che resta deterministica e verificabile a valle).
// Riusato in ResultsList e ProgramDetail; nessuna classe CSS nuova.
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import type { ProjectInterpretation } from '@/types/models';

export function InterpretationPanel({ interpretation, showTimingWarning }: {
  interpretation: ProjectInterpretation;
  /** true quando il progetto risulta già avviato e c'è almeno un programma con
   *  domanda-prima-di-iniziare pertinente (calcolato dal chiamante). */
  showTimingWarning: boolean;
}) {
  const t = useT();
  const { summary, relevantAreas, timing } = interpretation;
  return (
    <div className="card">
      <div className="card-title"><Icon name="fileSearch" className="ic-sm" /> {t('subsidy.interpretation.title')}</div>

      {summary && <p className="mb-14">{summary}</p>}

      {relevantAreas.length > 0 && (
        <div className="result-row">
          <div className="result-label">{t('subsidy.interpretation.whyRelevant')}</div>
          <div>
            <ul className="detail-list ok">
              {relevantAreas.map((a, i) => (
                <li key={i}>
                  <strong>{a.area}</strong> — {a.reason}
                  {a.evidence?.verified && <span className="muted-sm"> «{a.evidence.quote}»</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showTimingWarning && (
        <div className="warn-box mt-14">
          <Icon name="alert" />
          <span>
            {t('subsidy.interpretation.alreadyStartedWarning')}
            {timing.evidence?.verified ? <> («{timing.evidence.quote}»)</> : null}
          </span>
        </div>
      )}

      <div className="muted-sm mt-12">
        Interpretazione automatica del testo che hai scritto: serve a trovare programmi <em>pertinenti</em>,
        non dichiara l’idoneità — che va verificata requisito per requisito e confermata dall’ente.
      </div>
    </div>
  );
}
