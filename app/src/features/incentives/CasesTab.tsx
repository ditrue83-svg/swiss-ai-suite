// ============================================================================
// Scheda 3 — PRATICHE. «A che punto sono le candidature».
//
// Una pratica è il lavoro di preparazione, e SOPRAVVIVE al cambiamento del
// catalogo perché conserva l'istantanea con cui è nata (§109). Se domani il
// programma cambia, la pratica non si aggiorna da sola: mostra un avviso, e
// resta ciò che era.
//
// ⚠️⚠️ `submitted` SIGNIFICA CHE UNA PERSONA HA REGISTRATO L'INVIO (§107). Non
// che l'autorità l'ha ricevuta: il prodotto non ha alcun canale verso l'ente, e
// presentare il proprio registro come una conferma esterna sarebbe la bugia più
// facile da raccontare in questo modulo. La schermata lo dice a parole.
//
// ⚠️ L'ESITO LO REGISTRA UNA PERSONA. Non esiste alcun percorso automatico che
// scriva «approvata», e il database rifiuta un esito su una pratica non
// inviata: qui quel pulsante non compare proprio, invece di produrre un errore.
//
// ⚠️ LO STORICO VA RILETTO dopo ogni azione: lo scrivono i trigger, e
// indovinare che cosa hanno registrato racconterebbe una storia parallela a
// quella vera. È la lezione del dettaglio Attività.
// ============================================================================
import { useEffect, useState } from 'react';
import { Tag } from '@/components/ui/Tag';
import { Icon } from '@/components/ui/Icon';
import { Button, EmptyCta, ErrorState, SkeletonCard, SkeletonLine } from '@/components/ui/states';
import { useT, type TKey } from '@/i18n';
import { formatCurrency, formatDate } from '@/lib/format';
import { incentivesService } from '@/services/incentivesService';
import type { SubsidyCaseOutcome, SubsidyCaseStatus } from '@/types/database';
import type { IncentiveCase, IncentiveCaseEvent, IncentiveCaseItem } from '@/types/models';
import {
  CASE_STATUS_KEY, canMarkReady, caseDeadline, checklistProgress, nextStatuses,
  plural, subsidyErrorKey, todayISO,
} from './incentivesModel';
import { cx } from '@/lib/cx';
import styles from './incentives.module.css';

interface Props {
  companyId: string;
  showArchived: boolean;
  onShowArchived: (v: boolean) => void;
  onChanged: () => void;
}

export function CasesTab({ companyId, showArchived, onShowArchived, onChanged }: Props) {
  const t = useT();
  const [items, setItems] = useState<IncentiveCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const today = todayISO();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const list = await incentivesService.cases(companyId, showArchived);
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, showArchived, reload]);

  const refresh = () => { setReload((n) => n + 1); onChanged(); };
  const opened = openId ? items.find((c) => c.id === openId) ?? null : null;

  if (opened) {
    return (
      <CaseDetail
        item={opened}
        onBack={() => setOpenId(null)}
        onChanged={refresh}
      />
    );
  }

  return (
    <>
      <div className="ct-toolbar">
        <label className="check-pill">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onShowArchived(e.target.checked)}
          />
          {t('incentives.cases.showArchived')}
        </label>
      </div>

      {error && <ErrorState message={error} onRetry={refresh} />}

      {loading && items.length === 0 ? (
        <SkeletonCard />
      ) : items.length === 0 ? (
        <EmptyCta
          icon="fileSignature"
          title={t('incentives.cases.emptyTitle')}
          subtitle={t('incentives.cases.emptySub')}
        />
      ) : (
        <div className="card">
          {items.map((c) => {
            const progress = checklistProgress(c);
            const due = caseDeadline(c, today);
            return (
              <div key={c.id} className="list-row">
                <div className="list-main">
                  <div className="list-title">
                    <button type="button" className={styles.incOpen} onClick={() => setOpenId(c.id)}>
                      {c.programName ?? c.programId}
                    </button>
                  </div>
                  <div className="list-sub">
                    {c.authority}
                    {c.projectTitle && <> · {c.projectTitle}</>}
                  </div>
                  <div className="badge-row">
                    <Tag>{t(CASE_STATUS_KEY[c.status])}</Tag>
                    {/* ⚠️ La percentuale è `null` quando non c'è nessun passo:
                        «0%» racconterebbe un lavoro appena cominciato dove
                        invece non è stato ancora definito. */}
                    {progress.percent !== null && (
                      <Tag>
                        {t('incentives.cases.progress', { done: progress.done, total: progress.total })}
                      </Tag>
                    )}
                    {c.archivedAt && (
                      <Tag>{t('incentives.cases.archived')}</Tag>
                    )}
                  </div>
                  {due && (
                    <div className={cx(styles.incDeadline, due.expired && styles.isUrgent)}>
                      <Icon name="clock" className="ic-sm" />
                      {/* ⚠️ Si dichiara SEMPRE quale delle due scadenze è: dire
                          «fra 5 giorni» senza dire «interna» farebbe credere
                          che l'autorità chiuda fra cinque giorni. */}
                      {due.kind === 'official'
                        ? t(plural(due.daysLeft, 'incentives.cases.officialDueOne', 'incentives.cases.officialDue'),
                          { date: formatDate(due.date), days: due.daysLeft })
                        : t(plural(due.daysLeft, 'incentives.cases.internalDueOne', 'incentives.cases.internalDue'),
                          { date: formatDate(due.date), days: due.daysLeft })}
                    </div>
                  )}
                  {c.sourceChangedAt && (
                    <div className={styles.incFlag}>{t('incentives.cases.sourceChanged')}</div>
                  )}
                </div>
                <div className={styles.incRowSide}>
                  <button type="button" className="mini-btn" onClick={() => setOpenId(c.id)}>
                    {t('incentives.openDetail')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Il dettaglio di una pratica
// ---------------------------------------------------------------------------
function CaseDetail({
  item, onBack, onChanged,
}: { item: IncentiveCase; onBack: () => void; onChanged: () => void }) {
  const t = useT();
  const [items, setItems] = useState<IncentiveCaseItem[]>([]);
  const [events, setEvents] = useState<IncentiveCaseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newStep, setNewStep] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [internalDeadline, setInternalDeadline] = useState(item.internalDeadline ?? '');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [list, log] = await Promise.all([
          incentivesService.caseItems(item.id),
          incentivesService.caseEvents(item.id),
        ]);
        if (cancelled) return;
        setItems(list);
        setEvents(log);
      } catch (e) {
        if (!cancelled) setError(messageOf(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [item.id, reload]);

  function messageOf(e: unknown): string {
    const key = subsidyErrorKey(e);
    return key ? t(key) : (e instanceof Error ? e.message : String(e));
  }

  const refresh = () => { setReload((n) => n + 1); onChanged(); };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const progress = checklistProgress(item);
  const allowed = nextStatuses(item);

  return (
    <>
      <div className="row-wrap mb-8">
        <button type="button" className="mini-btn" onClick={onBack}>
          <Icon name="arrowLeft" className="ic-sm" /> {t('incentives.cases.backToList')}
        </button>
      </div>

      <div className="card">
        <div className="ct-head">
          <div>
            <div className="page-title">{item.programName ?? item.programId}</div>
            <div className="page-desc">
              {item.authority}
              {item.projectTitle && <> · {item.projectTitle}</>}
            </div>
          </div>
          <Tag>{t(CASE_STATUS_KEY[item.status])}</Tag>
        </div>

        {error && <ErrorState message={error} />}

        {/* ⚠️ Le pratiche nate prima della 0032 non hanno un'istantanea e non si
            può ricostruire. Si DICHIARA, invece di fabbricarne una: una
            istantanea inventata sarebbe peggio dell'assenza. */}
        {item.legacySnapshot && (
          <div className="info-box mt-8">
            <Icon name="alert" className="ic-sm" /> <span>{t('incentives.cases.legacySnapshot')}</span>
          </div>
        )}
        {item.sourceChangedAt && (
          <div className="warn-box mt-8">
            <Icon name="alert" />
            <span>{t('incentives.cases.sourceChangedLong', { date: formatDate(item.sourceChangedAt) })}</span>
          </div>
        )}
        {item.submittedAt && (
          // §107 — la frase più importante della schermata.
          <div className="info-box mt-8">
            <Icon name="checkCircle" className="ic-sm" />
            <span>{t('incentives.cases.submittedNote', { date: formatDate(item.submittedAt) })}</span>
          </div>
        )}

        <dl className="crm-kv mt-12">
          <dt>{t('incentives.cases.officialDeadline')}</dt>
          <dd>
            {item.officialDeadline ? formatDate(item.officialDeadline) : t('incentives.cases.noOfficialDeadline')}
          </dd>
          <dt>{t('incentives.cases.amountRequested')}</dt>
          <dd>{formatCurrency(item.amountRequested, item.currency) ?? t('incentives.cases.notDeclared')}</dd>
          {item.amountAwarded !== null && (
            <>
              <dt>{t('incentives.cases.amountAwarded')}</dt>
              <dd>{formatCurrency(item.amountAwarded, item.currency)}</dd>
            </>
          )}
          <dt>{t('incentives.cases.created')}</dt>
          <dd>{formatDate(item.createdAt)}</dd>
        </dl>

        {/* La scadenza INTERNA: la sceglie l'impresa per arrivare pronta prima.
            Quella ufficiale è della call e non si tocca. */}
        <div className="field mt-12">
          <label htmlFor="case-internal">{t('incentives.cases.internalDeadline')}</label>
          <div className="row-wrap">
            <input
              id="case-internal"
              type="date"
              value={internalDeadline}
              onChange={(e) => setInternalDeadline(e.target.value)}
            />
            <Button
              size="sm"
              loading={busy}
              onClick={() => void run(() => incentivesService.updateCase(item.id, {
                internal_deadline: internalDeadline || null,
              }))}
            >
              {t('common.save')}
            </Button>
          </div>
          <div className="field-hint">{t('incentives.cases.internalDeadlineHint')}</div>
        </div>

        {/* ---- Gli stati ----
            Si offrono solo le transizioni che il database accetterebbe: un
            pulsante che produce un errore è peggio di un pulsante assente. */}
        <div className="crm-sec">
          <div className="section-title">{t('incentives.cases.advance')}</div>
          {allowed.length === 0 ? (
            <p className="muted-sm">{t('incentives.cases.terminal')}</p>
          ) : (
            <div className="row-wrap">
              {allowed.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === 'submitted' ? 'primary' : 'default'}
                  loading={busy}
                  onClick={() => void run(() => incentivesService.updateCase(item.id, { status: s }))}
                >
                  {t(NEXT_STATUS_KEY[s])}
                </Button>
              ))}
            </div>
          )}
          {!canMarkReady(item) && item.itemsTotal > 0 && (
            <div className="field-hint mt-8">
              {t(plural(item.itemsRequiredOpen,
                'incentives.cases.notReadyHintOne', 'incentives.cases.notReadyHint'),
              { n: item.itemsRequiredOpen })}
            </div>
          )}
          {item.itemsTotal === 0 && (
            // §115 — una checklist vuota non è una checklist finita.
            <div className="field-hint mt-8">{t('incentives.cases.noStepsHint')}</div>
          )}
        </div>

        {/* ---- L'esito ----
            Compare SOLO quando la pratica è stata inviata: il database lo
            impone, e offrirlo prima produrrebbe un errore invece di un'azione
            impossibile. */}
        {(item.status === 'submitted' || item.status === 'under_review'
          || item.status === 'approved' || item.status === 'rejected') && (
          <div className="crm-sec">
            <div className="section-title">{t('incentives.cases.outcome')}</div>
            <p className="muted-sm">{t('incentives.cases.outcomeHint')}</p>
            <div className="row-wrap mt-8">
              {(['approved', 'rejected', 'withdrawn', 'unknown'] as SubsidyCaseOutcome[]).map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={item.outcome === o}
                  className={`check-pill${item.outcome === o ? ' on' : ''}`}
                  disabled={busy}
                  onClick={() => void run(() => incentivesService.updateCase(item.id, { outcome: o }))}
                >
                  {t(OUTCOME_KEY[o])}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ---- La checklist ---- */}
      <div className="card mt-16">
        <div className="crm-sec-head">
          <div className="section-title">{t('incentives.cases.checklist')}</div>
          {progress.percent !== null && (
            <span className="muted-sm">
              {t('incentives.cases.progress', { done: progress.done, total: progress.total })}
            </span>
          )}
        </div>
        {/* ⚠️ La barra non disegna niente a zero, ed è la regola grafica del
            sistema di design: una quantità che non esiste non si mostra. */}
        {progress.percent !== null && progress.percent > 0 && (
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${progress.percent}%` }} />
          </div>
        )}

        {loading ? (
          <><SkeletonLine /><SkeletonLine width="60%" /></>
        ) : items.length === 0 ? (
          <div className="empty">{t('incentives.cases.noSteps')}</div>
        ) : (
          <div className="mt-8">
            {items.map((s) => (
              <div key={s.id} className={styles.incStep}>
                <label className={cx(styles.checklistItem, s.completed && styles.done)}>
                  <input
                    type="checkbox"
                    checked={s.completed}
                    disabled={busy}
                    onChange={() => void run(() => incentivesService.setCaseItemCompleted(s.id, !s.completed))}
                  />
                  <span>
                    {s.title}
                    {s.required && <> · {t('incentives.cases.required')}</>}
                    {s.dueDate && <> · {formatDate(s.dueDate)}</>}
                  </span>
                </label>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={busy}
                  onClick={() => void run(() => incentivesService.removeCaseItem(s.id))}
                >
                  <Icon name="trash" className="ic-sm" /> {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="field mt-12">
          <label htmlFor="case-new-step">{t('incentives.cases.addStep')}</label>
          <div className="row-wrap">
            <input
              id="case-new-step"
              value={newStep}
              maxLength={200}
              onChange={(e) => setNewStep(e.target.value)}
            />
            <Button
              size="sm"
              icon="plus"
              disabled={newStep.trim().length === 0}
              loading={busy}
              onClick={() => void run(async () => {
                await incentivesService.addCaseItem({
                  caseId: item.id,
                  title: newStep.trim(),
                  sortOrder: items.length,
                });
                setNewStep('');
              })}
            >
              {t('incentives.cases.addButton')}
            </Button>
          </div>
          {/* §115 — il collegamento a un documento è un SUGGERIMENTO: la spunta
              la mette una persona. Dedurre il completamento dall'esistenza di
              un file dichiarerebbe pronta una pratica che non lo è. */}
          <div className="field-hint">{t('incentives.cases.checklistHint')}</div>
        </div>
      </div>

      {/* ---- Lo storico ---- */}
      <div className="card mt-16">
        <div className="section-title">{t('incentives.cases.history')}</div>
        <p className="muted-sm">{t('incentives.cases.historyHint')}</p>
        {loading ? (
          <SkeletonLine />
        ) : events.length === 0 ? (
          <div className="empty">{t('incentives.cases.noHistory')}</div>
        ) : (
          <ul className="crm-tl">
            {events.map((e) => (
              <li key={e.id}>
                <div className="crm-tl-what">{t(EVENT_KEY[e.kind])}</div>
                <div className="crm-tl-when">{formatDate(e.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row-wrap mt-16">
        <Button
          loading={busy}
          onClick={() => void run(() => incentivesService.setCaseArchived(item.id, item.archivedAt === null))}
        >
          {item.archivedAt ? t('incentives.cases.restore') : t('incentives.cases.archive')}
        </Button>
      </div>
    </>
  );
}

/**
 * L'etichetta del PULSANTE che porta a uno stato, che non è l'etichetta dello
 * stato: «Invia» è un gesto, «Inviata» è una condizione. Usare la seconda su un
 * pulsante farebbe leggere «questa pratica è inviata» a chi sta per inviarla.
 */
const NEXT_STATUS_KEY: Record<SubsidyCaseStatus, TKey> = {
  draft: 'incentives.cases.toDraft',
  assessing: 'incentives.cases.toAssessing',
  collecting_documents: 'incentives.cases.toCollecting',
  ready: 'incentives.cases.toReady',
  submitted: 'incentives.cases.toSubmitted',
  under_review: 'incentives.cases.toUnderReview',
  approved: 'incentives.cases.toApproved',
  rejected: 'incentives.cases.toRejected',
  withdrawn: 'incentives.cases.toWithdrawn',
  closed: 'incentives.cases.toClosed',
};

const OUTCOME_KEY: Record<SubsidyCaseOutcome, TKey> = {
  approved: 'incentives.outcome.approved',
  rejected: 'incentives.outcome.rejected',
  withdrawn: 'incentives.outcome.withdrawn',
  unknown: 'incentives.outcome.unknown',
};

const EVENT_KEY: Record<IncentiveCaseEvent['kind'], TKey> = {
  case_created: 'incentives.events.created',
  owner_changed: 'incentives.events.ownerChanged',
  status_changed: 'incentives.events.statusChanged',
  assessment_updated: 'incentives.events.assessmentUpdated',
  document_linked: 'incentives.events.documentLinked',
  document_unlinked: 'incentives.events.documentUnlinked',
  checklist_completed: 'incentives.events.checklistCompleted',
  checklist_reopened: 'incentives.events.checklistReopened',
  submitted: 'incentives.events.submitted',
  outcome_recorded: 'incentives.events.outcomeRecorded',
  source_changed: 'incentives.events.sourceChanged',
  archived: 'incentives.events.archived',
};
