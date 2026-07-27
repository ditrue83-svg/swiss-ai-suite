// ============================================================================
// Il dettaglio di UN'ESECUZIONE: perché la regola ha agito, e che cosa ha fatto.
//
// ⚠️ È LA PAGINA CHE RENDE L'AUTOMAZIONE VERIFICABILE.
// Un'attività comparsa da sola senza una spiegazione è indistinguibile da un
// errore. Qui si vede la condizione per condizione — «✓ Categoria = Imposte»,
// «✗ Urgenza = alta» — e azione per azione, con l'esito.
//
// ⚠️ NON SI MOSTRANO CODICI TECNICI (§50). «L'attività esisteva già, quindi non
// è stata duplicata» dice a una persona ciò che è successo; `PGRST23505` le
// dice soltanto che il sistema parla un'altra lingua. Il dettaglio tecnico
// resta nei log del server, dove serve a chi sta cercando un guasto.
//
// ⚠️ SI LEGGE LA CONFIGURAZIONE DELLA RUN, NON QUELLA DI ADESSO (§46).
// Se la regola è cambiata dopo, questa pagina continua a raccontare quella che
// ha davvero eseguito: altrimenti mostrerebbe azioni mai eseguite e
// nasconderebbe quelle che lo sono state.
// ============================================================================
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { automationService } from '@/services/automationService';
import { documentHubService } from '@/services/documentHubService';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT, type TKey } from '@/i18n';
import { relativeTime } from '@/features/notifications/notificationFormat';
import { useMembers } from '@/features/tasks/useMembers';
import {
  actionOutcomeKey, actionStatusLabelKey, conditionReasonKey, describeCondition,
  entityLink, findAction, findTrigger, runStatusLabelKey, type NameResolver,
} from './automationModel';
import type { DocumentTag, WorkflowCondition } from '@/types/models';
import type { ActionKey } from './registry';

export function RunDetailPage() {
  const t = useT();
  const { localeTag } = useI18n();
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { activeCompanyId, isAdmin } = useCompany();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;
  const { byId } = useMembers();
  const [busy, setBusy] = useState(false);

  const { loading, error, data: run, reload } = useAsync(
    () => (runId ? automationService.run(runId) : Promise.resolve(null)), [runId],
  );
  const { data: actionRuns, reload: reloadActions } = useAsync(
    () => (runId ? automationService.actionRuns(runId) : Promise.resolve([])), [runId],
  );
  const { data: tags } = useAsync(() => documentHubService.listTags(companyId), [companyId]);

  const names: NameResolver = {
    member: (userId) => {
      if (!userId) return t('tasks.unassigned');
      const m = byId.get(userId);
      return m ? (m.name || t('tasks.unnamedMember')) : t('tasks.unknownMember');
    },
    tag: (tagId) => (tags ?? []).find((g: DocumentTag) => g.id === tagId)?.name ?? t('automations.unknownTag'),
  };

  async function retry() {
    if (!runId || busy) return;
    setBusy(true);
    try {
      await automationService.retryRun(companyId, runId);
      showToast(t('automations.retryQueued'));
      reload();
      reloadActions();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="card mt-16"><SkeletonLine width="60%" /><SkeletonLine width="40%" /></div>;
  if (error) return <div className="card mt-16"><ErrorState message={error} onRetry={reload} /></div>;
  if (!run) return <div className="card mt-16"><div className="empty">{t('automations.errors.notFound')}</div></div>;

  const snapshot = run.configSnapshot;
  const trigger = findTrigger(String(snapshot.triggerType ?? ''));
  const savedConditions = (snapshot.conditions ?? []) as WorkflowCondition[];
  const link = entityLink(run.entityType, run.entityId);
  const badge = run.status === 'succeeded' ? 'badge-bassa'
    : run.status === 'partial' ? 'badge-media'
    : run.status === 'failed' ? 'badge-alta' : 'badge-neutral';
  const retryable = isAdmin && (run.status === 'failed' || run.status === 'partial');

  return (
    <>
      <div className="page-head">
        <Link className="btn-link" to={`/automazioni/${id}`}>
          <Icon name="arrowLeft" className="ic-sm" /> {t('automations.backToAutomation')}
        </Link>
        <div className="page-title">{snapshot.name ?? t('automations.title')}</div>
        <div className="page-desc">
          {relativeTime(run.startedAt, localeTag)}
          {' · '}{t('automations.runVersion', { n: run.workflowVersion })}
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-title">{t('automations.runOutcome')}</div>
        <div className="row-wrap">
          <span className={`badge ${badge}`}>{t(runStatusLabelKey(run.status))}</span>
          {run.errorCode && (() => {
            const key = actionOutcomeKey(run.errorCode);
            return key ? <span className="muted-sm">{t(key)}</span> : null;
          })()}
          {link && (
            <Link className="btn btn-sm" to={link}>
              <Icon name="external" className="ic-sm" /> {t('automations.openEntity')}
            </Link>
          )}
        </div>
        {retryable && (
          <div className="row-wrap mt-14">
            <button className="btn btn-sm" onClick={() => void retry()} disabled={busy}
              aria-busy={busy || undefined}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" className="ic-sm" />}
              {t('automations.retryRun')}
            </button>
            {/* Va detto, perché è la domanda che si fa chi preme: no, non
                rifà quello che era già riuscito. */}
            <span className="muted-sm">{t('automations.retryNotice')}</span>
          </div>
        )}
      </div>

      <div className="card mt-16">
        <div className="card-title">{t('automations.sectionIf')}</div>
        {run.conditionResults.length === 0 && (
          <p className="muted-sm">{t('automations.noConditionsHint')}</p>
        )}
        {run.conditionResults.map((c, i) => {
          const reason = conditionReasonKey(c.reason);
          const saved = savedConditions[i];
          return (
            <div key={i} className="list-row">
              <div className="list-main">
                <div className="list-title">
                  {c.outcome === 'true' ? '✓' : c.outcome === 'false' ? '✗' : '?'}{' '}
                  {trigger && saved ? describeCondition(t, trigger, saved, names) : c.field}
                </div>
                {reason && <div className="list-sub">{t(reason)}</div>}
              </div>
              <span className={`badge ${c.outcome === 'true' ? 'badge-bassa'
                : c.outcome === 'false' ? 'badge-neutral' : 'badge-media'}`}>
                {t(c.outcome === 'true' ? 'automations.outcomeTrue'
                  : c.outcome === 'false' ? 'automations.outcomeFalse'
                  : 'automations.outcomeUnknown')}
              </span>
            </div>
          );
        })}
      </div>

      <div className="card mt-16">
        <div className="card-title">{t('automations.sectionThen')}</div>
        {(actionRuns ?? []).length === 0 && (
          <p className="muted-sm">{t('automations.noActionsRun')}</p>
        )}
        {(actionRuns ?? []).map((a) => {
          const def = findAction(a.actionKey as ActionKey);
          const outcome = actionOutcomeKey(a.errorCode);
          const outLink = entityLink(a.outputEntityType, a.outputEntityId);
          return (
            <div key={a.id} className="list-row">
              <div className="list-main">
                <div className="list-title">
                  {a.status === 'succeeded' ? '✓' : a.status === 'failed' ? '✗' : '—'}{' '}
                  {def ? t(def.labelKey as TKey) : a.actionKey}
                </div>
                {outcome && <div className="list-sub">{t(outcome)}</div>}
                {outLink && (
                  <div className="list-sub">
                    <Link to={outLink}>{t('automations.openResult')}</Link>
                  </div>
                )}
              </div>
              <span className={`badge ${a.status === 'succeeded' ? 'badge-bassa'
                : a.status === 'failed' ? 'badge-alta' : 'badge-neutral'}`}>
                {t(actionStatusLabelKey(a.status))}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
