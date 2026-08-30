// ============================================================================
// Le opportunità — a che punto è la trattativa, e qual è il prossimo passo.
//
// ⚠️⚠️ NESSUNA PROBABILITÀ DI CHIUSURA, NESSUNA PREVISIONE, NESSUN PUNTEGGIO
// (§44, §47, §151). «Offerta = 50%» ha l'aria di una misura e non deriva da
// niente; sommato su venti trattative produce un numero che qualcuno userebbe
// per decidere. Qui non c'è, e la sua assenza è una scelta.
//
// ⚠️ §91 — lo stage `proposal` si chiama «Offerta» e NON implica un modulo
// preventivi: nessun PDF, nessun listino, nessuna firma. È uno stato.
//
// ⚠️ §50 — IL PROSSIMO PASSO NON È UN'ATTIVITÀ. È la sintesi commerciale; il
// lavoro assegnabile e tracciabile è un'attività, e il pulsante le collega
// invece di mantenere due sistemi di lavoro paralleli.
// ⚠️ §51 — se un'attività per quel passo esiste già, la si MOSTRA: non se ne
// crea una seconda a ogni salvataggio.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tag } from '@/components/ui/Tag';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { EmptyCta, ErrorState, SkeletonCard } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { crmService } from '@/services/crmService';
import { memberService } from '@/services/memberService';
import { taskService } from '@/services/taskService';
import { formatCurrency, formatDate } from '@/lib/format';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import type { AssignableMember, CrmOpportunity, CrmOrganization, CrmPerson } from '@/types/models';
import type { CrmOpportunityStage } from '@/types/database';
import { ALL_STAGES, isOpen, opportunityState, opportunityStateKey } from './crmModel';
import { CrmFieldsCard } from './CrmFieldsCard';
import { CrmEmailComposer } from './CrmEmailComposer';
import { cx } from '@/lib/cx';
import styles from './crm.module.css';

/** ISO 4217, tre lettere. Le tre che una PMI svizzera incontra davvero. */
const CURRENCIES = ['CHF', 'EUR', 'USD'];

// ===========================================================================
export function OpportunityCreatePage() {
  const { id = '' } = useParams();
  const { activeCompany: company } = useCompany();
  const t = useT();
  const L = useLabels();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [org, setOrg] = useState<CrmOrganization | null>(null);
  const [people, setPeople] = useState<CrmPerson[]>([]);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [title, setTitle] = useState('');
  const [stage, setStage] = useState<CrmOpportunityStage>('lead');
  const [owner, setOwner] = useState('');
  const [contact, setContact] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('CHF');
  const [closeDate, setCloseDate] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [nextStepDue, setNextStepDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!company || !id) return;
    let cancelled = false;
    (async () => {
      const [found, p, dir] = await Promise.all([
        crmService.get(company.id, id),
        crmService.people(company.id, id),
        memberService.listAssignable(company.id).catch(() => [] as AssignableMember[]),
      ]);
      if (cancelled) return;
      setOrg(found); setPeople(p); setMembers(dir);
    })();
    return () => { cancelled = true; };
  }, [company, id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!company || busy || title.trim() === '') return;
    setBusy(true); setError(null);
    try {
      // §45 — se c'è un importo c'è la valuta. Il database ha un vincolo che lo
      // pretende: mandare l'uno senza l'altra produce un rifiuto, non una riga
      // con una valuta indovinata.
      const value = amount.trim() === '' ? null : Number(amount.replace(',', '.'));
      const oppId = await crmService.createOpportunity(company.id, id, {
        title: title.trim(),
        stage,
        ownerUserId: owner || null,
        primaryContactId: contact || null,
        valueAmount: value !== null && Number.isFinite(value) ? value : null,
        valueCurrency: value !== null && Number.isFinite(value) ? currency : null,
        expectedCloseDate: closeDate || null,
        nextStep: nextStep.trim() || null,
        nextStepDueDate: nextStepDue || null,
      });
      showToast(t('crm.form.opportunityCreated'));
      navigate(`/clienti/${id}/opportunita/${oppId}`, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!company) return null;
  if (!org) return <SkeletonCard />;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('crm.addOpportunity')}</div>
          <div className="page-desc">
            <Link to={`/clienti/${org.id}`}>{org.displayName}</Link>
          </div>
        </div>
      </div>

      {error && <ErrorState message={t(error as TKey) || error} />}

      <form className={cx('card', styles.crmNarrow)} onSubmit={submit}>
        <div className="field">
          <label htmlFor="o-title">{t('crm.opp.title')}</label>
          <input id="o-title" value={title} required maxLength={200}
            onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="o-stage">{t('crm.opp.stage')}</label>
            <select id="o-stage" value={stage}
              onChange={(e) => setStage(e.target.value as CrmOpportunityStage)}>
              {ALL_STAGES.map((s) => <option key={s} value={s}>{L.crmStage(s)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="o-owner">{t('crm.opp.owner')}</label>
            <select id="o-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t('crm.form.noOwner')}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name || m.userId.slice(0, 8)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="o-contact">{t('crm.opp.contact')}</label>
          <select id="o-contact" value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="">—</option>
            {/* §177 — solo le persone DI QUESTA organizzazione: il guardiano
                rifiuta le altre, e offrirle sarebbe far configurare un errore. */}
            {people.map((p) => (
              <option key={p.contact.id} value={p.contact.id}>{p.contact.displayName}</option>
            ))}
          </select>
        </div>

        <div className={styles.grid3}>
          <div className="field">
            <label htmlFor="o-amount">{t('crm.opp.value')}</label>
            <input id="o-amount" value={amount} inputMode="decimal" maxLength={16}
              onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="o-cur">{t('crm.opp.currency')}</label>
            <select id="o-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="o-close">{t('crm.opp.closeDate')}</label>
            <input id="o-close" type="date" value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="o-step">{t('crm.opp.nextStep')}</label>
          <input id="o-step" value={nextStep} maxLength={200}
            aria-describedby="o-step-h" onChange={(e) => setNextStep(e.target.value)} />
          <div className="field-hint" id="o-step-h">{t('crm.opp.nextStepHint')}</div>
        </div>
        <div className="field">
          <label htmlFor="o-stepdue">{t('crm.opp.nextStepDue')}</label>
          <input id="o-stepdue" type="date" value={nextStepDue}
            onChange={(e) => setNextStepDue(e.target.value)} />
        </div>

        <div className="row-wrap mt-8">
          <button className="btn btn-primary" type="submit"
            disabled={busy || title.trim() === ''} aria-busy={busy || undefined}>
            {t('crm.form.save')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate(`/clienti/${id}`)}>
            {t('crm.form.cancel')}
          </button>
        </div>
      </form>
    </>
  );
}

// ===========================================================================
export function OpportunityDetailPage() {
  const { id = '', opportunityId = '' } = useParams();
  const { activeCompany: company } = useCompany();
  const { user } = useAuth();
  const t = useT();
  const L = useLabels();
  const { showToast } = useToast();

  const [deal, setDeal] = useState<CrmOpportunity | null>(null);
  const [tasks, setTasks] = useState<Array<{
    id: string; title: string; dueDate: string | null; opportunityId: string | null;
  }>>([]);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [askLost, setAskLost] = useState(false);

  // ⚠️ Quale risposta sta guardando la pagina: cambiando opportunità la
  // richiesta di prima resta in volo, e se risolve dopo mostra la trattativa
  // PRECEDENTE. L'effetto della pagina di modifica ha già la sua guardia
  // (`cancelled`); questa è la stessa cosa, dove la chiamata è una `useCallback`
  // richiamata anche da `run` dopo ogni azione.
  const richiesta = useRef(0);

  const load = useCallback(async () => {
    if (!company || !opportunityId) return;
    const mia = ++richiesta.current;
    setLoading(true); setNotFound(false);
    try {
      const found = await crmService.opportunity(company.id, opportunityId);
      if (mia !== richiesta.current) return;
      if (!found) { setNotFound(true); return; }
      setDeal(found);
      const [tk, dir] = await Promise.all([
        crmService.linkedTasks(company.id, found.organizationId),
        memberService.listAssignable(company.id).catch(() => [] as AssignableMember[]),
      ]);
      if (mia !== richiesta.current) return;
      setTasks(tk.filter((k) => k.opportunityId === opportunityId));
      setMembers(dir);
    } finally {
      if (mia === richiesta.current) setLoading(false);
    }
  }, [company, opportunityId]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<void>, successKey: TKey) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      showToast(t(successKey));
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(t(msg as TKey) || msg);
    } finally {
      setBusy(false);
    }
  }

  if (!company) return null;
  if (notFound) return <ErrorState message={t('crm.notFound')} />;
  if (loading && !deal) return <SkeletonCard />;
  if (!deal) return null;

  const st = opportunityState(deal);
  const ownerName = members.find((m) => m.userId === deal.ownerUserId)?.name || null;
  // §51 — un'attività per questo passo esiste già? Si guarda il titolo: è
  // l'unico legame che il prodotto ha fra il testo del passo e il lavoro, e
  // inventarne un altro significherebbe una colonna in più su `tasks`.
  const stepTask = deal.nextStep
    ? tasks.find((k) => k.title.trim() === deal.nextStep!.trim()) ?? null
    : null;

  return (
    <>
      <div className="page-head ct-head">
        <div>
          <div className="page-title">{deal.title}</div>
          <div className="page-desc">
            <Link to={`/clienti/${deal.organizationId}`}>{deal.organizationName}</Link>
          </div>
          <div className={styles.crmRoles}>
            <Tag tone="info">{L.crmStage(deal.stage)}</Tag>
            <Tag>{t(opportunityStateKey(st))}</Tag>
          </div>
        </div>
        <div className="row-wrap">
          <CrmEmailComposer companyId={company.id} organizationId={deal.organizationId} opportunityId={deal.id} onSent={() => void load()} />
          {/* §54 — il cambio di fase da una TENDINA, non da un trascinamento:
              è accessibile da tastiera senza alcuna libreria. */}
          <div className="field ct-inline">
            <label htmlFor="d-stage">{t('crm.opp.changeStage')}</label>
            <select
              id="d-stage" value={deal.stage} disabled={busy}
              onChange={(e) => {
                const next = e.target.value as CrmOpportunityStage;
                if (next === 'lost') { setAskLost(true); return; }
                void run(() => crmService.setStage(deal.id, next), 'crm.form.stageChanged');
              }}
            >
              {ALL_STAGES.map((s) => <option key={s} value={s}>{L.crmStage(s)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* §43 — il motivo della perdita è FACOLTATIVO, e chiederlo non blocca:
          si può chiudere una trattativa senza saper dire perché. */}
      {askLost && (
        <form
          className={styles.crmAsk}
          onSubmit={(e) => {
            e.preventDefault();
            setAskLost(false);
            void run(() => crmService.setStage(deal.id, 'lost', lostReason || null),
              'crm.form.stageChanged');
          }}
        >
          <div className="field">
            <label htmlFor="d-lost">{t('crm.opp.lostReason')}</label>
            <input id="d-lost" value={lostReason} maxLength={200}
              onChange={(e) => setLostReason(e.target.value)} />
          </div>
          <div className="row-wrap">
            <button className="btn btn-sm btn-primary" type="submit">{t('crm.form.save')}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAskLost(false)}>
              {t('crm.form.cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="grid-2 mt-8">
        <div className="card">
          <div className="card-title">{t('crm.opp.value')}</div>
          <dl className="crm-kv">
            <dt>{t('crm.opp.value')}</dt>
            <dd>
              {/* §46 e §49 — «non stimato» non è zero, e senza valuta non si
                  scrive «CHF»: `formatCurrency` torna null e qui lo si dice. */}
              {formatCurrency(deal.valueAmount, deal.valueCurrency)
                ?? <em>{t('crm.opp.noValue')}</em>}
            </dd>
            <dt>{t('crm.opp.closeDate')}</dt>
            <dd>{deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : '—'}</dd>
            <dt>{t('crm.opp.owner')}</dt>
            <dd>{ownerName ?? <em>{t('crm.row.noOwner')}</em>}</dd>
            <dt>{t('crm.opp.contact')}</dt>
            <dd>{deal.primaryContactName ?? '—'}</dd>
            {deal.stage === 'won' && deal.wonAt && (
              <>
                <dt>{t('crm.opp.states.won')}</dt>
                <dd>{formatDate(deal.wonAt)}</dd>
              </>
            )}
            {deal.stage === 'lost' && (
              <>
                <dt>{t('crm.opp.lostReason')}</dt>
                <dd>{deal.lostReason ?? '—'}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="card">
          <div className="card-title">{t('crm.opp.nextStep')}</div>
          {deal.nextStep ? (
            <>
              <p>{deal.nextStep}</p>
              {deal.nextStepDueDate && (
                <p className="muted-sm">{t('crm.opp.nextStepDue')} {formatDate(deal.nextStepDueDate)}</p>
              )}
              {/* §50 e §51 — il passo diventa lavoro UNA volta: se l'attività
                  c'è già la si apre, non se ne crea una seconda. */}
              {stepTask ? (
                <p>
                  <span className="muted-sm">{t('crm.opp.taskExists')}</span>{' '}
                  <Link to={`/attivita/${stepTask.id}`}>{stepTask.title}</Link>
                </p>
              ) : (
                <button
                  type="button" className="btn btn-sm" disabled={busy || !user}
                  onClick={() => void run(async () => {
                    if (!user) return;
                    await taskService.create({
                      companyId: company.id, userId: user.id,
                      title: deal.nextStep!.trim(),
                      dueDate: deal.nextStepDueDate,
                      assigneeUserId: deal.ownerUserId,
                      source: 'crm',
                      crmOpportunityId: deal.id,
                    });
                  }, 'crm.form.linkedOk')}
                >
                  <Icon name="checkCircle" className="ic-sm" /> {t('crm.opp.createTask')}
                </button>
              )}
              <p className="muted-sm mt-8">{t('crm.opp.nextStepHint')}</p>
            </>
          ) : (
            <p><em>{t('crm.opp.noNextStep')}</em></p>
          )}
        </div>
      </div>

      {/* 0047 — i campi decisi dall'azienda, IN FONDO ai campi nativi e con lo
          stesso aspetto. Non rendono nulla se non ne esiste nessuno. */}
      <CrmFieldsCard companyId={company.id} entity="opportunity" entityId={deal.id} />

      <div className="crm-sec">
        <div className="crm-sec-head"><strong>{t('crm.detail.tasks')}</strong></div>
        {tasks.length === 0 ? (
          <EmptyCta title={t('crm.detail.emptyTasks')} />
        ) : (
          <ul className="crm-list">
            {tasks.map((k) => (
              <li className="list-row" key={k.id}>
                <Link className={styles.crmRowLink} to={`/attivita/${k.id}`}>
                  <span className="list-title">{k.title}</span>
                  {k.dueDate && <div className="list-sub">{formatDate(k.dueDate)}</div>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!isOpen(deal.stage) && (
        <p className="muted-sm mt-8">{t('crm.disclaimer')}</p>
      )}
    </>
  );
}
