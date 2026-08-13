import { useT } from '../../i18n';
import { MarkGlyph } from './MarkGlyph';
import { ActionOriginMark, PROVENANCE_KINDS, type ProvenanceKind } from './ProvenanceMark';
import { CONFIDENCE_LEVELS } from './ConfidenceBadge';
import { ELIGIBILITY_STATES, type EligibilityValue } from './EligibilityMark';
import { SOURCE_STATES, type SourceState } from './SourceStamp';
import { TASK_STATES } from './StatusMark';
import { PRIORITY_LEVELS } from './PriorityMark';
import { WINDOW_STATES } from './WindowMark';
import type { Confidence, TaskPriority, TaskStatus } from '../../types/models';
import type { SubsidyCallStatus } from '../../types/database';

/**
 * LEGENDA DEI SEGNI — compatta e apribile: l'utente impara il sistema una
 * volta sola, poi la richiude. Itera sulle STESSE mappe esportate dai
 * componenti (PROVENANCE_KINDS, CONFIDENCE_LEVELS, …): uno stato aggiunto lì
 * compare qui senza una seconda modifica — la legenda non può invecchiare.
 *
 * ⚠️ È LA STESSA IN OGNI SCHERMATA CHE USA UN SEGNO, e mostra TUTTE le
 * famiglie, non solo quelle della pagina che si sta guardando: un vocabolario
 * che cambia da una schermata all'altra non è un vocabolario, è un elenco di
 * abitudini locali. Chi la apre in Attività impara anche il timbro della fonte,
 * e quando arriverà agli Incentivi lo riconoscerà.
 *
 * Il termine non ha mappa iterabile (i suoi stati portano numeri): i quattro
 * esempi sono resi con le stesse classi e gli stessi glifi di DeadlineMark.
 */
const ELIGIBILITY_IN_LEGEND: EligibilityValue[] = ['unknown', 'likely', 'unlikely', 'ineligible'];
const SOURCE_IN_LEGEND: SourceState[] = ['fresh', 'aging', 'stale', 'unverified', 'demo'];
// La priorità ha due scale di dominio con gli STESSI tre segni: la legenda ne
// elenca una sola, altrimenti mostrerebbe «alta» due volte identica.
const PRIORITY_IN_LEGEND: TaskPriority[] = ['high', 'medium', 'low'];

export function MarkLegend() {
  const t = useT();
  return (
    <details className="mark-legend">
      <summary>{t('marks.legend.title')}</summary>
      <div className="ml-grid">
        <div>
          <div className="ml-fam-title">{t('marks.legend.provenance')}</div>
          {(Object.keys(PROVENANCE_KINDS) as ProvenanceKind[]).map((k) => (
            <div className="ml-item" key={k}>
              <span className={`mark mark-prov ${PROVENANCE_KINDS[k].cls}`}>{t(PROVENANCE_KINDS[k].labelKey)}</span>
            </div>
          ))}
        </div>
        {/* Le stesse due forme, con le parole delle AZIONI: è la distinzione
            che decide se una cosa va fatta perché ce la chiedono o perché la
            proponiamo noi. Vedi ActionOriginMark. */}
        <div>
          <div className="ml-fam-title">{t('marks.legend.actionOrigin')}</div>
          <div className="ml-item"><ActionOriginMark source="extracted" /></div>
          <div className="ml-item"><ActionOriginMark source="suggested" /></div>
        </div>
        <div>
          <div className="ml-fam-title">{t('marks.legend.confidence')}</div>
          {(Object.keys(CONFIDENCE_LEVELS) as Confidence[]).map((k) => (
            <div className="ml-item" key={k}>
              <span className={`mark mark-conf ${CONFIDENCE_LEVELS[k].cls}`}>
                <MarkGlyph name={CONFIDENCE_LEVELS[k].glyph} />
                {t(CONFIDENCE_LEVELS[k].labelKey)}
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="ml-fam-title">{t('marks.legend.eligibility')}</div>
          {ELIGIBILITY_IN_LEGEND.map((k) => (
            <div className="ml-item" key={k}>
              <span className={`mark mark-elig ${ELIGIBILITY_STATES[k].cls}`}>
                <MarkGlyph name={ELIGIBILITY_STATES[k].glyph} />
                {t(ELIGIBILITY_STATES[k].labelKey)}
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="ml-fam-title">{t('marks.legend.source')}</div>
          {SOURCE_IN_LEGEND.map((k) => (
            <div className="ml-item" key={k}>
              <span className={`mark mark-src ${SOURCE_STATES[k].cls}`}>
                <MarkGlyph name={SOURCE_STATES[k].glyph} />
                {t(SOURCE_STATES[k].labelKey)}
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="ml-fam-title">{t('marks.legend.deadline')}</div>
          <div className="ml-item">
            <span className="mark mark-due md-days"><MarkGlyph name="arrow" />{t('marks.deadline.inDays', { n: 12 })}</span>
          </div>
          <div className="ml-item">
            <span className="mark mark-due md-over"><MarkGlyph name="bang" />{t('marks.deadline.overdue', { n: 3 })}</span>
          </div>
          <div className="ml-item">
            <span className="mark mark-due md-none"><MarkGlyph name="dash" />{t('marks.deadline.none')}</span>
          </div>
          <div className="ml-item">
            <span className="mark mark-due md-verify"><MarkGlyph name="question" />{t('marks.deadline.toVerify')}</span>
          </div>
        </div>
        <div>
          <div className="ml-fam-title">{t('marks.legend.state')}</div>
          {(Object.keys(TASK_STATES) as TaskStatus[]).map((k) => (
            <div className="ml-item" key={k}>
              <span className={`mark mark-state ${TASK_STATES[k].cls}`}>
                <MarkGlyph name={TASK_STATES[k].glyph} />
                {t(TASK_STATES[k].labelKey)}
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="ml-fam-title">{t('marks.legend.priority')}</div>
          {PRIORITY_IN_LEGEND.map((k) => (
            <div className="ml-item" key={k}>
              <span className={`mark mark-prio ${PRIORITY_LEVELS[k].cls}`}>
                <MarkGlyph name={PRIORITY_LEVELS[k].glyph} />
                {t(PRIORITY_LEVELS[k].labelKey)}
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="ml-fam-title">{t('marks.legend.window')}</div>
          {(Object.keys(WINDOW_STATES) as SubsidyCallStatus[]).map((k) => (
            <div className="ml-item" key={k}>
              <span className={`mark mark-win ${WINDOW_STATES[k].cls}`}>
                <MarkGlyph name={WINDOW_STATES[k].glyph} />
                {t(WINDOW_STATES[k].labelKey)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
