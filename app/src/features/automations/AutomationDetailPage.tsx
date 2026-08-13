// ============================================================================
// Il dettaglio di un'automazione: che cosa fa, se sta funzionando, e come si
// ferma.
//
// ⚠️ SI FERMA CON UN CLIC (§83). «Metti in pausa» è accanto allo stato, non
// dentro un menu: chi si accorge che una regola sta facendo la cosa sbagliata
// deve poterla fermare subito, non cercare dove.
//
// Le sezioni sono quelle della regola stessa — Stato, Quando, Se, Allora — più
// le ultime esecuzioni: la pagina si legge nello stesso ordine in cui la regola
// è stata scritta.
// ============================================================================
import { useState } from 'react';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  attentionKey, auditLabelKey, describeAction, describeCondition, findTrigger,
  runStatusLabelKey, statusLabelKey, summarySentence, type NameResolver,
} from './automationModel';
import type { DocumentTag, WorkflowRun } from '@/types/models';

export function AutomationDetailPage() {
  const t = useT();
  const { localeTag } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeCompanyId, isAdmin } = useCompany();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;
  const { byId } = useMembers();
  const [busy, setBusy] = useState(false);

  const { loading, error, data: workflow, reload } = useAsync(
    () => (id ? automationService.get(id) : Promise.resolve(null)), [id],
  );
  const { data: runs, reload: reloadRuns } = useAsync(
    () => (id ? automationService.runs(id, 20) : Promise.resolve([])), [id],
  );
  const { data: metrics } = useAsync(
    () => (id ? automationService.metrics(id, 30) : Promise.resolve(null)), [id],
  );
  const { data: audit } = useAsync(
    () => (id && isAdmin ? automationService.audit(id, 10) : Promise.resolve([])), [id, isAdmin],
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

  async function change(action: 'activate' | 'pause' | 'archive' | 'restore') {
    if (!id || busy) return;
    if (action === 'archive' && !window.confirm(t('automations.confirmArchive'))) return;
    setBusy(true);
    try {
      await automationService.setStatus(companyId, id, action);
      showToast(t('automations.statusChanged'));
      reload();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="card mt-16"><SkeletonLine width="60%" /><SkeletonLine width="40%" /></div>;
  if (error) return <div className="card mt-16"><ErrorState message={error} onRetry={reload} /></div>;
  if (!workflow) return <div className="card mt-16"><div className="empty">{t('automations.errors.notFound')}</div></div>;

  const trigger = findTrigger(workflow.triggerType);
  const attention = attentionKey(workflow.attentionCode);
  const joiner = workflow.conditionMatch === 'any'
    ? t('automations.describe.or') : t('automations.describe.and');

  return (
    <>
      <div className="page-head">
        <Link className="btn-link" to="/automazioni">
          <Icon name="arrowLeft" className="ic-sm" /> {t('automations.backToList')}
        </Link>
        <div className="page-title">{workflow.name}</div>
        {workflow.description && <div className="page-desc">{workflow.description}</div>}
      </div>

      <div className="card mt-16">
        <div className="card-title">{t('automations.sectionStatus')}</div>
        <div className="row-wrap">
          <Tag tone={workflow.status === 'active' ? 'ok'
            : workflow.status === 'paused' ? 'attention' : 'neutral'}>
            {t(statusLabelKey(workflow.status))}
          </Tag>
          <span className="muted-sm">
            {workflow.lastRunAt
              ? t('automations.lastRunAt', { when: relativeTime(workflow.lastRunAt, localeTag) })
              : t('automations.neverRun')}
          </span>
          <span className="muted-sm">{t('automations.versionLabel', { n: workflow.version })}</span>
        </div>

        {attention && (
          <div className="warn-box mt-10">
            <Icon name="alert" className="ic-sm" /> {t(attention)}
          </div>
        )}

        {isAdmin && (
          <div className="row-wrap mt-14">
            {workflow.status !== 'active' && workflow.status !== 'archived' && (
              <button className="btn btn-primary btn-sm" onClick={() => void change('activate')} disabled={busy}>
                <Icon name="checkCircle" className="ic-sm" /> {t('automations.activate')}
              </button>
            )}
            {workflow.status === 'active' && (
              <button className="btn btn-sm" onClick={() => void change('pause')} disabled={busy}>
                <Icon name="clock" className="ic-sm" /> {t('automations.pause')}
              </button>
            )}
            {workflow.status !== 'archived' && (
              <>
                <Link className="btn btn-sm" to={`/automazioni/${workflow.id}/modifica`}>
                  <Icon name="settings" className="ic-sm" /> {t('automations.edit')}
                </Link>
                {/* §85 — si ARCHIVIA, non si cancella: le esecuzioni restano
                    consultabili. Cancellare farebbe sparire la spiegazione di
                    attività e categorie che quella regola ha prodotto. */}
                <button className="btn btn-sm" onClick={() => void change('archive')} disabled={busy}>
                  <Icon name="archive" className="ic-sm" /> {t('automations.archive')}
                </button>
              </>
            )}
            {workflow.status === 'archived' && (
              <button className="btn btn-sm" onClick={() => void change('restore')} disabled={busy}>
                <Icon name="refresh" className="ic-sm" /> {t('automations.restore')}
              </button>
            )}
          </div>
        )}

        <p className="mt-14">{summarySentence(t, workflow, names)}</p>
      </div>

      <div className="card mt-16">
        <div className="card-title">{t('automations.sectionWhen')}</div>
        <p>{trigger ? t(trigger.labelKey as TKey) : workflow.triggerType}</p>

        <div className="card-title mt-14">{t('automations.sectionIf')}</div>
        {workflow.conditions.length === 0 && <p className="muted-sm">{t('automations.noConditionsHint')}</p>}
        {trigger && workflow.conditions.map((c, i) => (
          <div key={i} className="list-row">
            <div className="list-main">
              <div className="list-title">{describeCondition(t, trigger, c, names)}</div>
              {i < workflow.conditions.length - 1 && <div className="list-sub">{joiner}</div>}
            </div>
          </div>
        ))}

        <div className="card-title mt-14">{t('automations.sectionThen')}</div>
        {workflow.actions.map((a, i) => (
          <div key={i} className="list-row">
            <div className="list-main">
              <div className="list-title">{i + 1}. {describeAction(t, a, names)}</div>
            </div>
          </div>
        ))}
      </div>

      {metrics && (
        <div className="card mt-16">
          <div className="card-title">{t('automations.sectionMetrics')}</div>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">{t('automations.metricRuns')}</div>
              <div className="kpi-value">{metrics.runs}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('automations.metricActions')}</div>
              <div className="kpi-value">{metrics.actionsDone}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('automations.metricErrors')}</div>
              <div className="kpi-value">{metrics.errors}</div>
            </div>
          </div>
          <p className="muted-sm">{t('automations.metricsNote')}</p>
        </div>
      )}

      <div className="card mt-16">
        <div className="card-title">
          {t('automations.sectionRuns')}
          <button className="mini-btn" onClick={reloadRuns} aria-label={t('common.retry')}>
            <Icon name="refresh" className="ic-sm" />
          </button>
        </div>
        {(runs ?? []).length === 0 && (
          <div className="empty">
            <div>{t('automations.noRuns')}</div>
            <div className="muted-sm mt-10">{t('automations.noRunsSub')}</div>
          </div>
        )}
        {(runs ?? []).map((run) => (
          <RunRow key={run.id} run={run} workflowId={workflow.id} localeTag={localeTag} />
        ))}
      </div>

      {isAdmin && (audit ?? []).length > 0 && (
        <div className="card mt-16">
          <div className="card-title">{t('automations.sectionAudit')}</div>
          {(audit ?? []).map((entry) => (
            <div key={entry.id} className="list-row">
              <div className="list-main">
                <div className="list-title">{t(auditLabelKey(entry.kind))}</div>
                <div className="list-sub">
                  {names.member(entry.actorUserId) === t('tasks.unassigned')
                    ? t('automations.actorSystem')
                    : names.member(entry.actorUserId)}
                  {' · '}{relativeTime(entry.createdAt, localeTag)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RunRow({
  run, workflowId, localeTag,
}: { run: WorkflowRun; workflowId: string; localeTag: string }) {
  const t = useT();
  const badge = run.status === 'succeeded' ? 'ok'
    : run.status === 'partial' ? 'attention'
    : run.status === 'failed' ? 'alert' : 'neutral';

  return (
    <Link className="list-row is-link" to={`/automazioni/${workflowId}/esecuzioni/${run.id}`}>
      <div className="list-main">
        <div className="list-title">{relativeTime(run.startedAt, localeTag)}</div>
        <div className="list-sub">
          {t('automations.runVersion', { n: run.workflowVersion })}
          {run.durationMs !== null && ` · ${t('automations.runDuration', { ms: run.durationMs })}`}
        </div>
      </div>
      <Tag tone={badge}>{t(runStatusLabelKey(run.status))}</Tag>
    </Link>
  );
}
