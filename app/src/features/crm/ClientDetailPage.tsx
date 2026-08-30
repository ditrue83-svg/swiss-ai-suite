// ============================================================================
// La scheda di una controparte — «chi è questo cliente».
//
// ⚠️⚠️ QUESTA PAGINA NON POSSIEDE NESSUN DATO DEGLI ALTRI MODULI, e ogni scheda
// lo dichiara: il nome che il contratto ha letto compare accanto all'identità
// CRM, non al suo posto; le comunicazioni mostrano oggetto, mittente e data e
// per il contenuto si apre l'Inbox; le fatture mostrano il fornitore ESTRATTO.
// La regola è una sola: COLLEGARE, NON COPIARE.
//
// ⚠️ §77 — NON esiste, e non deve esistere, un numero di «ricavi» o di «acquisti
// totali». Finanze gestisce fatture FORNITORE e spese: un valore di opportunità
// è una stima e un contratto non è un incasso.
//
// ⚠️ §57 — non esiste «Invia campagna», «Avvia sequenza», «Chiama». Le uniche
// azioni sono: nuova attività, nuova opportunità, aggiungi contatto, collega,
// modifica, archivia.
//
// La pagina risponde in meno di dieci secondi a: chi sono le persone, che lavoro
// è aperto, che cosa ci siamo scritti, quali contratti ci legano, a che punto
// sono le trattative.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tag } from '@/components/ui/Tag';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { EmptyCta, ErrorState, SkeletonCard } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { crmService } from '@/services/crmService';
import { memberService } from '@/services/memberService';
import { taskService } from '@/services/taskService';
import { formatDate, formatCurrency } from '@/lib/format';
import { useT, type TFunction, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { useDocumentLabel } from '@/i18n/documentLabel';
import type {
  AssignableMember, CrmContractLink, CrmDocumentLink, CrmDuplicateCandidate,
  CrmEmailLink, CrmFinanceLink, CrmInteraction, CrmOpportunity, CrmOrganization,
  CrmPerson, CrmTimelineEntry,
} from '@/types/models';
import type { CrmInteractionType, CrmOrganizationRole } from '@/types/database';
import { AskAbout } from '@/features/assistant/AskAbout';
import { CrmFieldsCard } from './CrmFieldsCard';
import { CrmEmailComposer } from './CrmEmailComposer';
import {
  CRM_TIMELINE_PAGE_SIZE, DEFAULT_STALE_DAYS, daysSince,
  organizationState, organizationStateKey, opportunityState, opportunityStateKey,
  safeWebsite, secondaryName,
} from './crmModel';
import { cx } from '@/lib/cx';
import styles from './crm.module.css';

type Tab = 'overview' | 'people' | 'opportunities' | 'tasks'
  | 'communications' | 'documents' | 'contracts' | 'finance' | 'history';

const TABS: Tab[] = [
  'overview', 'people', 'opportunities', 'tasks',
  'communications', 'documents', 'contracts', 'finance', 'history',
];
const TAB_KEY: Record<Tab, TKey> = {
  overview: 'crm.detail.overview',
  people: 'crm.detail.people',
  opportunities: 'crm.detail.opportunities',
  tasks: 'crm.detail.tasks',
  communications: 'crm.detail.communications',
  documents: 'crm.detail.documents',
  contracts: 'crm.detail.contracts',
  finance: 'crm.detail.finance',
  history: 'crm.detail.history',
};

const ALL_ROLES: CrmOrganizationRole[] = [
  'lead', 'prospect', 'customer', 'former_customer',
  'supplier', 'partner', 'authority', 'other',
];
const INTERACTION_TYPES: CrmInteractionType[] = ['call', 'meeting', 'note', 'other'];

interface LinkedTask {
  id: string; title: string; status: string; priority: string;
  dueDate: string | null; assigneeUserId: string | null; opportunityId: string | null;
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { activeCompany: company } = useCompany();
  const { user } = useAuth();
  const t = useT();
  const L = useLabels();
  const { showToast } = useToast();

  const [tab, setTab] = useState<Tab>('overview');
  const [org, setOrg] = useState<CrmOrganization | null>(null);
  const [people, setPeople] = useState<CrmPerson[]>([]);
  const [deals, setDeals] = useState<CrmOpportunity[]>([]);
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [emails, setEmails] = useState<CrmEmailLink[]>([]);
  const [docs, setDocs] = useState<CrmDocumentLink[]>([]);
  const [contracts, setContracts] = useState<CrmContractLink[]>([]);
  const [finance, setFinance] = useState<CrmFinanceLink[]>([]);
  const [interactions, setInteractions] = useState<CrmInteraction[]>([]);
  const [duplicates, setDuplicates] = useState<CrmDuplicateCandidate[]>([]);
  const [timeline, setTimeline] = useState<CrmTimelineEntry[]>([]);
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * ⚠️ RILEGGE SEMPRE dopo un'azione, non aggiorna lo stato a mano.
   * Lo storico e i timbri li scrivono i trigger: la schermata non sa cosa il
   * database ha registrato, e indovinarlo sarebbe raccontare una storia
   * parallela a quella vera. È la correzione già fatta nel dettaglio delle
   * Attività, dove lo storico restava fermo dopo un commento.
   */
  // ⚠️ Quale risposta sta guardando la scheda. Cambiando cliente — o azienda —
  // l'effetto rilancia `load`, ma la richiesta di prima resta in volo: se
  // risolve dopo, la scheda si riempie dei dati del cliente PRECEDENTE sotto il
  // nome di quello nuovo. Stesso schema di `useAsync` e della Inbox.
  const richiesta = useRef(0);

  const load = useCallback(async () => {
    if (!company || !id) return;
    const mia = ++richiesta.current;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const found = await crmService.get(company.id, id);
      if (mia !== richiesta.current) return;
      if (!found) { setNotFound(true); return; }
      setOrg(found);
      const [p, d, tk, em, dc, ct, fi, it, dup, tl, dir] = await Promise.all([
        crmService.people(company.id, id),
        crmService.opportunities(company.id, { organizationId: id, limit: 50 }),
        crmService.linkedTasks(company.id, id),
        crmService.linkedEmails(company.id, id),
        crmService.linkedDocuments(company.id, id),
        crmService.linkedContracts(company.id, id),
        crmService.linkedFinance(company.id, id),
        crmService.interactions(company.id, id),
        crmService.duplicates(company.id, id),
        crmService.timeline(company.id, id, 0),
        memberService.listAssignable(company.id).catch(() => [] as AssignableMember[]),
      ]);
      if (mia !== richiesta.current) return;
      setPeople(p); setDeals(d.items); setTasks(tk); setEmails(em); setDocs(dc);
      setContracts(ct); setFinance(fi); setInteractions(it); setDuplicates(dup);
      setTimeline(tl.entries); setTimelineTotal(tl.total); setMembers(dir);
    } catch (e) {
      if (mia !== richiesta.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mia === richiesta.current) setLoading(false);
    }
  }, [company, id]);

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

  function nameOf(userId: string | null): string | null {
    if (!userId) return null;
    return members.find((m) => m.userId === userId)?.name || null;
  }

  const legal = useMemo(() => (org ? secondaryName(org) : null), [org]);

  if (!company) return null;
  // §117 — non si distingue «non esiste» da «è di un'altra azienda»: la seconda
  // risposta confermerebbe l'esistenza di un dato altrui.
  if (notFound) return <ErrorState message={t('crm.notFound')} />;
  if (loading && !org) return <SkeletonCard />;
  if (error && !org) return <ErrorState message={t(error as TKey) || error} onRetry={() => void load()} />;
  if (!org) return null;

  const state = organizationState(org, DEFAULT_STALE_DAYS);

  return (
    <>
      <div className="page-head ct-head">
        <div>
          <div className="page-title">{org.displayName}</div>
          {legal && <div className="page-desc">{legal}</div>}
          <div className={styles.crmRoles}>
            <Tag>{t(organizationStateKey(state))}</Tag>
            {/* Neutro, non blu: gli stessi ruoli erano neutri nell'elenco e blu
                qui — due pesi per lo stesso fatto. E `badge-blue` è il blu
                d'AZIONE, che dal 2026-08-13 non marca più uno stato. */}
            {org.roles.map((r) => (
              <Tag key={r}>{L.crmRole(r)}</Tag>
            ))}
          </div>
        </div>
        <div className="row-wrap">
          {!org.archivedAt && <CrmEmailComposer companyId={company.id} organizationId={org.id} onSent={() => void load()} />}
          {/* §120 — la domanda parte dalla scheda che si sta guardando. */}
          <AskAbout type="crm_organization" id={org.id} label={org.displayName} />
          <Link className="btn btn-primary" to={`/clienti/${org.id}/opportunita/nuova`}>
            <Icon name="plus" className="ic-sm" /> {t('crm.addOpportunity')}
          </Link>
          {org.archivedAt ? (
            <button
              type="button" className="btn" disabled={busy}
              onClick={() => void run(() => crmService.restore(org.id), 'crm.form.restored')}
            >
              <Icon name="refresh" className="ic-sm" /> {t('crm.detail.restore')}
            </button>
          ) : (
            <button
              type="button" className="btn" disabled={busy}
              onClick={() => void run(() => crmService.archive(org.id), 'crm.form.archived')}
            >
              <Icon name="archive" className="ic-sm" /> {t('crm.detail.archive')}
            </button>
          )}
        </div>
      </div>

      {/* §31 — dopo una fusione il record secondario non sparisce: resta e
          RIMANDA, così i vecchi collegamenti portano ancora da qualche parte. */}
      {org.mergedIntoId && (
        <div className="warn-box">
          {t('crm.detail.mergedInto')}{' '}
          <Link to={`/clienti/${org.mergedIntoId}`}>{t('crm.detail.openMerged')}</Link>
        </div>
      )}

      <nav className="tabs" aria-label={t('crm.title')}>
        {TABS.map((v) => (
          <button
            key={v} type="button"
            className={`tab ${tab === v ? 'active' : ''}`}
            aria-current={tab === v ? 'page' : undefined}
            onClick={() => setTab(v)}
          >
            {t(TAB_KEY[v])}
            {v === 'people' && people.length > 0 && ` (${people.length})`}
            {v === 'opportunities' && deals.length > 0 && ` (${deals.length})`}
            {v === 'tasks' && tasks.length > 0 && ` (${tasks.length})`}
            {v === 'communications' && emails.length > 0 && ` (${emails.length})`}
            {v === 'documents' && docs.length > 0 && ` (${docs.length})`}
            {v === 'contracts' && contracts.length > 0 && ` (${contracts.length})`}
            {v === 'finance' && finance.length > 0 && ` (${finance.length})`}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <OverviewTab
          org={org} companyId={company.id} ownerName={nameOf(org.accountOwnerUserId)} members={members}
          duplicates={duplicates} busy={busy} t={t} L={L}
          onSetOwner={(uid) => void run(
            () => crmService.update(org.id, { accountOwnerUserId: uid }), 'crm.form.updated')}
          onAddRole={(r) => void run(
            () => crmService.addRole(company.id, org.id, r), 'crm.form.updated')}
          onRemoveRole={(r) => void run(
            () => crmService.removeRole(org.id, r), 'crm.form.updated')}
        />
      )}

      {tab === 'people' && (
        <PeopleTab
          people={people} companyId={company.id} organizationId={org.id}
          busy={busy} t={t}
          onAdded={() => void load()}
        />
      )}

      {tab === 'opportunities' && (
        <OpportunitiesTab deals={deals} orgId={org.id} nameOf={nameOf} t={t} L={L} />
      )}

      {tab === 'tasks' && (
        <TasksTab
          tasks={tasks} nameOf={nameOf} t={t} busy={busy}
          onCreate={(title) => void run(async () => {
            if (!user) return;
            await taskService.create({
              companyId: company.id, userId: user.id, title,
              source: 'crm', crmOrganizationId: org.id,
            });
          }, 'crm.form.linkedOk')}
        />
      )}

      {tab === 'communications' && <CommunicationsTab emails={emails} t={t} L={L} />}
      {tab === 'documents' && <DocumentsTab docs={docs} t={t} L={L} />}
      {tab === 'contracts' && <ContractsTab contracts={contracts} nameOf={nameOf} t={t} L={L} />}
      {tab === 'finance' && <FinanceTab items={finance} t={t} />}

      {tab === 'history' && (
        <HistoryTab
          timeline={timeline} total={timelineTotal} interactions={interactions}
          nameOf={nameOf} t={t} L={L} busy={busy}
          onMore={async () => {
            const next = await crmService.timeline(company.id, org.id, timeline.length);
            setTimeline((prev) => [...prev, ...next.entries]);
            setTimelineTotal(next.total);
          }}
          onAddInteraction={(type, subject, notes) => void run(
            () => crmService.addInteraction(company.id, org.id, { type, subject, notes }),
            'crm.form.interactionAdded')}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function OverviewTab(props: {
  org: CrmOrganization; companyId: string; ownerName: string | null; members: AssignableMember[];
  duplicates: CrmDuplicateCandidate[]; busy: boolean;
  t: TFunction; L: ReturnType<typeof useLabels>;
  onSetOwner: (uid: string | null) => void;
  onAddRole: (r: CrmOrganizationRole) => void;
  onRemoveRole: (r: CrmOrganizationRole) => void;
}) {
  const { org: o, t, L } = props;
  const days = o.lastContactAt ? daysSince(o.lastContactAt) : null;

  return (
    <>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">{t('crm.detail.identifiers')}</div>
          <dl className="crm-kv">
            <dt>{t('crm.form.uid')}</dt>
            <dd>{o.uidChe ?? '—'}</dd>
            <dt>{t('crm.form.vat')}</dt>
            <dd>{o.vatNumber ?? '—'}</dd>
            <dt>{t('crm.form.website')}</dt>
            <dd>
              {/* ⚠️ Il valore in colonna non decide da solo di diventare un
                  collegamento: un `javascript:…` scritto qui dentro eseguirebbe
                  codice a chi lo clicca. Se non è http/https resta TESTO —
                  visibile, perché nasconderlo nasconderebbe anche il problema
                  a chi deve correggerlo. */}
              {o.website
                ? (safeWebsite(o.website)
                  ? <a href={o.website} target="_blank" rel="noreferrer noopener">{o.website}</a>
                  : o.website)
                : '—'}
            </dd>
            <dt>{t('crm.detail.source')}</dt>
            <dd>{L.crmSource(o.source)}</dd>
          </dl>
          {/* §19 — la provenienza NON è una verifica, e la riga lo dice. */}
          <p className="muted-sm mt-8">{t('crm.detail.sourceHint')}</p>
        </div>

        <div className="card">
          <div className="card-title">{t('crm.detail.address')}</div>
          <dl className="crm-kv">
            <dt>{t('crm.form.street')}</dt>
            <dd>{o.street ?? '—'}</dd>
            <dt>{t('crm.form.city')}</dt>
            <dd>{[o.postalCode, o.city].filter(Boolean).join(' ') || '—'}</dd>
            <dt>{t('crm.form.canton')}</dt>
            <dd>{o.canton ?? '—'}</dd>
          </dl>
        </div>
      </div>

      <div className="grid-2 mt-8">
        <div className="card">
          <div className="card-title">{t('crm.detail.owner')}</div>
          <div className="field">
            <label className="sr-only" htmlFor="o-owner">{t('crm.detail.owner')}</label>
            <select
              id="o-owner" value={o.accountOwnerUserId ?? ''} disabled={props.busy}
              onChange={(e) => props.onSetOwner(e.target.value || null)}
            >
              <option value="">{t('crm.form.noOwner')}</option>
              {props.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || m.userId.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>

          <div className="card-title mt-8">{t('crm.detail.lastContact')}</div>
          <p>
            {days === null
              ? <em>{t('crm.detail.neverContacted')}</em>
              : <>{formatDate(o.lastContactAt)} · {t('tasks.dueInDays', { n: days })}</>}
          </p>
          {/* §67 — da dove viene questo numero, perché non contraddica la
              timeline che sta qui sotto. */}
          <p className="muted-sm">{t('crm.detail.lastContactHint')}</p>
        </div>

        <div className="card">
          <div className="card-title">{t('crm.detail.roles')}</div>
          <div className={styles.crmRoles}>
            {ALL_ROLES.map((r) => {
              const on = o.roles.includes(r);
              // ⚠️ `.check-pill` e NON `.badge`: questo si CLICCA. Un badge su
              // un <button> non porta né bordo né stato di hover — sembra
              // un'etichetta e invece è il comando che aggiunge o toglie un
              // ruolo. Lo stesso gesto usa già `.check-pill` in ClientCreatePage
              // e nei filtri dell'elenco: erano tre vestiti per la stessa
              // scelta, dentro lo stesso modulo.
              return (
                <button
                  key={r} type="button" disabled={props.busy}
                  className="check-pill"
                  aria-pressed={on}
                  onClick={() => (on ? props.onRemoveRole(r) : props.onAddRole(r))}
                >
                  {L.crmRole(r)}
                </button>
              );
            })}
          </div>
          <p className="muted-sm mt-8">{t('crm.form.rolesHint')}</p>
        </div>
      </div>

      {o.notes && (
        <div className="card mt-8">
          <div className="card-title">{t('crm.detail.notes')}</div>
          {/* Testo semplice: nessun markup, nessun HTML. */}
          <p style={{ whiteSpace: 'pre-wrap' }}>{o.notes}</p>
          <p className="muted-sm">{t('crm.detail.notesHint')}</p>
        </div>
      )}

      {/* 0047 — i campi decisi dall'azienda, IN FONDO ai campi nativi e con lo
          stesso aspetto. Non rendono nulla se non ne esiste nessuno. */}
      <CrmFieldsCard companyId={props.companyId} entity="organization" entityId={o.id} />

      {/* §28-§30 — i duplicati si MOSTRANO, non si risolvono da soli. */}
      {props.duplicates.length > 0 && (
        <div className={styles.crmAsk}>
          <div className="crm-sec-head">
            <strong>{t('crm.duplicates.title')}</strong>
            <span className="muted-sm">{t('crm.duplicates.hint')}</span>
          </div>
          {props.duplicates.map((d) => (
            <div className={styles.crmAskRow} key={d.duplicateId}>
              <div className={styles.crmAskMain}>
                <Link to={`/clienti/${d.duplicateId}`}>{d.duplicateName}</Link>
                <div className="muted-sm">
                  {/* I due punti nella chiave: in francese vogliono U+202F. */}
                  {t('crm.suggestions.reasonWith', { reason: L.crmReason(d.reason) })}
                  {d.reasonDetail ? ` · ${d.reasonDetail}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function PeopleTab(props: {
  people: CrmPerson[]; companyId: string; organizationId: string;
  busy: boolean; t: TFunction; onAdded: () => void;
}) {
  const { t } = props;
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (saving || name.trim() === '') return;
    setSaving(true);
    try {
      await crmService.addPerson(props.companyId, props.organizationId, {
        displayName: name, jobTitle: jobTitle || null,
        email: email || null, phone: phone || null,
        isPrimary: props.people.length === 0,
      });
      showToast(t('crm.form.personAdded'));
      setName(''); setJobTitle(''); setEmail(''); setPhone(''); setOpen(false);
      props.onAdded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t(msg as TKey) || msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="crm-sec-head">
        <span />
        <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
          <Icon name="plus" className="ic-sm" /> {t('crm.addPerson')}
        </button>
      </div>

      {open && (
        <form className={cx('card', styles.crmNarrow)} onSubmit={add}>
          <div className="field">
            <label htmlFor="p-name">{t('crm.people.name')}</label>
            <input id="p-name" value={name} required maxLength={200}
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="p-job">{t('crm.people.jobTitle')}</label>
              <input id="p-job" value={jobTitle} maxLength={120}
                onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-mail">{t('crm.people.email')}</label>
              <input id="p-mail" type="email" value={email} maxLength={200}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="p-tel">{t('crm.people.phone')}</label>
            <input id="p-tel" value={phone} maxLength={40}
              onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit"
            disabled={saving || name.trim() === ''} aria-busy={saving || undefined}>
            {t('crm.form.save')}
          </button>
        </form>
      )}

      {props.people.length === 0 ? (
        <EmptyCta title={t('crm.detail.emptyPeople')} />
      ) : (
        <ul className="crm-list">
          {props.people.map((p) => {
            const rel = p.organizations[0];
            const mail = p.methods.find((m) => m.type === 'email');
            const tel = p.methods.find((m) => m.type === 'phone' || m.type === 'mobile');
            return (
              <li className="list-row" key={p.contact.id}>
                <div className="list-main">
                  <span className="list-title">{p.contact.displayName}</span>
                  {rel?.isPrimary && (
                    <Tag tone="info">{t('crm.people.primary')}</Tag>
                  )}
                  {p.contact.archivedAt && (
                    <Tag>{t('crm.states.archived')}</Tag>
                  )}
                  <div className="list-sub">
                    {rel?.jobTitle ?? <em>—</em>}
                    {rel?.activeUntil && <> · {t('crm.people.formerly', { date: formatDate(rel.activeUntil) })}</>}
                  </div>
                </div>
                <div className="list-sub">
                  {/* §162 — `mailto:` e `tel:` aprono il programma dell'utente.
                      NON inviano niente, e la riga sotto lo dice. */}
                  {mail && <a href={`mailto:${mail.value}`}>{mail.value}</a>}
                  {tel && <a href={`tel:${tel.value}`}>{tel.value}</a>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {props.people.length > 0 && <p className="muted-sm mt-8">{t('crm.people.writeHint')}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
function OpportunitiesTab(props: {
  deals: CrmOpportunity[]; orgId: string;
  nameOf: (id: string | null) => string | null;
  t: TFunction; L: ReturnType<typeof useLabels>;
}) {
  const { t, L } = props;
  if (props.deals.length === 0) return <EmptyCta title={t('crm.detail.emptyOpportunities')} />;
  return (
    <ul className="crm-list">
      {props.deals.map((d) => {
        const st = opportunityState(d);
        return (
          <li className="list-row" key={d.id}>
            <Link className={styles.crmRowLink} to={`/clienti/${props.orgId}/opportunita/${d.id}`}>
              <div className="list-main">
                <span className="list-title">{d.title}</span>
                <Tag>{L.crmStage(d.stage)}</Tag>
                {(st === 'overdue_step' || st === 'no_step') && (
                  <Tag tone="attention">{t(opportunityStateKey(st))}</Tag>
                )}
              </div>
              <div className="list-sub">
                {/* §46 — «non stimato» non è zero: formatCurrency torna null
                    senza valuta, e qui lo si DICE invece di stampare CHF 0. */}
                <span>
                  {formatCurrency(d.valueAmount, d.valueCurrency)
                    ?? <em>{t('crm.opp.noValue')}</em>}
                </span>
                <span>{props.nameOf(d.ownerUserId) ?? <em>{t('crm.row.noOwner')}</em>}</span>
                {d.nextStep
                  ? <span>{t('crm.opp.nextStep')}: {d.nextStep}</span>
                  : <em>{t('crm.opp.noNextStep')}</em>}
                {d.nextStepDueDate && <span>{formatDate(d.nextStepDueDate)}</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
function TasksTab(props: {
  tasks: LinkedTask[]; nameOf: (id: string | null) => string | null;
  t: TFunction; busy: boolean; onCreate: (title: string) => void;
}) {
  const { t } = props;
  const [title, setTitle] = useState('');
  return (
    <>
      <form
        className={cx('field', styles.crmNarrow)}
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() === '') return;
          props.onCreate(title.trim());
          setTitle('');
        }}
      >
        <label htmlFor="tk-new">{t('crm.detail.newTask')}</label>
        <div className="row-wrap">
          <input id="tk-new" value={title} maxLength={200}
            onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button className="btn btn-sm" type="submit" disabled={props.busy || title.trim() === ''}>
            <Icon name="plus" className="ic-sm" /> {t('crm.form.save')}
          </button>
        </div>
      </form>

      {props.tasks.length === 0 ? (
        <EmptyCta title={t('crm.detail.emptyTasks')} />
      ) : (
        <ul className="crm-list">
          {props.tasks.map((k) => (
            <li className="list-row" key={k.id}>
              <Link className={styles.crmRowLink} to={`/attivita/${k.id}`}>
                <div className="list-main">
                  <span className="list-title">{k.title}</span>
                </div>
                <div className="list-sub">
                  {k.dueDate && <span>{formatDate(k.dueDate)}</span>}
                  <span>{props.nameOf(k.assigneeUserId) ?? <em>{t('crm.row.noOwner')}</em>}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
/** ⚠️ SOLO METADATI. Il corpo di una email non passa da questa pagina (§61). */
function deliveryReason(raw: string, t: TFunction): string {
  return raw.includes('destinatario')
    ? t('crm.emailReason.recipientRejected')
    : t('crm.emailReason.providerFailed');
}

function CommunicationsTab(props: {
  emails: CrmEmailLink[]; t: TFunction; L: ReturnType<typeof useLabels>;
}) {
  const { t, L } = props;
  if (props.emails.length === 0) return <EmptyCta title={t('crm.detail.emptyCommunications')} />;
  return (
    <>
      <ul className="crm-list">
        {props.emails.map((m) => {
          const statusTone = m.deliveryStatus === 'delivered' ? 'ok'
            : m.deliveryStatus === 'failed' ? 'alert' : 'neutral';
          return <li className="list-row" key={m.id}>
            <div className="list-main">
              <span className="list-title">
                {m.subject ?? <em>—</em>}
                {m.direction === 'out' && m.deliveryStatus && (
                  <> <Tag tone={statusTone}>{t(`crm.emailStatus.${m.deliveryStatus}` as TKey)}</Tag></>
                )}
              </span>
              <div className="list-sub">
                {m.senderName ?? m.senderEmail ?? '—'}
                {(m.sentAt ?? m.receivedAt) && <> · {formatDate(m.sentAt ?? m.receivedAt)}</>}
                {' · '}{L.crmReason(m.matchReason)}
              </div>
              {m.deliveryStatus === 'failed' && m.deliveryErrorSafe && (
                <div className="list-sub">{deliveryReason(m.deliveryErrorSafe, t)}</div>
              )}
            </div>
            {m.direction === 'in' && <Link className="btn btn-sm btn-ghost" to="/inbox">
              <Icon name="inbox" className="ic-sm" /> {t('nav.inbox')}
            </Link>}
          </li>
        })}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
function DocumentsTab(props: {
  docs: CrmDocumentLink[]; t: TFunction; L: ReturnType<typeof useLabels>;
}) {
  const { t, L } = props;
  const docLabel = useDocumentLabel();
  if (props.docs.length === 0) return <EmptyCta title={t('crm.detail.emptyDocuments')} />;
  return (
    <ul className="crm-list">
      {props.docs.map((d) => (
        <li className="list-row" key={d.id}>
          <Link className={styles.crmRowLink} to={`/documenti/${d.documentId}`}>
            <div className="list-main">
              <span className="list-title">{docLabel(d.label)}</span>
              <Tag>{L.crmRelation(d.relation)}</Tag>
            </div>
            <div className="list-sub">
              {d.category && <span>{L.category(d.category)}</span>}
              {/* ⚠️ La data del CARICAMENTO, non la data del documento: quella
                  è un valore effettivo che vive nell'analisi, e chiamarla così
                  sarebbe falso. */}
              {d.uploadedAt && <span>{formatDate(d.uploadedAt)}</span>}
              <span>{L.crmReason(d.matchReason)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
/**
 * ⚠️ `counterpartyName` è il nome che i CONTRATTI hanno letto, e si mostra
 * ACCANTO all'identità CRM, non al suo posto. La differenza è la cosa più utile
 * di questa scheda: «il contratto dice Swisscom (Svizzera) SA, e noi la
 * chiamiamo Swisscom» è una verifica; farle coincidere a forza sarebbe una
 * riscrittura.
 */
function ContractsTab(props: {
  contracts: CrmContractLink[]; nameOf: (id: string | null) => string | null;
  t: TFunction; L: ReturnType<typeof useLabels>;
}) {
  const { t, L } = props;
  if (props.contracts.length === 0) return <EmptyCta title={t('crm.detail.emptyContracts')} />;
  return (
    <ul className="crm-list">
      {props.contracts.map((c) => (
        <li className="list-row" key={c.id}>
          <Link className={styles.crmRowLink} to={`/contratti/${c.id}`}>
            <div className="list-main">
              <span className="list-title">{c.displayName}</span>
              <Tag>{L.contractType(c.contractType)}</Tag>
              <Tag>{L.contractLifecycle(c.lifecycleStatus)}</Tag>
            </div>
            <div className="list-sub">
              {c.counterpartyName && (
                <span>{t('crm.link.relation')}: {c.counterpartyName}</span>
              )}
              <span>{props.nameOf(c.ownerUserId) ?? <em>{t('crm.row.noOwner')}</em>}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
/**
 * ⚠️ §77 e §78 — NON è un totale d'acquisto, e la pagina lo dichiara due volte:
 * Finanze conosce solo le fatture che qualcuno ha caricato, e un totale
 * calcolato su un insieme incompleto sarebbe un numero che qualcuno userebbe
 * per decidere.
 */
function FinanceTab(props: { items: CrmFinanceLink[]; t: TFunction }) {
  const { t } = props;
  if (props.items.length === 0) return <EmptyCta title={t('crm.detail.emptyFinance')} />;
  return (
    <>
      <p className="muted-sm">{t('crm.detail.financeHint')}</p>
      <ul className="crm-list">
        {props.items.map((f) => (
          <li className="list-row" key={f.id}>
            <Link className={styles.crmRowLink} to={`/finanze/${f.id}`}>
              <div className="list-main">
                {/* Il fornitore ESTRATTO dal documento, non il nome CRM. */}
                <span className="list-title">{f.supplierName ?? <em>—</em>}</span>
              </div>
              <div className="list-sub">
                <span>{formatCurrency(f.grossAmount, f.currency) ?? <em>—</em>}</span>
                {f.dueDate && <span>{formatDate(f.dueDate)}</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <p className="muted-sm mt-8">{t('crm.detail.noRevenue')}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
/**
 * La storia della relazione.
 *
 * ⚠️ §61 — COMPONE riferimenti. Ogni riga porta un oggetto o un titolo, una
 * data e un'entità da aprire: nessun corpo di email, nessun testo di documento,
 * nessuna clausola.
 */
function HistoryTab(props: {
  timeline: CrmTimelineEntry[]; total: number; interactions: CrmInteraction[];
  nameOf: (id: string | null) => string | null;
  t: TFunction; L: ReturnType<typeof useLabels>; busy: boolean;
  onMore: () => Promise<void>;
  onAddInteraction: (type: CrmInteractionType, subject: string | null, notes: string | null) => void;
}) {
  const { t, L } = props;
  const [type, setType] = useState<CrmInteractionType>('call');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [more, setMore] = useState(false);

  const KIND_KEY: Record<CrmTimelineEntry['kind'], TKey> = {
    email: 'crm.timeline.email',
    interaction: 'crm.timeline.interaction',
    event: 'crm.detail.history',
    task_created: 'crm.timeline.taskCreated',
    task_completed: 'crm.timeline.taskCompleted',
    contract: 'crm.timeline.contract',
  };

  return (
    <>
      {/* §63 — un contatto che nessun altro modulo registra. Le email NON si
          scrivono qui: restano nell'Inbox e si collegano (§64). */}
      <form
        className={cx('card', styles.crmNarrow)}
        onSubmit={(e) => {
          e.preventDefault();
          props.onAddInteraction(type, subject.trim() || null, notes.trim() || null);
          setSubject(''); setNotes('');
        }}
      >
        <div className="card-title">{t('crm.addInteraction')}</div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="i-type">{t('crm.filters.role')}</label>
            <select id="i-type" value={type}
              onChange={(e) => setType(e.target.value as CrmInteractionType)}>
              {INTERACTION_TYPES.map((k) => (
                <option key={k} value={k}>{L.crmInteraction(k)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="i-subject">{t('crm.opp.title')}</label>
            <input id="i-subject" value={subject} maxLength={200}
              onChange={(e) => setSubject(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="i-notes">{t('crm.detail.notes')}</label>
          <textarea id="i-notes" value={notes} maxLength={5000} rows={3}
            onChange={(e) => setNotes(e.target.value)} />
          <div className="field-hint">{t('crm.detail.notesHint')}</div>
        </div>
        <button className="btn btn-sm btn-primary" type="submit" disabled={props.busy}>
          {t('crm.form.save')}
        </button>
      </form>

      {props.timeline.length === 0 ? (
        <EmptyCta title={t('crm.detail.emptyHistory')} />
      ) : (
        <>
          <ul className="crm-tl">
            {props.timeline.map((e) => (
              <li key={e.id}>
                <div className="crm-tl-when">{formatDate(e.occurredAt)}</div>
                <div className="crm-tl-what">
                  {t(e.kind === 'email' && e.detail.direction === 'out'
                    ? 'crm.timeline.emailSent' : KIND_KEY[e.kind])}
                  {e.title ? <> — {e.title}</> : null}
                </div>
                <div className={styles.crmTlSub}>
                  {e.actorUserId
                    ? (props.nameOf(e.actorUserId) ?? t('crm.timeline.someone'))
                    : null}
                  {e.kind === 'event' && typeof e.detail.kind === 'string' && (
                    <> · {String(e.detail.kind)}</>
                  )}
                  {e.kind === 'email' && e.detail.direction === 'out' && typeof e.detail.deliveryStatus === 'string' && (
                    <> · <Tag tone={e.detail.deliveryStatus === 'delivered' ? 'ok' : e.detail.deliveryStatus === 'failed' ? 'alert' : 'neutral'}>
                      {t(`crm.emailStatus.${e.detail.deliveryStatus}` as TKey)}
                    </Tag></>
                  )}
                  {e.kind === 'email' && e.detail.deliveryStatus === 'failed' && typeof e.detail.deliveryErrorSafe === 'string' && (
                    <> · {deliveryReason(e.detail.deliveryErrorSafe, t)}</>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {props.timeline.length < props.total && (
            <button
              type="button" className="btn btn-sm mt-8" disabled={more}
              onClick={() => { setMore(true); void props.onMore().finally(() => setMore(false)); }}
            >
              {t('crm.timeline.more')} ({props.timeline.length} / {props.total})
            </button>
          )}
        </>
      )}
    </>
  );
}
