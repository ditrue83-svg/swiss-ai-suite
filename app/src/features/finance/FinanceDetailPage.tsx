// ============================================================================
// Dettaglio di una fattura — dove un documento diventa un dato verificabile.
//
// ⚠️⚠️ IL MODULO COMPRENDE E PREPARA IL DENARO, NON LO MUOVE.
// In questa pagina NON esiste — e non deve esistere — un pulsante «Paga», un
// collegamento generato dall'IBAN, un QR ricostruito o un file di pagamento.
// IBAN e riferimento sono TESTO mostrato accanto alla sua provenienza, e la
// frase che lo dice sta sopra di essi, non in una nota a piè di pagina.
//
// Che cosa mette insieme, senza copiare niente:
//   · il verbale IMMUTABILE della lettura     → finance_extractions
//   · le correzioni di una persona            → finance_corrections (in aggiunta)
//   · da dove è arrivato il documento         → Inbox / caricamento
//   · che lavoro ne è nato                    → le attività del Work Hub
//   · che cosa è cambiato e quando            → finance_events
//
// I valori in testata e nelle schede sono quelli EFFETTIVI e arrivano dalla
// stessa funzione del database che compone la lista: due ricostruzioni della
// stessa regola col tempo direbbero due importi diversi sulla stessa fattura.
// Accanto a ogni valore corretto resta visibile quello che la lettura aveva
// rilevato — la correzione non cancella niente, si affianca.
// ============================================================================
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import { ProvenanceMark } from '@/components/ui/ProvenanceMark';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { CrmLinkPicker } from '@/features/crm/CrmLinkPicker';
import { useCrmLink } from '@/features/crm/useCrmLink';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { financeService } from '@/services/financeService';
import { createTaskFromDocument } from '@/features/tasks/taskFromDocument';
import { dueLabel, statusLabelKey } from '@/features/tasks/taskFormat';
import { useMembers } from '@/features/tasks/useMembers';
import { formatDate } from '@/lib/format';
import { causaDelGuasto } from '@/lib/errorCause';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT, type TFunction, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { AskAbout } from '@/features/assistant/AskAbout';
import {
  FINANCE_HIGH_RISK_FIELDS, financeState, formatDecimal, isCorrectableField, readyBlockers,
  type FinanceCorrectableField, type FinanceReadyBlocker,
} from './financeModel';
import type {
  FinanceCorrection, FinanceDetail, FinanceExtraction, FinanceItem, FinanceQualityFlag,
  FinanceReferenceType,
} from '@/types/models';

// ---------------------------------------------------------------------------
// Le schede
// ---------------------------------------------------------------------------
const PANELS = ['data', 'vat', 'payment', 'origin', 'tasks', 'audit'] as const;
type Panel = (typeof PANELS)[number];

const PANEL_KEY: Record<Panel, TKey> = {
  data: 'finance.detail.tabsData',
  vat: 'finance.detail.tabsVat',
  payment: 'finance.detail.tabsPayment',
  origin: 'finance.detail.tabsOrigin',
  tasks: 'finance.detail.tabsTasks',
  audit: 'finance.detail.tabsAudit',
};

/**
 * L'etichetta di un campo correggibile. È un `Record` completo e non una
 * funzione con ripiego: se il contratto aggiungesse un campo, il compilatore lo
 * direbbe qui invece di lasciare a schermo il nome tecnico della colonna.
 */
const FIELD_KEY: Record<FinanceCorrectableField, TKey> = {
  supplier_name: 'finance.detail.supplier',
  supplier_vat_id: 'finance.detail.vatId',
  supplier_address: 'finance.detail.supplierAddress',
  invoice_number: 'finance.detail.invoiceNumber',
  invoice_date: 'finance.detail.invoiceDate',
  due_date: 'finance.detail.dueDate',
  currency: 'finance.detail.currency',
  gross_amount: 'finance.detail.gross',
  net_amount: 'finance.detail.net',
  vat_amount: 'finance.detail.vat',
  creditor_iban: 'finance.detail.iban',
  payment_reference: 'finance.detail.reference',
  reference_type: 'finance.detail.referenceType',
  merchant: 'finance.detail.merchant',
  expense_date: 'finance.detail.expenseDate',
};

/** Che cosa manca perché si possa dichiarare verificata, detto in parole. */
const BLOCKER_KEY: Record<FinanceReadyBlocker, TKey> = {
  supplier: 'finance.detail.supplier',
  gross: 'finance.detail.gross',
  currency: 'finance.detail.currency',
  extraction: 'finance.errors.readyNeedsExtraction',
};

const REFERENCE_TYPES: FinanceReferenceType[] = ['qrr', 'scor', 'non'];

/**
 * Un fatto per bandiera, nella lingua di chi legge (§151).
 *
 * ⚠️ `Record` completo e non `t(\`finance.flags.${flag}\`)`: la chiave costruita
 * a mano compila sempre, anche quando la traduzione non c'è, e il risultato è
 * il nome dell'enum stampato in pagina. Così invece una bandiera aggiunta alla
 * 0021 fa fallire `npm run typecheck`, che è il momento giusto per accorgersene.
 */
const FLAG_KEY: Record<FinanceQualityFlag, TKey> = {
  amount_mismatch: 'finance.flags.amount_mismatch',
  vat_mismatch: 'finance.flags.vat_mismatch',
  qr_text_mismatch: 'finance.flags.qr_text_mismatch',
  missing_currency: 'finance.flags.missing_currency',
  missing_total: 'finance.flags.missing_total',
  missing_supplier: 'finance.flags.missing_supplier',
  duplicate_suspected: 'finance.flags.duplicate_suspected',
  low_ocr_confidence: 'finance.flags.low_ocr_confidence',
  invalid_iban: 'finance.flags.invalid_iban',
  invalid_reference: 'finance.flags.invalid_reference',
  reference_type_mismatch: 'finance.flags.reference_type_mismatch',
  inconsistent_due_date: 'finance.flags.inconsistent_due_date',
  ambiguous_date: 'finance.flags.ambiguous_date',
  qr_not_read: 'finance.flags.qr_not_read',
  negative_amount: 'finance.flags.negative_amount',
};

/** Come si scrive il campo quando lo si corregge. Decide il controllo mostrato. */
type FieldKind = 'text' | 'date' | 'amount' | 'currency' | 'reference_type';

// ---------------------------------------------------------------------------
// Valore letto dalla macchina, valore effettivo
// ---------------------------------------------------------------------------

/**
 * Che cosa la LETTURA aveva rilevato per un campo, come testo.
 *
 * ⚠️ Si prende dal verbale, non dalla prima correzione registrata. Una
 * correzione porta con sé il valore che c'era al momento in cui è stata
 * scritta, e dopo due correzioni quello non è più «ciò che aveva letto
 * l'analisi» ma «ciò che aveva scritto il collega prima di me». Il verbale è
 * immutabile: è l'unica fonte che risponde davvero alla domanda.
 */
function extractedValue(ex: FinanceExtraction | null, field: FinanceCorrectableField): string | null {
  if (!ex) return null;
  const v = ((): unknown => {
    switch (field) {
      case 'supplier_name': return ex.supplierName;
      case 'supplier_vat_id': return ex.supplierVatId;
      case 'supplier_address': return ex.supplierAddress;
      case 'invoice_number': return ex.invoiceNumber;
      case 'invoice_date': return ex.invoiceDate;
      case 'due_date': return ex.dueDate;
      case 'currency': return ex.currency;
      case 'gross_amount': return ex.grossAmount;
      case 'net_amount': return ex.netAmount;
      case 'vat_amount': return ex.vatAmount;
      case 'creditor_iban': return ex.creditorIban;
      case 'payment_reference': return ex.paymentReference;
      case 'reference_type': return ex.referenceType;
      case 'merchant': return ex.merchant;
      case 'expense_date': return ex.expenseDate;
    }
  })();
  return v === null || v === undefined ? null : String(v);
}

/** L'ultima correzione di un campo, se c'è. La lista arriva dalla più recente. */
function latestCorrection(corrections: FinanceCorrection[], field: string): FinanceCorrection | null {
  return corrections.find((c) => c.field === field) ?? null;
}

/**
 * ⚠️ DUE CAMPI NON SONO NELLA PROIEZIONE, e vanno composti qui.
 *
 * `finance_refresh_effective` calcola i valori effettivi solo per le colonne
 * `eff_*`, e fra quelle non ci sono il numero IVA né l'indirizzo del fornitore:
 * la 0021 li tiene nel verbale perché non servono né alla ricerca né
 * all'impronta del duplicato. Correggerli però è permesso — stanno in
 * `FINANCE_CORRECTABLE_FIELDS` — e se questa pagina si limitasse a leggere il
 * verbale mostrerebbe il valore vecchio accanto alla pastiglia «corretto da una
 * persona»: la correzione sembrerebbe non essere stata salvata.
 */
function effectiveOutsideProjection(
  detail: FinanceDetail, field: FinanceCorrectableField,
): string | null {
  const correction = latestCorrection(detail.corrections, field);
  if (correction && correction.correctedValue !== null && correction.correctedValue !== undefined) {
    return String(correction.correctedValue);
  }
  return extractedValue(detail.extraction, field);
}

export function FinanceDetailPage() {
  const t = useT();
  const L = useLabels();
  const { localeTag } = useI18n();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  // 0026 — il fornitore collegato al CRM.
  const crmLink = useCrmLink('finance', activeCompanyId, id);
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;

  const { loading, error, data, reload } = useAsync<FinanceDetail | null>(
    () => financeService.get(id, companyId), [id, companyId],
  );

  const { byId: membersById } = useMembers();
  const [panel, setPanel] = useState<Panel>('data');
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { showToast(toUserMessage(e)); } finally { setBusy(false); }
  }

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  // ⚠️ «Non trovata» NON è «non ho potuto leggerla»: l'errore ha il proprio
  // ramo qui sopra, con il pulsante per riprovare. Confonderli manda a cercare
  // il problema dalla parte sbagliata — difetto già pagato due volte.
  if (!data) {
    return (
      <div className="page-head">
        <Link className="btn btn-sm btn-ghost mb-8" to="/finanze">
          <Icon name="arrowLeft" className="ic-sm" /> {t('finance.detail.back')}
        </Link>
        <div className="page-title">{t('finance.errors.notFound')}</div>
      </div>
    );
  }

  const detail = data;
  const item = detail.item;
  const state = financeState(item);
  const blockers = readyBlockers(item);
  const archived = !!item.archivedAt;
  const who = item.supplierName || item.merchant || item.documentTitle;
  const amount = formatDecimal(item.grossAmount, item.currency, localeTag);
  const canRetry = item.processingStatus === 'failed' || item.processingStatus === 'completed';

  /** Il responsabile di un'attività. `profiles` non si legge con un join (§38). */
  function assigneeName(userId: string | null): string {
    if (!userId) return t('tasks.unassigned');
    const m = membersById.get(userId);
    if (!m) return t('tasks.eventUnknownActor');
    return m.name || t('tasks.unnamedMember');
  }

  async function setReview(ready: boolean) {
    await withBusy(async () => {
      await financeService.setReview(id, companyId, ready);
      reload();
    });
  }

  async function toggleArchive() {
    await withBusy(async () => {
      if (archived) await financeService.restore(id, companyId);
      else await financeService.archive(id, companyId);
      reload();
    });
  }

  async function retry() {
    await withBusy(async () => {
      await financeService.retry(id, companyId);
      reload();
    });
  }

  async function createTask() {
    if (!user) return;
    await withBusy(async () => {
      // ⚠️ L'attività è IL LAVORO UMANO, non il pagamento: nasce dal documento
      // e porta la scadenza della fattura perché è la data entro cui qualcuno
      // deve occuparsene. Non prepara, non pianifica e non autorizza nessun
      // versamento.
      await createTaskFromDocument({
        companyId,
        userId: user.id,
        documentId: item.documentId,
        title: item.documentTitle,
        authority: item.supplierName ?? item.merchant,
        dueDate: item.dueDate,
      });
      showToast(t('documents.taskCreated'));
      reload();
    });
  }

  /** Salva una correzione e rilegge: i valori effettivi li ricalcola il database. */
  async function correct(field: FinanceCorrectableField, value: string | null) {
    await withBusy(async () => {
      await financeService.correct(id, companyId, field, value, extractedValue(detail.extraction, field));
      showToast(t('finance.detail.correctionSaved'));
      reload();
    });
  }

  const ctx: FieldContext = {
    item, detail, busy, localeTag, t, L,
    onCorrect: (field, value) => void correct(field, value),
  };

  return (
    <>
      <div className="page-head">
        <Link className="btn btn-sm btn-ghost mb-8" to="/finanze">
          <Icon name="arrowLeft" className="ic-sm" /> {t('finance.detail.back')}
        </Link>
        <div className="page-title">{who}</div>
        <div className="page-desc">
          {[L.financeType(item.type), amount].filter(Boolean).join(' · ')}
          {item.dueDate && <> · <DeadlineMark date={item.dueDate} display={formatDate(item.dueDate)} /></>}
        </div>
        <div className="badge-row">
          {state === 'to_verify'
            ? <ProvenanceMark kind="toVerify" />
            : <span className={stateBadgeClass(state)}>{stateBadgeText(state, t, L)}</span>}
          {archived && <span className="badge badge-neutral">{t('finance.filters.archived')}</span>}
          {/* La CAUSA accanto alla pastiglia, come nell'elenco: il codice del
              worker tradotto se noto, grezzo se no (mai una categoria
              inventata). */}
          {item.errorCode && (state === 'failed' || state === 'processing') && (
            <span className="muted-sm">{causaDelGuasto(item.errorCode, t)}</span>
          )}
        </div>
      </div>

      {/* ---- Azioni ------------------------------------------------------ */}
      <div className="row-wrap mt-12">
        {/* §120 — la domanda parte dalla scheda che si sta guardando. */}
        <AskAbout type="finance_item" id={item.id} label={who} />
        {/* Un solo visualizzatore in tutto il prodotto: il file è del Document
            Hub e si apre là. Un secondo qui vorrebbe dire due posti in cui
            ricordarsi degli URL firmati e della loro scadenza. */}
        <Link className="btn btn-primary" to={`/documenti/${item.documentId}`}>
          <Icon name="document" className="ic-sm" /> {t('finance.detail.openDocument')}
        </Link>
        {item.reviewStatus === 'ready' ? (
          <button className="btn" onClick={() => void setReview(false)} disabled={busy}>
            <Icon name="refresh" className="ic-sm" /> {t('finance.detail.reopen')}
          </button>
        ) : (
          <button className="btn" onClick={() => void setReview(true)}
            disabled={busy || blockers.length > 0}>
            <Icon name="checkCircle" className="ic-sm" /> {t('finance.detail.markReviewed')}
          </button>
        )}
        <button className="btn" onClick={() => void toggleArchive()} disabled={busy}>
          <Icon name="archive" className="ic-sm" />
          {archived ? t('finance.detail.restore') : t('finance.detail.archive')}
        </button>
        <button className="btn" onClick={() => void retry()} disabled={busy || !canRetry}>
          <Icon name="refresh" className="ic-sm" /> {t('finance.detail.retry')}
        </button>
        <button className="btn" onClick={() => void createTask()} disabled={busy}>
          <Icon name="calendar" className="ic-sm" /> {t('finance.detail.createTask')}
        </button>
      </div>

      {/* ⚠️ QUANDO IL PULSANTE È SPENTO SI DICE PERCHÉ. Un comando disabilitato e
          muto sembra un guasto, e chi lo incontra conclude che il prodotto è
          rotto invece di capire che manca un dato. */}
      {item.reviewStatus !== 'ready' && blockers.length > 0 && (
        <div className="info-box mt-12">
          {blockers.includes('extraction')
            ? t('finance.errors.readyNeedsExtraction')
            : (
              <>
                <div>{t('finance.errors.cannotReview')}</div>
                <ul className="fin-blockers">
                  {blockers.map((b) => <li key={b}>{t(BLOCKER_KEY[b])}</li>)}
                </ul>
              </>
            )}
        </div>
      )}
      {item.reviewStatus !== 'ready' && blockers.length === 0 && (
        <div className="muted-sm mt-8">{t('finance.detail.markReviewedHint')}</div>
      )}
      {!canRetry && <div className="muted-sm mt-8">{t('finance.errors.cannotRetry')}</div>}

      {/* §37, §148 — il FORNITORE nel CRM. `eff_supplier_name` resta il nome
          letto sulla fattura e non viene mai riscritto: il collegamento aggiunge
          un'identità, e scollegare non cancella il dato estratto.
          ⚠️ I due timbri (chi ha collegato, quando) li scrive il guardiano da
          `auth.uid()`/`now()`, come già fa per la categoria di spesa: una
          decisione umana registrata dal browser non è una decisione registrata. */}
      <CrmLinkPicker
        linkedId={crmLink.linked?.id ?? null}
        linkedName={crmLink.linked?.displayName ?? null}
        extractedName={item.supplierName ?? item.merchant}
        onLink={crmLink.link}
        onUnlink={crmLink.unlink}
        disabled={busy}
      />

      {/* ---- Da verificare: le bandiere, in parole (§151) ----------------- */}
      {item.qualityFlags.length > 0 && (
        <div className="card mt-16">
          <div className="card-title">
            <Icon name="alert" className="ic-sm" /> {t('finance.kpi.needsReview')}
          </div>
          <ul className="fin-flags">
            {item.qualityFlags.map((flag) => (
              <li key={flag}>{t(FLAG_KEY[flag])}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Possibile duplicato (§71) -----------------------------------
          ⚠️ NESSUN pulsante che fonde o cancella. Il prodotto mette le due
          fatture una accanto all'altra; a decidere è una persona. */}
      {item.duplicateSuspected && (
        <div className="card mt-16">
          <div className="card-title">
            <Icon name="alert" className="ic-sm" /> {t('finance.duplicate.banner')}
          </div>
          <p className="muted-sm">{t('finance.duplicate.explain')}</p>
          <button className="btn btn-sm" onClick={() => setComparing((v) => !v)}
            aria-expanded={comparing}>
            {comparing ? t('finance.duplicate.close') : t('finance.duplicate.compare')}
          </button>
          {comparing && (
            <div className="mt-12">
              {detail.duplicates.map((d) => (
                <div className="list-row" key={d.id}>
                  <div className="list-main">
                    <div className="list-title">{d.supplierName ?? '—'}</div>
                    <div className="list-sub">
                      {[
                        d.invoiceNumber ? t('finance.row.invoiceNumber', { value: d.invoiceNumber }) : null,
                        d.invoiceDate ? formatDate(d.invoiceDate) : null,
                        formatDecimal(d.grossAmount, d.currency, localeTag),
                        L.financeReview(d.reviewStatus),
                      ].filter(Boolean).join(' · ')}
                    </div>
                    <div className="muted-sm">{t('finance.duplicate.sameNumberAndAmount')}</div>
                  </div>
                  <Link className="btn btn-sm" to={`/finanze/${d.id}`}>{t('common.open')}</Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Le schede --------------------------------------------------- */}
      <div className="tabs mt-16" role="tablist" aria-label={t('finance.title')}>
        {PANELS.map((p) => (
          <button
            key={p} role="tab" id={`fin-p-${p}`} aria-selected={panel === p}
            aria-controls="fin-panel" className={`tab${panel === p ? ' active' : ''}`}
            onClick={() => setPanel(p)}
          >
            {t(PANEL_KEY[p])}
          </button>
        ))}
      </div>

      <div className="card" id="fin-panel" role="tabpanel" aria-labelledby={`fin-p-${panel}`}>
        {panel === 'data' && <DataPanel ctx={ctx} />}
        {panel === 'vat' && <VatPanel ctx={ctx} />}
        {panel === 'payment' && <PaymentPanel ctx={ctx} />}
        {panel === 'origin' && <OriginPanel detail={detail} t={t} />}
        {panel === 'tasks' && (
          <TasksPanel detail={detail} t={t} busy={busy} assigneeName={assigneeName}
            onCreate={() => void createTask()} />
        )}
        {panel === 'audit' && <AuditPanel detail={detail} t={t} L={L} />}
      </div>

      {/* ---- Pannello tecnico, discreto e in fondo (§94) ------------------ */}
      <details className="card mt-16">
        <summary className="card-title">{t('finance.detail.technical')}</summary>
        <dl className="detail-list mt-10">
          <TechRow label={t('finance.detail.extractionVersion')}
            value={item.extractionVersion === null ? null : String(item.extractionVersion)} />
          <TechRow label={t('finance.detail.model')}
            value={detail.extraction?.model ?? detail.extraction?.provider ?? null} />
          <TechRow label={t('finance.detail.processedAt')}
            value={detail.extraction ? formatDate(detail.extraction.createdAt) : null} />
        </dl>
        {detail.extraction && Object.keys(detail.extraction.fieldSources).length > 0 && (
          <>
            <div className="group-label mt-12">{t('finance.detail.fieldSource')}</div>
            <dl className="detail-list">
              {Object.entries(detail.extraction.fieldSources).map(([field, source]) => (
                <TechRow
                  key={field}
                  label={isCorrectableField(field) ? t(FIELD_KEY[field as FinanceCorrectableField]) : field}
                  value={L.fieldSource(source)}
                />
              ))}
            </dl>
          </>
        )}
        {detail.extractionHistory.length > 1 && (
          <div className="muted-sm mt-12">
            {detail.extractionHistory
              .map((v) => `${v.version} · ${formatDate(v.createdAt)}`)
              .join(' — ')}
          </div>
        )}
      </details>

      {/* Il ritorno in fondo alla pagina: dopo aver letto tutto, nessuno risale. */}
      <div className="mt-16">
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('/finanze')}>
          <Icon name="arrowLeft" className="ic-sm" /> {t('finance.detail.back')}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lo stato, in una pastiglia che porta sempre il testo (§129)
// ---------------------------------------------------------------------------
function stateBadgeClass(state: ReturnType<typeof financeState>): string {
  if (state === 'failed') return 'badge badge-alta';
  if (state === 'ready') return 'badge badge-bassa';
  if (state === 'processing' || state === 'archived') return 'badge badge-neutral';
  return 'badge badge-media';
}

function stateBadgeText(
  state: ReturnType<typeof financeState>, t: TFunction, L: ReturnType<typeof useLabels>,
): string {
  if (state === 'failed') return t('finance.row.failed');
  if (state === 'processing') return t('finance.row.processing');
  if (state === 'ready' || state === 'archived') return L.financeReview('ready');
  return L.financeReview('needs_review');
}

// ---------------------------------------------------------------------------
// Un campo, con la sua provenienza e la sua correzione
// ---------------------------------------------------------------------------
interface FieldContext {
  item: FinanceItem;
  detail: FinanceDetail;
  busy: boolean;
  localeTag: string;
  t: TFunction;
  L: ReturnType<typeof useLabels>;
  onCorrect: (field: FinanceCorrectableField, value: string | null) => void;
}

/**
 * Una riga di scheda: il valore EFFETTIVO, che cosa aveva letto la macchina,
 * da dove viene quel dato, e — se il contratto lo permette — la correzione.
 *
 * ⚠️ Il valore mostrato è sempre quello effettivo, mai quello del verbale: se
 * una persona ha corretto l'importo, il numero grande in pagina deve essere il
 * suo. Il valore originario resta accanto, dichiarato, perché la lettura
 * automatica resti verificabile (§11).
 */
function FinField({
  ctx, field, label, value, editValue, kind = 'text',
}: {
  ctx: FieldContext;
  /** Assente = campo di sola lettura (non è nel contratto dei correggibili). */
  field?: FinanceCorrectableField;
  label: string;
  /** Il valore effettivo, già scritto come lo legge una persona. */
  value: string | null;
  /** Lo stesso valore nella forma che si scrive nel campo di modifica. */
  editValue?: string | null;
  kind?: FieldKind;
}) {
  const { t, L, detail, item, busy } = ctx;
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const corrected = !!field && item.correctedFields.includes(field);
  const original = field ? extractedValue(detail.extraction, field) : null;
  const highRisk = !!field && (FINANCE_HIGH_RISK_FIELDS as readonly string[]).includes(field);
  const source = field ? detail.extraction?.fieldSources[field] ?? null : null;
  const confidence = field ? detail.extraction?.fieldConfidence[field] ?? null : null;
  const evidence = field ? detail.extraction?.evidence[field] ?? null : null;

  // Un campo vuoto e non correggibile non dice niente: non si stampa una riga
  // con un trattino per ogni dato che il documento non contiene.
  if (!value && !field) return null;

  return (
    <div className="fin-field">
      <div className="fin-field-label" id={`lbl-${field ?? label}`}>{label}</div>
      <div className="fin-field-value">
        <span className={kind === 'amount' ? 'fin-num' : undefined}>{value ?? '—'}</span>
        {corrected && <span className="badge badge-blue">{t('finance.detail.correctedManually')}</span>}
      </div>

      {corrected && (
        <div className="muted-sm">{t('finance.detail.originalValue', { value: original ?? '—' })}</div>
      )}

      {/* §153 — un dato di pagamento non si modifica «di passaggio»: si dichiara
          che cosa comporta modificarlo, sempre e in evidenza. */}
      {highRisk && <div className="muted-sm">{t('finance.detail.highRiskField')}</div>}

      {field && !editing && (
        <button className="btn btn-sm fin-edit" disabled={busy}
          onClick={() => setDraft(editValue ?? '')}>
          <Icon name="settings" className="ic-sm" /> {t('finance.detail.editField', { field: label })}
        </button>
      )}

      {field && editing && (
        <form
          className="fin-edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            const next = draft.trim();
            ctx.onCorrect(field, next === '' ? null : next);
            setDraft(null);
          }}
        >
          <div className="field">
            <label htmlFor={`edit-${field}`}>{t('finance.detail.editField', { field: label })}</label>
            {kind === 'reference_type' ? (
              <select id={`edit-${field}`} value={draft} onChange={(e) => setDraft(e.target.value)}>
                {REFERENCE_TYPES.map((r) => <option key={r} value={r}>{L.referenceType(r)}</option>)}
              </select>
            ) : (
              <input
                id={`edit-${field}`}
                type={kind === 'date' ? 'date' : 'text'}
                // ⚠️ `inputMode` e non `type="number"`: un campo numerico
                // nasconde la forma decimale esatta dietro il formato locale del
                // browser, e su un importo di fattura è proprio ciò che non si
                // deve perdere. Il valore va al database come TESTO.
                inputMode={kind === 'amount' ? 'decimal' : undefined}
                maxLength={kind === 'currency' ? 3 : undefined}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            )}
          </div>
          <div className="row-wrap">
            <button className="btn btn-sm btn-primary" type="submit" disabled={busy}>
              {t('finance.detail.save')}
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setDraft(null)}>
              {t('finance.detail.cancel')}
            </button>
          </div>
        </form>
      )}

      {field && (source || evidence) && (
        <details className="fin-prov">
          <summary>{t('finance.detail.extractedBy')}</summary>
          <div className="muted-sm">{L.fieldSource(source)}</div>
          {confidence !== null && (
            <div className="muted-sm">
              {t('finance.detail.confidence')} {'·'} {Math.round(confidence * 100)}{'%'}
            </div>
          )}
          <div className="group-label mt-8">{t('finance.detail.evidence')}</div>
          {evidence
            ? <blockquote className="fin-quote">{evidence.quote}</blockquote>
            : <div className="muted-sm">{t('finance.detail.noEvidence')}</div>}
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheda «Dati estratti»
// ---------------------------------------------------------------------------
function DataPanel({ ctx }: { ctx: FieldContext }) {
  const { item, detail, t, L, localeTag } = ctx;
  const isExpense = item.type === 'receipt';

  return (
    <>
      <FinField ctx={ctx} field="supplier_name" label={t('finance.detail.supplier')}
        value={item.supplierName} editValue={item.supplierName} />
      <FinField ctx={ctx} field="merchant" label={t('finance.detail.merchant')}
        value={item.merchant} editValue={item.merchant} />
      <FinField ctx={ctx} field="supplier_address" label={t('finance.detail.supplierAddress')}
        value={effectiveOutsideProjection(detail, 'supplier_address')}
        editValue={effectiveOutsideProjection(detail, 'supplier_address')} />
      <FinField ctx={ctx} field="supplier_vat_id" label={t('finance.detail.vatId')}
        value={effectiveOutsideProjection(detail, 'supplier_vat_id')}
        editValue={effectiveOutsideProjection(detail, 'supplier_vat_id')} />
      <FinField ctx={ctx} field="invoice_number" label={t('finance.detail.invoiceNumber')}
        value={item.invoiceNumber} editValue={item.invoiceNumber} />
      <FinField ctx={ctx} field="invoice_date" label={t('finance.detail.invoiceDate')}
        value={item.invoiceDate ? formatDate(item.invoiceDate) : null}
        editValue={item.invoiceDate} kind="date" />
      {!isExpense && (
        <FinField ctx={ctx} field="due_date" label={t('finance.detail.dueDate')}
          value={item.dueDate ? formatDate(item.dueDate) : null}
          editValue={item.dueDate} kind="date" />
      )}
      {isExpense && (
        <FinField ctx={ctx} field="expense_date" label={t('finance.detail.expenseDate')}
          value={item.expenseDate ? formatDate(item.expenseDate) : null}
          editValue={item.expenseDate} kind="date" />
      )}

      <div className="group-label mt-12">{t('finance.detail.amounts')}</div>
      <FinField ctx={ctx} field="gross_amount" label={t('finance.detail.gross')}
        value={formatDecimal(item.grossAmount, item.currency, localeTag)}
        editValue={item.grossAmount === null ? '' : String(item.grossAmount)} kind="amount" />
      <FinField ctx={ctx} field="net_amount" label={t('finance.detail.net')}
        value={formatDecimal(item.netAmount, item.currency, localeTag)}
        editValue={item.netAmount === null ? '' : String(item.netAmount)} kind="amount" />
      <FinField ctx={ctx} field="vat_amount" label={t('finance.detail.vat')}
        value={formatDecimal(item.vatAmount, item.currency, localeTag)}
        editValue={item.vatAmount === null ? '' : String(item.vatAmount)} kind="amount" />
      {/* La valuta ha una riga sua: senza di essa un importo non è un importo,
          e la sua mancanza deve essere visibile come mancanza. */}
      <FinField ctx={ctx} field="currency" label={t('finance.detail.currency')}
        value={item.currency} editValue={item.currency} kind="currency" />

      {isExpense && (
        <>
          <FinField ctx={ctx} label={t('finance.filters.category')}
            value={item.expenseCategory ? L.expenseCategory(item.expenseCategory) : null} />
          <FinField ctx={ctx} label={t('finance.detail.payment')}
            value={item.paymentMethod ? L.paymentMethod(item.paymentMethod) : null} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Scheda «IVA»
// ---------------------------------------------------------------------------
function VatPanel({ ctx }: { ctx: FieldContext }) {
  const { item, detail, t, L, localeTag } = ctx;
  const lines = detail.extraction?.vatBreakdown ?? [];

  return (
    <>
      <FinField ctx={ctx} field="net_amount" label={t('finance.detail.net')}
        value={formatDecimal(item.netAmount, item.currency, localeTag)}
        editValue={item.netAmount === null ? '' : String(item.netAmount)} kind="amount" />
      <FinField ctx={ctx} field="vat_amount" label={t('finance.detail.vat')}
        value={formatDecimal(item.vatAmount, item.currency, localeTag)}
        editValue={item.vatAmount === null ? '' : String(item.vatAmount)} kind="amount" />

      {/* Il dettaglio per aliquota, quando il documento ce l'ha. Gli importi
          restano STRINGHE decimali: non passano da un double (§48). */}
      {lines.length > 0 && (
        <div className="fin-tablewrap mt-12">
          <table className="fin-table">
            <caption className="sr-only">{t('finance.detail.tabsVat')}</caption>
            <thead>
              <tr>
                <th scope="col">{'%'}</th>
                <th scope="col">{t('finance.detail.net')}</th>
                <th scope="col">{t('finance.detail.vat')}</th>
                <th scope="col">{t('finance.detail.extractedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={`${line.rate}-${i}`}>
                  <th scope="row" className="fin-num">{line.rate}</th>
                  <td className="fin-num">{formatDecimal(line.taxableBase, item.currency, localeTag) ?? '—'}</td>
                  <td className="fin-num">{formatDecimal(line.taxAmount, item.currency, localeTag) ?? '—'}</td>
                  <td>{L.fieldSource(line.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Scheda «Dati di pagamento»
//
// ⚠️⚠️ QUI NON C'È NIENTE SU CUI SI POSSA CLICCARE PER PAGARE, e non è una
// dimenticanza. Nessun collegamento generato dall'IBAN, nessun QR ricostruito,
// nessun file di pagamento, nessun «Paga ora». Finché non ci sono approvazioni
// mature, integrazione bancaria, permessi granulari e riconciliazione, il
// prodotto non deve poter muovere denaro (§41).
// ---------------------------------------------------------------------------
function PaymentPanel({ ctx }: { ctx: FieldContext }) {
  const { item, detail, t, L } = ctx;
  const hasAny = !!(item.iban || item.paymentReference || item.referenceType);
  // Un QR-IBAN è un IBAN con un identificativo d'istituto particolare: lo
  // dichiara il verbale, non lo si deduce qui.
  const ibanLabel = detail.extraction?.ibanIsQr
    ? t('finance.detail.qrIban')
    : t('finance.detail.iban');

  return (
    <>
      <div className="info-box">{t('finance.detail.paymentNotice')}</div>
      {!hasAny ? (
        <div className="empty">{t('finance.detail.noPaymentData')}</div>
      ) : (
        <div className="mt-12">
          <FinField ctx={ctx} field="creditor_iban" label={ibanLabel}
            value={item.iban} editValue={item.iban} />
          <FinField ctx={ctx} field="payment_reference" label={t('finance.detail.reference')}
            value={item.paymentReference} editValue={item.paymentReference} />
          <FinField ctx={ctx} field="reference_type" label={t('finance.detail.referenceType')}
            value={item.referenceType ? L.referenceType(item.referenceType) : null}
            editValue={item.referenceType ?? 'non'} kind="reference_type" />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Scheda «Origine»
// ---------------------------------------------------------------------------
function OriginPanel({ detail, t }: { detail: FinanceDetail; t: TFunction }) {
  const { item, emails } = detail;
  return (
    <>
      <div className="group-label">{t('finance.detail.source')}</div>
      {emails.length > 0 ? (
        emails.map((mail) => (
          <div className="list-row" key={`${mail.messageId}-${mail.relation}`}>
            <div className="list-main">
              <div className="list-title">{mail.subject || t('finance.detail.sourceEmail')}</div>
              <div className="list-sub">
                {[
                  mail.senderName || mail.senderEmail,
                  formatDate(mail.receivedAt),
                  mail.accountEmail,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            <Link className="btn btn-sm" to={`/inbox?msg=${mail.messageId}`}>{t('common.open')}</Link>
          </div>
        ))
      ) : (
        <div className="muted-sm">
          {item.documentSource === 'email' ? t('finance.detail.sourceEmail') : t('finance.detail.sourceUpload')}
          {' · '}{formatDate(item.createdAt)}
        </div>
      )}
      <div className="list-row">
        <div className="list-main">
          <div className="list-title">{item.documentTitle}</div>
          <div className="list-sub">{detail.document ? formatDate(detail.document.createdAt) : ''}</div>
        </div>
        <Link className="btn btn-sm" to={`/documenti/${item.documentId}`}>
          {t('finance.detail.openDocument')}
        </Link>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Scheda «Attività»
// ---------------------------------------------------------------------------
function TasksPanel({
  detail, t, busy, assigneeName, onCreate,
}: {
  detail: FinanceDetail; t: TFunction; busy: boolean;
  assigneeName: (userId: string | null) => string; onCreate: () => void;
}) {
  return (
    <>
      {detail.tasks.length === 0 && <div className="muted-sm">{t('documents.tasksNone')}</div>}
      {detail.tasks.map((task) => {
        const due = dueLabel(task.dueDate);
        return (
          <Link className="list-row is-link" to={`/attivita/${task.id}`} key={task.id}>
            <div className="list-main">
              <div className="list-title">{task.title}</div>
              <div className="list-sub">
                {[assigneeName(task.assigneeUserId), t(statusLabelKey(task.status)), t(due.key, due.params)]
                  .filter(Boolean).join(' · ')}
              </div>
            </div>
            <span className="badge badge-neutral">{t('documents.openTask')}</span>
          </Link>
        );
      })}
      <button className="btn btn-sm mt-10" onClick={onCreate} disabled={busy}>
        <Icon name="calendar" className="ic-sm" /> {t('finance.detail.createTask')}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Scheda «Storico» (§87)
//
// Registra ciò che è CAMBIATO, non chi ha guardato: una traccia di
// consultazioni sarebbe sorveglianza, non verificabilità.
// ---------------------------------------------------------------------------
function AuditPanel({
  detail, t, L,
}: { detail: FinanceDetail; t: TFunction; L: ReturnType<typeof useLabels> }) {
  return (
    <>
      {detail.corrections.length > 0 && (
        <>
          <div className="group-label">{t('finance.detail.correctedManually')}</div>
          {detail.corrections.map((c) => (
            <div className="list-row" key={c.id}>
              <div className="list-main">
                <div className="list-title">
                  {isCorrectableField(c.field)
                    ? t(FIELD_KEY[c.field as FinanceCorrectableField])
                    : c.field}
                </div>
                <div className="list-sub">
                  {t('finance.detail.originalValue', { value: asText(c.originalValue) })}
                </div>
              </div>
              <span className="muted-sm">{formatDate(c.correctedAt)}</span>
            </div>
          ))}
        </>
      )}

      {/* Nessun messaggio per l'elenco vuoto, e non per dimenticanza: la 0021
          registra `created` alla nascita di ogni elemento, quindi uno storico
          vuoto non esiste. Inventare qui una frase «nessuna modifica»
          significherebbe scriverne una che nessuno leggerà mai. */}
      <div className="group-label mt-12">{t('finance.detail.tabsAudit')}</div>
      {detail.events.map((e) => (
        <div className="list-row" key={e.id}>
          <div className="list-main">
            <div className="list-title">{L.financeEvent(e.kind)}</div>
          </div>
          <span className="muted-sm">{formatDate(e.createdAt)}</span>
        </div>
      ))}
    </>
  );
}

/** Un valore di correzione, come testo. `null` si dichiara, non si nasconde. */
function asText(v: unknown): string {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function TechRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (<><dt>{label}</dt><dd>{value}</dd></>);
}
