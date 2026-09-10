// ============================================================================
// Oggi (`/oggi`) — la home da mobilità (Fase 3.1 della roadmap CRM, 0059).
//
// Una pagina, tre domande di chi non è alla scrivania:
//   1. che cosa scade OGGI            → list_tasks, vista «today» (0059)
//   2. quale trattativa aspetta un    → list_crm_opportunities con le due
//      prossimo passo                    bandiere esistenti; il passo si
//                                        SCRIVE da qui (primo uso di
//                                        `crmService.updateOpportunity`)
//   3. che numero ha questo cliente    → ricerca + `tel:` sul primo telefono
//                                        delle persone (il dato vive lì)
//
// Le sezioni 2 e 3 sono CRM: compaiono solo con i moduli attivi
// (`LEGACY_MODULES_ENABLED`, D-10). La pagina NON è una seconda Panoramica:
// niente KPI, niente grafici — è la lista delle cose da FARE adesso.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { taskService } from '@/services/taskService';
import { crmService } from '@/services/crmService';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { Icon } from '@/components/ui/Icon';
import { EmptyCta, ErrorState, SkeletonLine } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { LEGACY_MODULES_ENABLED } from '@/lib/env';
import { useT } from '@/i18n';
import { fondeInAttesa, passoInRitardo, scegliTelefono } from './todayModel';
import type { CrmOpportunity, CrmOrganizationOption, CrmPerson } from '@/types/models';

export function TodayPage() {
  const t = useT();
  const { activeCompanyId } = useCompany();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;

  // ---- 1. Attività di oggi ---------------------------------------------------
  const tasks = useAsync(
    () => taskService.list(companyId, { view: 'today', limit: 50 }),
    [companyId],
  );

  async function completa(id: string) {
    try {
      await taskService.setStatus(id, 'completed');
      tasks.reload();
    } catch (e) {
      showToast(toUserMessage(e));
    }
  }

  // ---- 2. Trattative in attesa di un prossimo passo --------------------------
  const passi = useAsync(async (): Promise<CrmOpportunity[]> => {
    if (!LEGACY_MODULES_ENABLED) return [];
    const [scadute, senzaPasso] = await Promise.all([
      crmService.opportunities(companyId, { onlyOverdueNextStep: true, limit: 50 }),
      crmService.opportunities(companyId, { onlyWithoutNextStep: true, limit: 50 }),
    ]);
    return fondeInAttesa(scadute.items, senzaPasso.items);
  }, [companyId]);

  return (
    <>
      <h1 className="page-title">{t('today.title')}</h1>
      <p className="page-desc">{formatDate(new Date().toISOString())}</p>

      <div className="card mt-16">
        <div className="card-title"><Icon name="sun" className="ic-sm" /> {t('today.tasksTitle')}</div>
        {tasks.loading ? (
          <><SkeletonLine /><SkeletonLine /><SkeletonLine /></>
        ) : tasks.error ? (
          <ErrorState message={toUserMessage(tasks.error)} onRetry={tasks.reload} />
        ) : tasks.data && tasks.data.items.length > 0 ? (
          <ul className="crm-list">
            {tasks.data.items.map((task) => (
              <li className="list-row" key={task.id}>
                <div className="list-main">
                  <Link className="list-title" to={`/attivita/${task.id}`}>{task.title}</Link>
                  <div className="list-sub">{t('tasks.dueToday')}</div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => void completa(task.id)}>
                  <Icon name="checkCircle" className="ic-sm" /> {t('tasks.markDone')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyCta title={t('today.tasksEmpty')} subtitle={t('today.tasksEmptySub')} />
        )}
        <p className="muted-sm mt-8">
          <Link to="/attivita">{t('today.allTasks')}</Link>
        </p>
      </div>

      {LEGACY_MODULES_ENABLED && (
        <>
          <PassiCard
            loading={passi.loading}
            error={passi.error}
            items={passi.data ?? []}
            onSaved={() => passi.reload()}
          />
          <ChiamaCard companyId={companyId} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. Le trattative ferme. Il salvataggio è un gesto UMANO, una riga alla
//    volta: nessuna proposta automatica, nessuna scadenza inventata.
// ---------------------------------------------------------------------------
function PassiCard(props: {
  loading: boolean;
  error: unknown;
  items: CrmOpportunity[];
  onSaved: () => void;
}) {
  const t = useT();
  const { showToast } = useToast();
  const [aperta, setAperta] = useState<string | null>(null);
  const [passo, setPasso] = useState('');
  const [data, setData] = useState('');
  const [saving, setSaving] = useState(false);

  function apri(opp: CrmOpportunity) {
    setAperta(opp.id);
    setPasso(opp.nextStep ?? '');
    setData(opp.nextStepDueDate ?? '');
  }

  async function salva(opp: CrmOpportunity) {
    if (!passo.trim()) return;
    setSaving(true);
    try {
      await crmService.updateOpportunity(opp.id, {
        nextStep: passo,
        nextStepDueDate: data || null,
      });
      showToast(t('today.stepSaved'));
      setAperta(null);
      props.onSaved();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card mt-16">
      <div className="card-title"><Icon name="arrowRight" className="ic-sm" /> {t('today.stepsTitle')}</div>
      {props.loading ? (
        <><SkeletonLine /><SkeletonLine /></>
      ) : props.error ? (
        <ErrorState message={toUserMessage(props.error)} onRetry={props.onSaved} />
      ) : props.items.length === 0 ? (
        <p className="muted-sm m-0">{t('today.stepsEmpty')}</p>
      ) : (
        <ul className="crm-list">
          {props.items.map((opp) => (
            <li className="list-row" key={opp.id}>
              <div className="list-main">
                <Link className="list-title" to={`/clienti/${opp.organizationId}/opportunita/${opp.id}`}>
                  {opp.title}
                </Link>
                <div className="list-sub">
                  <Link to={`/clienti/${opp.organizationId}`}>{opp.organizationName}</Link>
                  {' · '}
                  {passoInRitardo(opp)
                    ? t('today.stepOverdue', { date: formatDate(opp.nextStepDueDate) })
                    : opp.nextStep
                      ? opp.nextStep
                      : t('today.stepMissing')}
                </div>
                {aperta === opp.id && (
                  <div className="mt-8">
                    <div className="field m-0">
                      <label htmlFor={`passo-${opp.id}`}>{t('today.stepField')}</label>
                      <input
                        id={`passo-${opp.id}`}
                        value={passo}
                        onChange={(e) => setPasso(e.target.value)}
                        placeholder={t('today.stepPlaceholder')}
                        maxLength={500}
                      />
                    </div>
                    <div className="field mt-8 m-0">
                      <label htmlFor={`data-${opp.id}`}>{t('today.stepDate')}</label>
                      <input
                        id={`data-${opp.id}`}
                        type="date"
                        value={data}
                        onChange={(e) => setData(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
              {aperta === opp.id ? (
                <div className="row-wrap">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={saving || !passo.trim()}
                    aria-busy={saving || undefined}
                    onClick={() => void salva(opp)}
                  >
                    {t('common.save')}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setAperta(null)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => apri(opp)}>
                  {t('today.stepSet')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Chiama un cliente. Il numero NON si copia a mano: `tel:` lo passa al
//    telefono, che è il senso di cercarlo da mobile. La riga lo dichiara,
//    come fa il tab Persone della scheda cliente (§162).
// ---------------------------------------------------------------------------
function ChiamaCard({ companyId }: { companyId: string }) {
  const t = useT();
  const [cerca, setCerca] = useState('');
  const [debounced, setDebounced] = useState('');
  const [risultati, setRisultati] = useState<CrmOrganizationOption[]>([]);
  const [scelta, setScelta] = useState<CrmOrganizationOption | null>(null);
  const [persone, setPersone] = useState<CrmPerson[] | null>(null);

  // Debounce: si cerca quando la persona smette di scrivere (come in Attività).
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(cerca.trim()), 350);
    return () => clearTimeout(timer);
  }, [cerca]);

  useEffect(() => {
    if (!debounced) { setRisultati([]); return; }
    let cancelled = false;
    void crmService.options(companyId, debounced).then((rows) => {
      if (!cancelled) setRisultati(rows);
    }).catch(() => {
      if (!cancelled) setRisultati([]);
    });
    return () => { cancelled = true; };
  }, [companyId, debounced]);

  useEffect(() => {
    if (!scelta) { setPersone(null); return; }
    let cancelled = false;
    void crmService.people(companyId, scelta.id).then((rows) => {
      if (!cancelled) setPersone(rows);
    }).catch(() => {
      if (!cancelled) setPersone([]);
    });
    return () => { cancelled = true; };
  }, [companyId, scelta]);

  const telefono = useMemo(() => (persone ? scegliTelefono(persone) : null), [persone]);

  return (
    <div className="card mt-16">
      <div className="card-title"><Icon name="phone" className="ic-sm" /> {t('today.callTitle')}</div>
      <div className="field m-0">
        <input
          value={cerca}
          onChange={(e) => { setCerca(e.target.value); setScelta(null); }}
          aria-label={t('today.callSearch')}
          placeholder={t('today.callSearch')}
        />
      </div>
      {risultati.length > 0 && !scelta && (
        <ul className="crm-list mt-8">
          {risultati.map((o) => (
            <li className="list-row" key={o.id}>
              <button type="button" className="list-title btn-link" onClick={() => setScelta(o)}>
                {o.displayName}
              </button>
              {o.city && <span className="list-sub">{o.city}</span>}
            </li>
          ))}
        </ul>
      )}
      {debounced && risultati.length === 0 && !scelta && (
        <p className="muted-sm mt-8 m-0">{t('today.callNoResults')}</p>
      )}
      {scelta && (
        <div className="mt-8">
          <div className="list-title">{scelta.displayName}</div>
          {persone === null ? (
            <SkeletonLine />
          ) : telefono ? (
            <>
              <div className="list-sub">{telefono.personName} · {telefono.value}</div>
              <div className="row-wrap mt-8">
                {/* `tel:` apre il telefono: NON chiama da solo, chiede prima. */}
                <a className="btn btn-primary" href={`tel:${telefono.value}`}>
                  <Icon name="phone" className="ic-sm" /> {t('today.callNow')}
                </a>
                <Link className="btn" to={`/clienti/${scelta.id}`}>{t('today.callOpen')}</Link>
              </div>
            </>
          ) : (
            <>
              <p className="muted-sm m-0">{t('today.callNoPhone', { name: scelta.displayName })}</p>
              <p className="mt-8 m-0">
                <Link className="btn" to={`/clienti/${scelta.id}`}>{t('today.callOpen')}</Link>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
