// ============================================================================
// «Prossimo passo» — il riquadro in cima al dettaglio di un documento.
//
// Non aggiunge dati: rende ciò che `nextStep.ts` ha deciso, e tutte le
// decisioni stanno là perché una funzione pura si può provare e un componente
// no. Qui restano soltanto le etichette e il modo in cui si presentano.
//
// UNA SOLA AZIONE PRIMARIA, e le altre accanto in second'ordine: un riquadro
// con tre pulsanti dello stesso peso non dice che cosa fare, dice che ci sono
// tre cose da fare. Le azioni distruttive non compaiono qui in nessun caso.
//
// ⚠️ DAL 2026-08-11 I PULSANTI NON STANNO PIÙ DENTRO IL RIQUADRO.
// La schermata ha UNA riga di azioni sola, in cima (`.action-bar`), e questo
// file la rifornisce con `NextStepPrimary` e `NextStepSecondary`. Il riquadro
// resta la SPIEGAZIONE — in che situazione si trova il documento, i fatti su
// cui si sta per decidere, le avvertenze — e sta subito sotto la riga, così il
// pulsante e il suo perché si leggono insieme.
//
// La ragione è la stessa che ha prodotto questo file: prima «Analizza» viveva
// nel riquadro dell'analisi, «Crea attività» in fondo e altri quattro pulsanti
// in cima, tutti dello stesso peso. Riordinarli senza unificarli avrebbe solo
// spostato il problema: due punti che rendono la STESSA decisione prima o poi
// ne rendono due diverse. Il rendering dell'azione è uno, qui dentro.
// ============================================================================
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import { useT, type TFunction, type TKey } from '@/i18n';
import { formatDate } from '@/lib/format';
import type { NextStep, NextStepAction, NextStepChoice, NextStepKind } from './nextStep';

const KIND_KEY: Record<NextStepKind, TKey> = {
  processing: 'documents.nextStep.kindProcessing',
  none: 'documents.nextStep.kindNone',
  failed: 'documents.nextStep.kindFailed',
  has_tasks: 'documents.nextStep.kindHasTasks',
  to_verify: 'documents.nextStep.kindToVerify',
  ready: 'documents.nextStep.kindReady',
};

// ⚠️ `wait` non compare: è l'azione che NON si rende, e una chiave scritta per
// un testo che nessuno vedrà sarebbe testo morto in tre dizionari — la stessa
// trappola di `home.module` e `errorCreditExhausted`, tradotti e mai collegati.
const ACTION_KEY: Record<Exclude<NextStepAction, 'wait'>, TKey> = {
  analyze: 'documents.analyzeNow',
  retry_analysis: 'documents.retryAnalysis',
  verify_analysis: 'documents.nextStep.actionVerify',
  create_task: 'documents.createTask',
  create_another_task: 'documents.nextStep.actionCreateAnother',
  open_task: 'documents.nextStep.actionOpenTask',
  see_tasks: 'documents.nextStep.actionSeeTasks',
};

const ACTION_ICON: Record<Exclude<NextStepAction, 'wait'>, IconName> = {
  analyze: 'fileSearch', retry_analysis: 'refresh', verify_analysis: 'fileSearch',
  create_task: 'plus', create_another_task: 'plus', open_task: 'arrowRight',
  see_tasks: 'arrowRight',
};

export interface NextStepActionProps {
  step: NextStep;
  documentId: string;
  busy: boolean;
  /** Testo di avanzamento dell'analisi, quando ne è in corso una avviata da qui. */
  progress?: string | null;
  onAnalyze: () => void;
  /**
   * Apre il modulo di revisione, che vive nel blocco «Attività» più in basso.
   * ⚠️ Il modulo NON viene reso qui: due istanze sullo stesso schermo sarebbero
   * due moduli, cioè esattamente ciò che questo lavoro elimina.
   */
  onCreateTask: () => void;
}

/**
 * Un'azione del prossimo passo, come pulsante o come collegamento.
 * `primary` decide SOLO il peso visivo: quale scelta sia primaria lo ha già
 * deciso `nextStepFor`, e questa funzione non la rimette in discussione.
 */
function renderAction(
  choice: NextStepChoice,
  primary: boolean,
  { documentId, busy, progress, onAnalyze, onCreateTask }: NextStepActionProps,
  t: TFunction,
) {
  // Si esce PRIMA di comporre l'etichetta: `wait` non ha un pulsante, e
  // chiedere una traduzione per qualcosa che non si rende creerebbe una
  // stringa da tradurre in tre lingue e da non mostrare mai.
  if (choice.action === 'wait') return null;

  // ⚠️ La primaria NON è `btn-sm`: è l'unica azione primaria della schermata e
  // deve pesare più delle secondarie anche in altezza, non solo in colore.
  const cls = primary ? 'btn btn-primary' : 'btn btn-sm';
  const icon = ACTION_ICON[choice.action];
  const label = t(ACTION_KEY[choice.action]);
  const inner = (
    <>
      <Icon name={icon} className="ic-sm" /> {label}
    </>
  );

  switch (choice.action) {
    case 'analyze':
    case 'retry_analysis':
      return (
        <button key={choice.action} className={cls} onClick={onAnalyze} disabled={busy}
          aria-busy={busy || undefined}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name={icon} className="ic-sm" />}
          {' '}{progress ?? label}
        </button>
      );
    case 'verify_analysis':
      return <Link key={choice.action} className={cls} to={`/admin?doc=${documentId}`}>{inner}</Link>;
    case 'open_task':
      return <Link key={choice.action} className={cls} to={`/attivita/${choice.taskId}`}>{inner}</Link>;
    case 'see_tasks':
      // Le attività di questo documento sono più in basso NELLA STESSA
      // pagina: un collegamento interno ci porta senza inventare una rotta
      // filtrata che non esiste.
      return <a key={choice.action} className={cls} href="#doc-tasks">{inner}</a>;
    case 'create_task':
    case 'create_another_task':
      return (
        <button key={choice.action} className={cls} onClick={onCreateTask} disabled={busy}>
          {inner}
        </button>
      );
  }
}

/** L'azione del momento. È l'UNICA primaria della schermata. */
export function NextStepPrimary(props: NextStepActionProps) {
  const t = useT();
  return <>{renderAction(props.step.primary, true, props, t)}</>;
}

/** Le alternative del prossimo passo, tutte dello stesso peso. */
export function NextStepSecondary(props: NextStepActionProps) {
  const t = useT();
  return <>{props.step.secondary.map((s) => renderAction(s, false, props, t))}</>;
}

/**
 * La spiegazione: in che situazione si trova il documento, su che fatti si sta
 * per decidere, che cosa conviene sapere prima. È scheda ELEVATA (livello 1)
 * perché è una delle due cose che in questa pagina si leggono davvero — l'altra
 * è l'analisi. Tutto il resto si consulta, e sta su un blocco piano.
 */
export function NextStepCard({ step }: { step: NextStep }) {
  const t = useT();
  const { facts } = step;

  return (
    <div className="surface-1 mt-16">
      <div className="card-title">{t('documents.nextStep.title')}</div>

      {/* Lo stato è testo, mai solo un colore. `role="status"` perché mentre
          l'analisi lavora questo riquadro cambia da solo e chi non guarda lo
          schermo deve sentirlo. */}
      <div role="status">
        <p className="prose">{t(KIND_KEY[step.kind])}</p>

        {step.kind === 'processing' && (
          <p className="muted-sm prose"><span className="spinner" aria-hidden="true" /> {t('documents.analysisProcessing')}</p>
        )}
      </div>

      {/* I fatti su cui si sta per decidere. Compaiono solo dove esistono: una
          riga «Scadenza: —» non informa, occupa. */}
      {(facts.deadline || facts.sender || facts.stepsToCreate > 0) && (
        <dl className="detail-list">
          {facts.deadline && (
            <>
              <dt>{t('documents.deadline')}</dt>
              {/* La marcatura del termine: una data da verificare lo DICE con
                  il segno «?» e non conta giorni su una data incerta. */}
              <dd>
                <DeadlineMark date={facts.deadline} display={formatDate(facts.deadline)}
                  toVerify={facts.deadlineRequiresVerification} />
              </dd>
            </>
          )}
          {facts.sender && (<><dt>{t('documents.sender')}</dt><dd>{facts.sender}</dd></>)}
          {facts.stepsToCreate > 0 && (
            <>
              <dt>{t('documents.nextStep.stepsLabel')}</dt>
              <dd>
                {facts.stepsToCreate === 1
                  ? t('documents.nextStep.stepsOne')
                  : t('documents.nextStep.stepsMany', { n: facts.stepsToCreate })}
              </dd>
            </>
          )}
        </dl>
      )}

      {step.notices.length > 0 && (
        <ul className="stack-sm muted-sm prose mt-10">
          {step.notices.map((n) => <li key={n.key}>{t(n.key, n.params)}</li>)}
        </ul>
      )}
    </div>
  );
}
