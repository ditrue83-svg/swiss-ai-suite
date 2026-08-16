import { useEffect, useRef, useState } from 'react';
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
 * ⚠️⚠️ MA SOLO DOVE C'È ALMENO UN SEGNO DA SPIEGARE. Su una schermata vuota —
 * Incentivi senza progetti, Documenti senza documenti — la legenda era l'unica
 * cosa in pagina: un glossario di nove famiglie sotto un elenco che non ne usa
 * nessuna. Una legenda senza mappa non insegna niente, occupa e basta.
 *
 * COME LO SA: contando i `.mark` renderizzati nella pagina, esclusi i propri.
 * ⚠️ E NON con una prop passata dalle undici schermate che la usano: sarebbero
 * undici posti in cui ricordarsi di aggiornare una condizione, cioè lo stesso
 * invecchiamento che l'iterazione sulle mappe (qui sopra) esiste per evitare.
 * Il DOM è l'unica fonte che non può mentire su ciò che è renderizzato davvero.
 * L'effetto non ha elenco di dipendenze di proposito: gira dopo OGNI render, che
 * è come i dati arrivano — la pagina si ridisegna quando la lista si popola, e
 * la legenda compare in quel momento. Lo stato si riscrive solo se il numero è
 * cambiato, quindi non si rincorre.
 *
 * Il termine non ha mappa iterabile (i suoi stati portano numeri): i quattro
 * esempi sono resi con le stesse classi e gli stessi glifi di DeadlineMark.
 */
const ELIGIBILITY_IN_LEGEND: EligibilityValue[] = ['unknown', 'likely', 'unlikely', 'ineligible'];
const SOURCE_IN_LEGEND: SourceState[] = ['fresh', 'aging', 'stale', 'unverified', 'demo'];
// La priorità ha due scale di dominio con gli STESSI tre segni: la legenda ne
// elenca una sola, altrimenti mostrerebbe «alta» due volte identica.
const PRIORITY_IN_LEGEND: TaskPriority[] = ['high', 'medium', 'low'];

/**
 * Quanti segni sono renderizzati nella pagina, esclusi quelli della legenda.
 *
 * ⚠️ `.mark` è la classe che TUTTE e nove le famiglie mettono sul proprio
 * `<span>` (ProvenanceMark, ConfidenceBadge, EligibilityMark, SourceStamp,
 * DeadlineMark, StatusMark, PriorityMark, WindowMark e le due forme
 * dell'origine): un segno nuovo la porta con sé e questo conteggio lo vede
 * senza una seconda modifica. `.mark-legend` NON corrisponde a `.mark` — sono
 * due token di classe diversi — ma i segni DENTRO la legenda sì, ed è per
 * quelli che serve il `closest`: senza, la legenda si terrebbe viva da sola.
 */
export function contaSegni(ambito: ParentNode): number {
  return [...ambito.querySelectorAll('.mark')]
    .filter((el) => !el.closest('.mark-legend')).length;
}

export function MarkLegend() {
  const t = useT();
  const ancora = useRef<HTMLDivElement>(null);
  const [segni, setSegni] = useState(0);

  useEffect(() => {
    // L'ambito è la regione di contenuto, non il documento: la barra laterale
    // non porta segni oggi, e il giorno in cui ne portasse uno non dovrebbe far
    // comparire la legenda in una pagina che non ne usa.
    const ambito = ancora.current?.closest('main') ?? document;
    const n = contaSegni(ambito);
    setSegni((prima) => (prima === n ? prima : n));
  });

  // ⚠️ L'ancora resta nell'albero anche da nascosta: serve a ritrovare il
  // proprio `<main>` al giro dopo. Un `return null` avrebbe tolto il punto di
  // riferimento e la legenda non sarebbe più ricomparsa quando i dati arrivano.
  if (segni === 0) return <div ref={ancora} hidden />;

  return (
    <div className="legend-foot" ref={ancora}>
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
          {/* ⚠️ UNA FAMIGLIA SUA, accanto al termine e non dentro. Le due
              portano entrambe delle cifre, e proprio per questo la legenda deve
              metterle una accanto all'altra: la differenza fra «fra 12 giorni»
              e «Appuntamento · fra 12 giorni» è tutto ciò che separa un lavoro
              da fare da un giorno in cui presentarsi. */}
          <div>
            <div className="ml-fam-title">{t('marks.legend.appointment')}</div>
            <div className="ml-item">
              <span className="mark mark-appt ma-future">
                <MarkGlyph name="pin" />{t('marks.appointment.label')} · {t('marks.appointment.inDays', { n: 12 })}
              </span>
            </div>
            <div className="ml-item">
              <span className="mark mark-appt ma-past">
                <MarkGlyph name="pin" />{t('marks.appointment.label')} · {t('marks.appointment.daysAgo', { n: 3 })}
              </span>
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
    </div>
  );
}
