// ============================================================================
// Il dettaglio di un contratto.
//
// ⚠️⚠️ QUESTA SCHERMATA DICE CHE COSA IL DOCUMENTO CONTIENE, MAI CHE COSA IL
// DIRITTO IMPONE. «Il contratto indica un preavviso di tre mesi» si può
// scrivere; «puoi disdire con tre mesi di preavviso» no. Non esiste un pulsante
// che disdica, rinnovi, firmi o scriva alla controparte, e non deve esistere.
//
// LE TRE REGOLE CHE GOVERNANO OGNI RIGA DI QUESTO FILE:
//
// 1. OGNI DATO IMPORTANTE PUÒ MOSTRARE LA PROPRIA CLAUSOLA. «Mostra clausola»
//    apre la citazione verificata contro il testo del documento — e la
//    citazione è il TESTO CONTRATTUALE, mentre le nostre frasi sono altro
//    (§125). Non si presenta mai una parafrasi come se fosse il contratto.
//
// 2. UNA PROPOSTA NON SI MOSTRA COME UN FATTO. I termini non ancora verificati
//    portano un avviso; le date `candidate` dicono «da verificare» accanto alla
//    data; il pulsante «Crea attività» NON compare su una data non verificata,
//    perché un pulsante che porta a un rifiuto è un difetto (§87).
//
// 3. QUANDO UNA DATA NON SI PUÒ RICAVARE, LO SI DICE. Il posto vuoto accanto a
//    «Preavviso: 3 mesi» verrebbe letto come «nessuna scadenza»: al suo posto
//    c'è la ragione per cui il calcolo non è possibile (§39/§141).
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { CrmLinkPicker } from '@/features/crm/CrmLinkPicker';
import { useCrmLink } from '@/features/crm/useCrmLink';
import { useToast } from '@/components/ui/Toast';
import { ErrorState, FullScreenLoader } from '@/components/ui/states';
import { contractService } from '@/services/contractService';
import { memberService } from '@/services/memberService';
import { documentService } from '@/services/documentService';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { useT, type TFunction, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { AskAbout } from '@/features/assistant/AskAbout';
import {
  canCreateTask, compareTerms, daysUntil, noticeUnavailableReason, openMilestones,
} from './contractModel';
import type {
  AssignableMember, ContractDetail, ContractDocumentLink, ContractDocumentRelation,
  ContractEvidence, ContractExtraction, ContractMilestone, ContractTermVersion,
} from '@/types/models';

const RELATIONS: ContractDocumentRelation[] =
  ['main_agreement', 'amendment', 'annex', 'renewal', 'termination_notice', 'other'];

const REASON_KEY = {
  no_notice_period: 'contracts.milestones.reasons.no_notice_period',
  anchor_unclear: 'contracts.milestones.reasons.anchor_unclear',
  anchor_not_derivable: 'contracts.milestones.reasons.anchor_not_derivable',
  no_end_date: 'contracts.milestones.reasons.no_end_date',
} as const satisfies Record<string, TKey>;

export function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeCompany: company } = useCompany();
  // 0026 — la controparte nel CRM. ⚠️ Si legge con un select su una riga e NON
  // da `list_contracts`: aggiungere una colonna a quel `returns table`
  // richiederebbe `drop function` con la firma a 15 argomenti, e per un dato che
  // serve solo qui quel rischio non si paga.
  const crmLink = useCrmLink('contract', company?.id, id);
  const { user } = useAuth();
  const t = useT();
  const L = useLabels();
  const { showToast } = useToast();

  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!company || !id) return;
    setError(null);
    try {
      const [d, dir] = await Promise.all([
        contractService.get(id, company.id),
        memberService.listAssignable(company.id).catch(() => [] as AssignableMember[]),
      ]);
      setDetail(d);
      setMembers(dir);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setLoading(false);
    }
  }, [company, id]);

  useEffect(() => { void load(); }, [load]);

  const nameOf = (userId: string | null): string | null =>
    userId ? (members.find((m) => m.userId === userId)?.name || null) : null;

  /**
   * ⚠️ SI RILEGGE DOPO OGNI SCRITTURA, non si indovina lo stato nuovo.
   * Bozza, bandiere, date e storico li ricalcolano i trigger della 0024: la
   * schermata non sa che cosa il database abbia scritto, e raccontarlo per
   * conto proprio produrrebbe una storia parallela a quella vera — è la lezione
   * dello storico delle Attività.
   */
  async function run(action: () => Promise<unknown>, successKey: TKey) {
    setBusy(true);
    try {
      await action();
      await load();
      showToast(t(successKey));
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <FullScreenLoader label={t('common.loading')} />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!detail) return <ErrorState message={t('errors.notFound')} />;

  const { contract: c, terms, draft } = detail;
  // I termini che si mostrano: quelli in vigore, oppure la bozza — dichiarata.
  const shown = terms ?? draft;
  const changes = compareTerms(terms, draft);
  const mainDocument = detail.documents.find((d) => d.relation === 'main_agreement')
    ?? detail.documents[0] ?? null;
  const extractionOf = (documentId: string): ContractExtraction | null =>
    detail.extractions.find((e) => e.documentId === documentId && e.status === 'completed') ?? null;
  const mainExtraction = mainDocument ? extractionOf(mainDocument.documentId) : null;

  return (
    <>
      <Link to="/contratti" className="btn btn-link">
        <Icon name="arrowLeft" className="ic-sm" /> {t('contracts.detail.back')}
      </Link>

      <div className="page-head ct-head">
        <div>
          <div className="page-title">{c.displayName}</div>
          <p className="page-desc">
            {L.contractType(c.contractType)}
            {c.counterpartyName ? ` · ${c.counterpartyName}` : ''}
            {' · '}{L.contractReview(c.reviewStatus)}
          </p>
        </div>
        <div className="row-wrap">
          {/* §120 — la domanda parte dalla scheda che si sta guardando. */}
          <AskAbout type="contract" id={c.id} label={c.displayName} />
          {mainDocument && (
            <Link className="btn" to={`/documenti/${mainDocument.documentId}`}>
              <Icon name="document" className="ic-sm" /> {t('contracts.detail.openSource')}
            </Link>
          )}
          <button
            type="button" className="btn" disabled={busy}
            onClick={() => void run(
              () => contractService.update(c.id, {
                archivedAt: c.archivedAt ? null : new Date().toISOString(),
              }),
              c.archivedAt ? 'contracts.restored' : 'contracts.archived',
            )}
          >
            {c.archivedAt ? t('contracts.restore') : t('contracts.archive')}
          </button>
        </div>
      </div>

      {/* §3 — il genere fuori perimetro si dichiara, e il documento resta. */}
      {c.qualityFlags.includes('out_of_scope_contract_kind') && (
        <div className="info-box">
          <strong>{t('contracts.outOfScope')}</strong>
          <p>{t('contracts.outOfScopeHint')}</p>
          {mainExtraction?.outOfScopeKind && <p className="muted-sm">{mainExtraction.outOfScopeKind}</p>}
        </div>
      )}

      {/* §140/§141 — che cosa va guardato, e perché. */}
      {c.qualityFlags.length > 0 && (
        <section className="card">
          <div className="card-title">{t('contracts.flagsTitle')}</div>
          <ul className="ct-list">
            {c.qualityFlags.map((f) => <li key={f}>{L.contractFlag(f)}</li>)}
          </ul>
        </section>
      )}

      {/* ⚠️ §26/§27/§28 — LA SCHEDA PIÙ IMPORTANTE DEL MODULO.
          Se c'è una bozza che cambia qualcosa rispetto ai termini in vigore, si
          mostra il confronto PRIMA di tutto il resto, e si dichiara che finché
          nessuno conferma i termini non cambiano. */}
      {draft && changes.length > 0 && (
        <section className="card info-box-card">
          <div className="card-title">{t('contracts.amendment.title')}</div>
          <p>{t('contracts.amendment.intro')}</p>
          <table className="ct-cmp">
            <thead>
              <tr>
                <th>{' '}</th>
                <th>{t('contracts.amendment.before')}</th>
                <th>{t('contracts.amendment.after')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((ch) => (
                <tr key={ch.field}>
                  <th scope="row">{fieldLabel(ch.field, t)}</th>
                  <td>{renderValue(ch.before, L, t)}</td>
                  <td><strong>{renderValue(ch.after, L, t)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button" className="btn btn-primary" disabled={busy}
            onClick={() => void run(
              () => contractService.verifyTerms(draft.id), 'contracts.terms.verified')}
          >
            {t('contracts.amendment.verify')}
          </button>
        </section>
      )}

      {/* I termini non ancora verificati si dichiarano tali. */}
      {shown && shown.status === 'draft' && (
        <div className="info-box">
          <strong>{t('contracts.terms.draftBanner')}</strong>
          <p>{t('contracts.terms.draftBannerHint')}</p>
          <button
            type="button" className="btn btn-primary" disabled={busy}
            onClick={() => void run(
              () => contractService.verifyTerms(shown.id), 'contracts.terms.verified')}
          >
            {t('contracts.terms.verify')}
          </button>
        </div>
      )}
      {terms?.verifiedAt && (
        <p className="muted-sm">
          {t('contracts.terms.verifiedOn', { date: formatDate(terms.verifiedAt) })}
          {' · '}{t('contracts.terms.version', { n: String(terms.version) })}
          {!draft && (
            <>
              {' · '}
              <button
                type="button" className="btn-link" disabled={busy}
                onClick={() => void run(
                  () => contractService.openDraft(c.id), 'contracts.terms.correctionSaved')}
              >
                {t('contracts.terms.edit')}
              </button>
            </>
          )}
        </p>
      )}

      <div className="grid-2">
        {/* ---- Date importanti ------------------------------------------- */}

      {/* §26, §36, §80 — il collegamento è FACOLTATIVO e sta ACCANTO al nome.
          `counterparty_name` resta l'etichetta del contratto e
          `contract_extractions.counterparty` resta il nome letto e immutabile:
          scollegare non cancella nessuno dei due. La 0024 dichiarava che una
          tabella di controparti «non esiste»; ora esiste, e il modo in cui
          quella scelta viene superata è proprio questo — un riferimento in più,
          non un nome riscritto. */}
      <CrmLinkPicker
        linkedId={crmLink.linked?.id ?? null}
        linkedName={crmLink.linked?.displayName ?? null}
        extractedName={c.counterpartyName}
        onLink={crmLink.link}
        onUnlink={crmLink.unlink}
        disabled={busy}
      />

        <section className="card">
          <div className="card-title">{t('contracts.detail.sections.dates')}</div>
          <Field label={t('contracts.detail.fields.start')}>
            {shown?.startDate ? formatDate(shown.startDate) : t('contracts.detail.notSpecified')}
          </Field>
          <Field label={t('contracts.detail.fields.end')}>
            {shown?.endDateKind === 'none'
              ? t('contracts.detail.indefinite')
              : shown?.endDate
                ? formatDate(shown.endDate)
                : t('contracts.detail.notSpecified')}
          </Field>
          {shown?.minimumTermValue && shown.minimumTermUnit && (
            <Field label={t('contracts.detail.fields.minimumTerm')}>
              {shown.minimumTermValue} {L.contractUnit(shown.minimumTermUnit)}
            </Field>
          )}
          {shown?.effectiveFrom && (
            <Field label={t('contracts.detail.fields.effectiveFrom')}>
              {formatDate(shown.effectiveFrom)}
            </Field>
          )}

          <div className="section-title">{t('contracts.milestones.listTitle')}</div>
          <MilestoneList
            milestones={openMilestones(detail.milestones)}
            contractName={c.displayName}
            busy={busy} t={t} L={L}
            onVerify={(m) => void run(
              () => contractService.verifyMilestone(m.id), 'contracts.milestones.verified')}
            onDismiss={(m) => void run(
              () => contractService.dismissMilestone(m.id), 'contracts.milestones.dismissed')}
            onCreateTask={(m) => void run(() => contractService.createTaskFromMilestone({
              companyId: company!.id, contractId: c.id, milestone: m,
              userId: user!.id,
              title: t('contracts.milestones.taskTitle', { name: c.displayName }),
              dueDate: m.dueDate, assigneeUserId: c.ownerUserId,
              priority: 'high',
            }), 'contracts.milestones.taskCreated')}
          />
        </section>

        {/* ---- Rinnovo e preavviso ---------------------------------------- */}
        <section className="card">
          <div className="card-title">{t('contracts.detail.sections.renewal')}</div>
          <Field label={t('contracts.detail.fields.autoRenewal')}>
            {L.contractRenewal(shown?.autoRenewal ?? 'unclear')}
            <Clause evidence={mainExtraction?.evidence?.auto_renewal} t={t} />
          </Field>
          {shown?.renewalPeriodValue && shown.renewalPeriodUnit && (
            <Field label={t('contracts.detail.fields.renewalPeriod')}>
              {shown.renewalPeriodValue} {L.contractUnit(shown.renewalPeriodUnit)}
            </Field>
          )}
          <Field label={t('contracts.detail.fields.noticePeriod')}>
            {shown?.noticePeriodValue && shown.noticePeriodUnit
              ? `${shown.noticePeriodValue} ${L.contractUnit(shown.noticePeriodUnit)}`
              : t('contracts.detail.notSpecified')}
            <Clause evidence={mainExtraction?.evidence?.notice_period} t={t} />
          </Field>
          {shown?.noticeAnchor && (
            <Field label={t('contracts.detail.fields.noticeAnchor')}>
              {L.contractAnchor(shown.noticeAnchor)}
              {/* ⚠️ La clausola ORIGINALE, nella lingua del documento: è ciò che
                  permette a una persona di decidere quando noi non possiamo. */}
              <Clause
                evidence={mainExtraction?.evidence?.notice_anchor}
                fallbackText={shown.noticeAnchorText}
                t={t}
              />
            </Field>
          )}

          {/* §39 — quando una data non si ricava, si dice perché. */}
          <NoticeAvailability terms={shown} milestones={detail.milestones} t={t} />

          {shown?.terminationMethod && (
            <Field label={t('contracts.detail.fields.terminationMethod')}>
              {t('contracts.detail.terminationPrefix')}{' '}
              {L.contractTermination(shown.terminationMethod)}
            </Field>
          )}
          {shown?.terminationAddress && (
            <Field label={t('contracts.detail.fields.terminationAddress')}>
              {shown.terminationAddress}
            </Field>
          )}
        </section>

        {/* ---- Costi ------------------------------------------------------ */}
        <section className="card">
          <div className="card-title">{t('contracts.detail.sections.costs')}</div>
          {shown?.costAmount !== null && shown?.costAmount !== undefined ? (
            <>
              <Field label={t('contracts.detail.fields.cost')}>
                {/* ⚠️ §54 — NESSUNA ANNUALIZZAZIONE. Si mostra il costo
                    ricorrente così com'è: moltiplicarlo per dodici
                    presupporrebbe una durata, mesi tutti uguali e nessuna
                    indicizzazione — tre cose che il documento spesso non dice. */}
                {shown.costCurrency ? `${shown.costCurrency} ` : ''}{shown.costAmount}
                {shown.costFrequency !== 'unknown' && (
                  <span className="muted-sm"> · {L.contractFrequency(shown.costFrequency)}</span>
                )}
                <Clause evidence={mainExtraction?.evidence?.cost_amount} t={t} />
              </Field>
              {shown.costVatIncluded !== null && (
                <p className="muted-sm">
                  {shown.costVatIncluded
                    ? t('contracts.detail.vatIncludedYes')
                    : t('contracts.detail.vatIncludedNo')}
                </p>
              )}
              {shown.priceAdjustment && (
                <div className="info-box">
                  <strong>{t('contracts.detail.priceAdjustmentPresent')}</strong>
                  <p className="muted-sm">{t('contracts.detail.priceAdjustmentNote')}</p>
                </div>
              )}
            </>
          ) : (
            <p className="muted">{t('contracts.detail.notInDocument')}</p>
          )}
        </section>

        {/* ---- Obblighi e clausole ---------------------------------------- */}
        {mainExtraction && mainExtraction.obligations.length > 0 && (
          <section className="card">
            <div className="card-title">{t('contracts.detail.sections.obligations')}</div>
            <ul className="ct-clauses">
              {mainExtraction.obligations.map((o, i) => (
                <li key={i}>
                  <span>{o.text}</span>
                  <Clause evidence={o.evidence} t={t} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {mainExtraction && mainExtraction.attentionClauses.length > 0 && (
          <section className="card">
            {/* §59/§60 — «da tenere presenti», non «rischi legali». */}
            <div className="card-title">{t('contracts.detail.sections.clauses')}</div>
            <ul className="ct-clauses">
              {mainExtraction.attentionClauses.map((cl, i) => (
                <li key={i}>
                  <strong>{L.contractFlag(cl.kind) !== cl.kind ? L.contractFlag(cl.kind) : cl.kind}</strong>
                  <span>{cl.text}</span>
                  <Clause evidence={cl.evidence} t={t} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* ---- Documenti ---------------------------------------------------- */}
      <section className="card">
        <div className="card-title">{t('contracts.documents.title')}</div>
        {detail.documents.length === 0 ? (
          <p className="muted">{t('contracts.documents.empty')}<br />{t('contracts.documents.emptyHint')}</p>
        ) : (
          <ul className="ct-docs">
            {detail.documents.map((d) => (
              <DocumentRow
                key={d.id} link={d} busy={busy} t={t} L={L}
                onRelation={(rel) => void run(
                  () => contractService.setRelation(d.id, rel), 'contracts.terms.correctionSaved')}
                onRetry={() => void run(
                  () => contractService.retryDocument(d.id), 'contracts.documents.retry')}
                onRemove={() => void run(
                  () => contractService.removeDocument(d.id), 'contracts.documents.remove')}
              />
            ))}
          </ul>
        )}
        {detail.documents.some((d) => d.relation === 'annex') && (
          <p className="muted-sm">{t('contracts.documents.annexNotice')}</p>
        )}
        {c.qualityFlags.includes('missing_referenced_annex') && (
          <p className="muted-sm">{t('contracts.documents.annexMissing')}</p>
        )}
        <AddDocument
          contractId={c.id} companyId={company!.id} busy={busy} t={t} L={L}
          onAdded={() => void load()}
        />
      </section>

      {/* ---- Attività ----------------------------------------------------- */}
      <section className="card">
        <div className="card-title">{t('contracts.tasks.title')}</div>
        {detail.tasks.length === 0 ? (
          <p className="muted">{t('contracts.tasks.empty')}</p>
        ) : (
          <ul className="ct-list">
            {detail.tasks.map((task) => (
              <li key={task.id}>
                <Link to={`/attivita/${task.id}`}>{task.title}</Link>
                {task.dueDate && <span className="muted-sm"> · {formatDate(task.dueDate)}</span>}
                {task.milestoneId && (
                  <span className="muted-sm"> · {t('contracts.tasks.fromMilestone')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Storico ------------------------------------------------------ */}
      <section className="card">
        <div className="card-title">{t('contracts.detail.sections.history')}</div>
        <ul className="ct-list">
          {detail.events.map((ev) => (
            <li key={ev.id}>
              <span className="muted-sm">{formatDate(ev.createdAt)}</span>{' '}
              <span>{ev.kind}</span>
              {ev.actorUserId && (
                <span className="muted-sm"> · {nameOf(ev.actorUserId) ?? '—'}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="legal-note">{t('contracts.disclaimer')}</p>
    </>
  );
}

// ---------------------------------------------------------------------------

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="result-row">
      <span className="result-label">{props.label}</span>
      <span className="result-value">{props.children}</span>
    </div>
  );
}

/**
 * «Mostra clausola» (§17/§73).
 *
 * ⚠️ LA CITAZIONE È IL TESTO DEL CONTRATTO, e l'etichetta lo dice (§125): non si
 * presenta mai una nostra frase come se fosse il documento. Se la citazione non
 * c'è, il controllo non compare — un pulsante che apre il vuoto è peggio di
 * nessun pulsante.
 */
function Clause(props: {
  evidence?: ContractEvidence | null; fallbackText?: string | null; t: TFunction;
}) {
  const [open, setOpen] = useState(false);
  const quote = props.evidence?.quote ?? props.fallbackText ?? null;
  if (!quote) return null;
  return (
    <>
      <button
        type="button" className="btn-link"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? props.t('contracts.detail.hideClause') : props.t('contracts.detail.showClause')}
      </button>
      {open && (
        <blockquote className="ev-quote show">
          <span className="muted-sm">{props.t('contracts.detail.clauseOriginal')}</span>
          <p>«{quote}»</p>
          {props.evidence?.page && (
            <span className="muted-sm">
              {props.t('contracts.detail.clausePage', { page: String(props.evidence.page) })}
            </span>
          )}
        </blockquote>
      )}
    </>
  );
}

/**
 * §39 — quando una scadenza di disdetta non si può ricavare, si dice PERCHÉ.
 * ⚠️ Non compare quando la data esiste: sarebbe rumore su un dato già chiaro.
 */
function NoticeAvailability(props: {
  terms: ContractTermVersion | null;
  milestones: readonly ContractMilestone[];
  t: TFunction;
}) {
  const hasNoticeDate = props.milestones.some(
    (m) => m.kind === 'notice_deadline' && (m.status === 'candidate' || m.status === 'verified'));
  if (hasNoticeDate) return null;
  const reason = noticeUnavailableReason(props.terms);
  // Se non c'è nemmeno un preavviso indicato, non si dice niente: non c'è nulla
  // di cui dichiarare l'impossibilità.
  if (!reason || reason === 'no_notice_period') return null;
  return (
    <div className="info-box">
      <strong>{props.t('contracts.milestones.noticeUnavailable')}</strong>
      <p>{props.t(REASON_KEY[reason])}</p>
    </div>
  );
}

function MilestoneList(props: {
  milestones: readonly ContractMilestone[];
  contractName: string;
  busy: boolean;
  t: TFunction;
  L: ReturnType<typeof useLabels>;
  onVerify: (m: ContractMilestone) => void;
  onDismiss: (m: ContractMilestone) => void;
  onCreateTask: (m: ContractMilestone) => void;
}) {
  const { t, L } = props;
  if (!props.milestones.length) {
    return <p className="muted">{t('contracts.milestones.empty')}</p>;
  }
  return (
    <ul className="ct-ms">
      {props.milestones.map((m) => {
        const days = daysUntil(m.dueDate);
        return (
          <li key={m.id} className="ct-ms-row">
            <div>
              <strong>{L.milestoneKind(m.kind)}</strong>
              {' · '}{formatDate(m.dueDate)}
              {/* ⚠️ Lo stato ACCANTO alla data: staccarli renderebbe la
                  distinzione decorativa. */}
              {/* ⚠️ Lo STATO, non l'azione: usare qui il testo del pulsante
                  faceva leggere «30.09.2026 · Verifica data … Verifica data»,
                  cioè la stessa parola due volte a due centimetri di distanza. */}
              {m.status === 'candidate' && (
                <em className="ct-unverified"> · {t('contracts.row.toVerify')}</em>
              )}
              {days !== null && days >= 0 && days <= 60 && (
                <span className="muted-sm"> · {t('tasks.dueInDays', { n: days })}</span>
              )}
              <div className="muted-sm">
                {L.milestoneSource(m.source)}
                {/* §42 — perché proprio questa data. */}
                {m.source === 'derived' && m.calculationInputs && (
                  <> · {String(m.calculationInputs.noticeValue ?? '')}{' '}
                    {L.contractUnit(String(m.calculationInputs.noticeUnit ?? ''))}{' '}
                    {L.contractAnchor(String(m.calculationInputs.anchor ?? ''))}
                  </>
                )}
              </div>
            </div>
            <div className="row-wrap">
              {m.status === 'candidate' && (
                <>
                  <button type="button" className="btn btn-sm" disabled={props.busy}
                    onClick={() => props.onVerify(m)}>
                    {t('contracts.milestones.verify')}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={props.busy}
                    onClick={() => props.onDismiss(m)}>
                    {t('contracts.milestones.dismiss')}
                  </button>
                </>
              )}
              {/* §87 — su una data non verificata il pulsante NON c'è, e al suo
                  posto c'è la ragione: un pulsante che porta a un rifiuto è un
                  difetto, non una protezione. */}
              {canCreateTask(m) ? (
                <button type="button" className="btn btn-sm btn-primary" disabled={props.busy}
                  onClick={() => props.onCreateTask(m)}>
                  {t('contracts.milestones.createTask')}
                </button>
              ) : m.status === 'verified' && m.taskCount > 0 ? (
                <span className="muted-sm">{t('contracts.milestones.taskExists')}</span>
              ) : m.status === 'candidate' ? (
                <span className="muted-sm">{t('contracts.milestones.needsVerification')}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DocumentRow(props: {
  link: ContractDocumentLink; busy: boolean;
  t: TFunction; L: ReturnType<typeof useLabels>;
  onRelation: (r: ContractDocumentRelation) => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const { link: d, t, L } = props;
  return (
    <li className="ct-doc-row">
      <div>
        <Link to={`/documenti/${d.documentId}`}>{d.title || d.documentId.slice(0, 8)}</Link>
        <div className="muted-sm">
          {L.contractRelation(d.relation)}
          {d.processingStatus === 'pending' && ` · ${t('contracts.documents.pending')}`}
          {d.processingStatus === 'processing' && ` · ${t('contracts.documents.processing')}`}
          {d.processingStatus === 'failed' && ` · ${t('contracts.documents.failed')}`}
        </div>
      </div>
      <div className="row-wrap">
        <div className="field ct-inline">
          <label className="ct-sr" htmlFor={`rel-${d.id}`}>
            {t('contracts.documents.relation')}
          </label>
          <select
            id={`rel-${d.id}`} value={d.relation} disabled={props.busy}
            onChange={(e) => props.onRelation(e.target.value as ContractDocumentRelation)}
          >
            {RELATIONS.map((r) => (
              <option key={r} value={r}>{L.contractRelation(r)}</option>
            ))}
          </select>
        </div>
        {d.processingStatus === 'failed' && (
          <button type="button" className="btn btn-sm" disabled={props.busy} onClick={props.onRetry}>
            {t('contracts.documents.retry')}
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost" disabled={props.busy}
          onClick={props.onRemove} title={t('contracts.documents.removeHint')}>
          {t('contracts.documents.remove')}
        </button>
      </div>
    </li>
  );
}

/**
 * Collegare un documento già presente nel Document Hub (§75/§76).
 *
 * ⚠️ L'ETICHETTA STA DOVE AVVIENE L'AZIONE CHE NOMINA. È la lezione pagata in
 * Finanze: un campo chiamato «Scegli il documento» che in realtà FILTRAVA ha
 * fatto credere a una persona che la selezione non funzionasse. Qui la casella
 * si chiama «Filtra per nome», è dichiarata facoltativa, e «Scegli il
 * documento» sta sopra l'elenco, con il conteggio.
 */
function AddDocument(props: {
  contractId: string; companyId: string; busy: boolean;
  t: TFunction; L: ReturnType<typeof useLabels>;
  onAdded: () => void;
}) {
  const { t, L } = props;
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [docs, setDocs] = useState<{ id: string; title: string }[]>([]);
  const [relation, setRelation] = useState<ContractDocumentRelation>('main_agreement');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    documentService.list(props.companyId)
      .then((res) => {
        if (!cancelled) setDocs(res.map((d) => ({ id: d.id, title: d.title })));
      })
      .catch((e) => { if (!cancelled) setLoadError(toUserMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, props.companyId]);

  const visible = useMemo(
    () => docs.filter((d) => d.title.toLowerCase().includes(filter.trim().toLowerCase())),
    [docs, filter],
  );

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Icon name="plus" className="ic-sm" /> {t('contracts.documents.add')}
      </button>
    );
  }

  return (
    <div className="ct-add">
      <div className="field">
        <label htmlFor="doc-filter">
          {t('contracts.documents.filterPlaceholder')}
        </label>
        <input
          id="doc-filter" type="search" value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="doc-relation">{t('contracts.documents.relation')}</label>
        <select
          id="doc-relation" value={relation}
          onChange={(e) => setRelation(e.target.value as ContractDocumentRelation)}
        >
          {RELATIONS.map((r) => <option key={r} value={r}>{L.contractRelation(r)}</option>)}
        </select>
      </div>

      {/* ⚠️ «Non ho potuto chiedere» non si traveste da «non ce ne sono». */}
      {loadError ? (
        <ErrorState message={loadError} />
      ) : loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : (
        <>
          <p className="result-label">
            {t('contracts.documents.chooseDocument')} ({visible.length})
          </p>
          {docs.length === 0 ? (
            <p className="muted">{t('contracts.documents.noDocuments')}</p>
          ) : visible.length === 0 ? (
            <p className="muted">{t('contracts.documents.noMatch')}</p>
          ) : (
            <ul className="ct-list ct-pick">
              {visible.map((d) => (
                <li key={d.id}>
                  <span>{d.title}</span>
                  <button
                    type="button" className="btn btn-sm" disabled={props.busy}
                    onClick={async () => {
                      try {
                        await contractService.addDocument({
                          companyId: props.companyId, contractId: props.contractId,
                          documentId: d.id, relation,
                        });
                        setOpen(false);
                        props.onAdded();
                      } catch (e) {
                        showToast(toUserMessage(e));
                      }
                    }}
                  >
                    {t('contracts.documents.link')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function fieldLabel(field: string, t: TFunction): string {
  const map: Record<string, TKey> = {
    counterparty_name: 'contracts.detail.fields.counterparty',
    start_date: 'contracts.detail.fields.start',
    end_date: 'contracts.detail.fields.end',
    end_date_kind: 'contracts.detail.fields.end',
    auto_renewal: 'contracts.detail.fields.autoRenewal',
    renewal_period_value: 'contracts.detail.fields.renewalPeriod',
    renewal_period_unit: 'contracts.detail.fields.renewalPeriod',
    notice_period_value: 'contracts.detail.fields.noticePeriod',
    notice_period_unit: 'contracts.detail.fields.noticePeriod',
    notice_anchor: 'contracts.detail.fields.noticeAnchor',
    minimum_term_value: 'contracts.detail.fields.minimumTerm',
    minimum_term_unit: 'contracts.detail.fields.minimumTerm',
    cost_amount: 'contracts.detail.fields.cost',
    cost_currency: 'contracts.detail.fields.cost',
    cost_frequency: 'contracts.detail.fields.frequency',
    price_adjustment: 'contracts.detail.fields.priceAdjustment',
    termination_method: 'contracts.detail.fields.terminationMethod',
  };
  const key = map[field];
  return key ? t(key) : field;
}

/** Un valore del confronto. `null` è «non indicato», non una casella vuota. */
function renderValue(
  v: string | number | boolean | null, L: ReturnType<typeof useLabels>, t: TFunction,
): string {
  if (v === null || v === undefined || v === '') return t('contracts.detail.notSpecified');
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDate(v);
  if (typeof v === 'string') {
    // Le etichette di dominio si traducono; ciò che non è un'etichetta nota
    // resta com'è, senza inventarne una.
    for (const fn of [L.contractRenewal, L.contractUnit, L.contractAnchor,
      L.contractFrequency, L.contractTermination] as const) {
      const label: string = fn(v);
      if (label !== v) return label;
    }
  }
  return String(v);
}
