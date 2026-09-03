// ============================================================================
// Dettaglio di una fattura EMMESSA verso un cliente (0053).
//
// ⚠️⚠️ IL MODULO COMPRENDE E PREPARA IL DENARO, NON LO MUOVE.
// Anche qui non esiste — e non deve esistere — un pulsante «Incassa», un
// collegamento generato dall'IBAN o un QR ricostruito: IBAN e riferimento sono
// TESTO sulla fattura, «pagata» è la dichiarazione di una persona con la data
// effettiva del versamento, e lo storno produce la nota di credito, non un
// rimborso.
//
// La fattura emessa è IMMUTABILE: dopo l'emissione non si corregge, si storna.
// Per questo le azioni cambiano con lo stato e quelle impossibili non si
// offrono: una bozza si emette, una fattura aperta si marca pagata o si storna,
// e «inviata» la scrive l'invio dell'email dal CRM — non un pulsante qui.
// ============================================================================
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Textarea } from '@/components/ui/forms';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { financeIssuedService, type IssuedInvoiceDetail } from '@/services/financeIssuedService';
import { AppError, toUserMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useI18n, useT, type TFunction, type TKey } from '@/i18n';
import { formatDecimal } from './financeModel';
import { FinanceIssuedInvoiceEditor, initialFromDetail } from './FinanceIssuedInvoiceEditor';
import { cx } from '@/lib/cx';
import styles from './finance.module.css';
import type { FinanceIssuedInvoiceStatus, IssuedInvoiceDocument } from '@/types/models';

// Le chiavi degli elenchi chiusi: `Record` completi, come nella lista — uno
// stato nuovo nella 0053 farebbe fallire il compilatore QUI e non una pastiglia
// vuota nella pagina.
const STATUS_KEY: Record<FinanceIssuedInvoiceStatus, TKey> = {
  draft: 'finance.issued.status.draft',
  issued: 'finance.issued.status.issued',
  sent: 'finance.issued.status.sent',
  overdue: 'finance.issued.status.overdue',
  paid: 'finance.issued.status.paid',
  voided: 'finance.issued.status.voided',
};
const STATUS_TONE: Record<FinanceIssuedInvoiceStatus, TagTone> = {
  draft: 'neutral', issued: 'info', sent: 'info', overdue: 'alert', paid: 'ok', voided: 'neutral',
};

/** Gli stati in cui la fattura aspetta ancora il denaro: pagamento, sollecito e storno vivono qui. */
const OPEN: readonly FinanceIssuedInvoiceStatus[] = ['issued', 'sent', 'overdue'];

/** Il prossimo sollecito è il livello dopo il più alto già generato (max 3). */
function nextReminderLevel(documents: IssuedInvoiceDocument[]): number {
  return documents
    .filter((doc) => doc.kind === 'reminder')
    .reduce((max, doc) => Math.max(max, doc.level ?? 0), 0) + 1;
}

function docLabel(doc: IssuedInvoiceDocument, t: TFunction): string {
  if (doc.kind === 'credit_note') return t('finance.issued.docCreditNote');
  if (doc.kind === 'reminder') return t('finance.issued.docReminder', { level: doc.level ?? 1 });
  return t('finance.issued.docInvoice');
}

export function FinanceIssuedDetailPage() {
  const t = useT();
  const { localeTag } = useI18n();
  const { invoiceId = '' } = useParams();
  const { activeCompanyId } = useCompany();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;

  const { loading, error, data, reload } = useAsync<IssuedInvoiceDetail | null>(
    () => financeIssuedService.get(companyId, invoiceId), [companyId, invoiceId],
  );

  const [busy, setBusy] = useState(false);
  // «Marca pagata» e «Storna» chiedono un dato (la data, il motivo): per questo
  // hanno una finestra e non un semplice clic.
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [editing, setEditing] = useState(false);
  // L'IBAN mancante non è un errore come gli altri: ha una CURA, e la cura sta
  // nelle impostazioni dell'azienda. Il messaggio e il collegamento arrivano
  // insieme, nella stessa frase.
  const [ibanMissing, setIbanMissing] = useState<string | null>(null);

  async function run(action: () => Promise<void>, message: TKey) {
    if (busy) return;
    setBusy(true);
    setIbanMissing(null);
    try {
      await action();
      showToast(t(message));
      reload();
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVOICE_IBAN_MISSING') setIbanMissing(err.message);
      else showToast(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  // «Non trovata» non è «non ho potuto leggerla»: l'errore ha il suo ramo qui
  // sopra, col pulsante per riprovare.
  if (!data) {
    return (
      <div className="page-head">
        <Link className="btn btn-sm btn-ghost mb-8" to="/finanze?sezione=issued">
          <Icon name="arrowLeft" className="ic-sm" /> {t('finance.issued.back')}
        </Link>
        <div className="page-title">{t('finance.errors.notFound')}</div>
      </div>
    );
  }

  const { invoice, items, documents } = data;
  const open = OPEN.includes(invoice.status);
  const stale = invoice.status === 'draft' && !invoice.pdfGeneratedAt;
  const reminderLevel = nextReminderLevel(documents);
  const reminderDone = reminderLevel > 3;

  return (
    <>
      <div className="page-head">
        <Link className="btn btn-sm btn-ghost mb-8" to="/finanze?sezione=issued">
          <Icon name="arrowLeft" className="ic-sm" /> {t('finance.issued.back')}
        </Link>
        <div className="page-title">
          {t('finance.row.invoiceNumber', { value: invoice.invoiceNumber })} · {invoice.customerName}
        </div>
        <div className="page-desc">
          {invoice.title}
          {' · '}{t('finance.issued.issuedOn')} {formatDate(invoice.issuedOn)}
          {' · '}<DeadlineMark date={invoice.dueDate} display={formatDate(invoice.dueDate)} />
        </div>
        <div className="badge-row">
          <Tag tone={STATUS_TONE[invoice.status]}>{t(STATUS_KEY[invoice.status])}</Tag>
          {stale && <Tag tone="attention">{t('finance.issued.pdfStale')}</Tag>}
          {invoice.creditNoteNumber && (
            <Tag>{t('finance.issued.creditNoteNumber', { value: invoice.creditNoteNumber })}</Tag>
          )}
        </div>
      </div>

      {/* ---- Le azioni: quelle che lo stato permette, e basta ------------- */}
      <div className="row-wrap mt-12">
        {invoice.status === 'draft' && (
          <>
            <button className="btn" disabled={busy} onClick={() => setEditing(true)}>
              <Icon name="fileSignature" className="ic-sm" /> {t('finance.issued.edit')}
            </button>
            <button className="btn" disabled={busy}
              onClick={() => void run(() => financeIssuedService.generatePdf(companyId, invoice.id).then(() => undefined), 'finance.issued.pdfToast')}>
              <Icon name="document" className="ic-sm" />
              {stale ? t('finance.issued.regenerate') : t('finance.issued.generate')}
            </button>
            {/* ⚠️ Emettere SENZA il PDF non si può (il guardiano della 0053 lo
                vieta): il pulsante è spento e la frase dice perché, invece di
                offrire un rifiuto. */}
            <button className="btn btn-primary" disabled={busy || !invoice.pdfGeneratedAt}
              onClick={() => {
                if (!window.confirm(t('finance.issued.issueConfirm'))) return;
                void run(() => financeIssuedService.issue(companyId, invoice.id), 'finance.issued.issuedToast');
              }}>
              <Icon name="checkCircle" className="ic-sm" /> {t('finance.issued.issue')}
            </button>
          </>
        )}
        {open && (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => setPaying(true)}>
              <Icon name="checkCircle" className="ic-sm" /> {t('finance.issued.markPaid')}
            </button>
            <button className="btn" disabled={busy || reminderDone}
              onClick={() => void run(
                () => financeIssuedService.generatePdf(companyId, invoice.id, 'reminder', reminderLevel).then(() => undefined),
                'finance.issued.reminderToast',
              )}>
              <Icon name="document" className="ic-sm" />
              {t('finance.issued.reminder')} · {t('finance.issued.docReminder', { level: reminderLevel })}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setVoiding(true)}>
              <Icon name="close" className="ic-sm" /> {t('finance.issued.void')}
            </button>
          </>
        )}
      </div>

      {/* Quando il pulsante è spento si dice perché: un comando disabilitato e
          muto sembra un guasto. */}
      {invoice.status === 'draft' && !invoice.pdfGeneratedAt && (
        <div className="muted-sm mt-8">{t('finance.issued.errors.pdfRequired')}</div>
      )}
      {open && reminderDone && (
        <div className="muted-sm mt-8">{t('finance.issued.reminderMax')}</div>
      )}
      {invoice.status === 'sent' && (
        <div className="muted-sm mt-8">{t('finance.issued.emailHint')}</div>
      )}
      {ibanMissing && (
        <div className="info-box mt-12">
          {ibanMissing}{' '}
          <Link to="/azienda">{t('finance.issued.ibanMissingLink')}</Link>
        </div>
      )}

      {/* ---- Gli importi --------------------------------------------------- */}
      <div className="card mt-16">
        <div className="card-title">{t('finance.issued.amounts')}</div>
        <dl className="crm-kv">
          <dt>{t('finance.issued.subtotal')}</dt>
          <dd>{formatDecimal(invoice.subtotalAmount, invoice.currency, localeTag) ?? '—'}</dd>
          <dt>{t('finance.issued.vat')}</dt>
          <dd>{formatDecimal(invoice.vatAmount, invoice.currency, localeTag) ?? '—'}</dd>
          <dt>{t('finance.issued.total')}</dt>
          <dd><strong>{formatDecimal(invoice.totalAmount, invoice.currency, localeTag) ?? '—'}</strong></dd>
        </dl>

        <div className={cx(styles.finTablewrap, 'mt-12')}>
          <table className={styles.finTable}>
            <caption className="sr-only">{t('finance.issued.items')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('finance.issued.description')}</th>
                <th scope="col">{t('finance.issued.quantity')}</th>
                <th scope="col">{t('finance.issued.unitPrice')}</th>
                <th scope="col">{t('finance.issued.vatRate')}</th>
                <th scope="col">{t('finance.issued.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.description}</th>
                  <td className={styles.finNum}>{item.quantity}</td>
                  <td className={styles.finNum}>{formatDecimal(item.unitPrice, invoice.currency, localeTag) ?? '—'}</td>
                  <td className={styles.finNum}>{item.vatRate}{'%'}</td>
                  <td className={styles.finNum}>{formatDecimal(item.totalAmount, invoice.currency, localeTag) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- I dati di pagamento -------------------------------------------
          ⚠️⚠️ IBAN e riferimento sono TESTO, e la frase che lo dice sta sopra
          di essi, non in una nota a piè di pagina: niente collegamenti, niente
          «paga ora», niente QR ricostruito. */}
      {(invoice.companyBankIban || invoice.paymentReference) && (
        <div className="card mt-16">
          <div className="card-title">{t('finance.issued.payment')}</div>
          <div className="muted-sm mb-12">{t('finance.issued.paymentHint')}</div>
          <dl className="crm-kv">
            {invoice.companyBankIban && (
              <>
                <dt>{t('finance.issued.iban')}</dt>
                <dd>{invoice.companyBankIban}</dd>
              </>
            )}
            {invoice.paymentReference && (
              <>
                <dt>{t('finance.issued.reference')}</dt>
                <dd>{invoice.paymentReference}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* ---- I documenti: la fattura, la nota di credito, i solleciti ------ */}
      {documents.length > 0 && (
        <div className="card mt-16">
          <div className="card-title">{t('finance.issued.documents')}</div>
          {documents.map((doc) => (
            <div className="list-row" key={doc.id}>
              <div className="list-main">
                <div className="list-title">{docLabel(doc, t)}</div>
                <div className="list-sub">{formatDate(doc.createdAt)}</div>
              </div>
              <button className="btn btn-sm" disabled={busy}
                onClick={() => void financeIssuedService.openPdf(doc.documentId)
                  .catch((err) => showToast(toUserMessage(err)))}>
                {t('finance.issued.openPdf')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---- Il registro: che cosa è successo, e quando -------------------- */}
      <div className="card mt-16">
        <div className="card-title">{t('finance.issued.stamps')}</div>
        <dl className="crm-kv">
          <dt>{t('finance.issued.stampsCreated')}</dt><dd>{formatDate(invoice.createdAt)}</dd>
          {invoice.pdfGeneratedAt && (
            <>
              <dt>{t('finance.issued.stampsPdf')}</dt><dd>{formatDate(invoice.pdfGeneratedAt)}</dd>
            </>
          )}
          {invoice.issuedAt && (
            <>
              <dt>{t('finance.issued.stampsIssued')}</dt><dd>{formatDate(invoice.issuedAt)}</dd>
            </>
          )}
          {invoice.sentAt && (
            <>
              <dt>{t('finance.issued.stampsSent')}</dt><dd>{formatDate(invoice.sentAt)}</dd>
            </>
          )}
          {/* «Pagata» ha DUE date: quella effettiva del versamento, dichiarata
              da una persona, e quella della registrazione. La prima è il fatto,
              la seconda il suo verbale. */}
          {invoice.paidOn && (
            <>
              <dt>{t('finance.issued.stampsPaid')}</dt><dd>{formatDate(invoice.paidOn)}</dd>
            </>
          )}
          {invoice.paidAt && (
            <>
              <dt>{t('finance.issued.stampsPaidRecorded')}</dt><dd>{formatDate(invoice.paidAt)}</dd>
            </>
          )}
          {invoice.overdueAt && (
            <>
              <dt>{t('finance.issued.stampsOverdue')}</dt><dd>{formatDate(invoice.overdueAt)}</dd>
            </>
          )}
          {invoice.voidedAt && (
            <>
              <dt>{t('finance.issued.stampsVoided')}</dt><dd>{formatDate(invoice.voidedAt)}</dd>
            </>
          )}
          {invoice.voidReason && (
            <>
              <dt>{t('finance.issued.voidReason')}</dt><dd>{invoice.voidReason}</dd>
            </>
          )}
        </dl>
      </div>

      {/* ---- «Marca pagata»: la data EFFETTIVA del versamento, non oggi ---- */}
      <Dialog open={paying} onClose={() => !busy && setPaying(false)} title={t('finance.issued.markPaid')}>
        <form onSubmit={(event) => {
          event.preventDefault();
          setPaying(false);
          void run(() => financeIssuedService.setPaid(companyId, invoice.id, paidOn), 'finance.issued.paidToast');
        }}>
          <Input id="inv-paid-on" type="date" label={t('finance.issued.paidOnLabel')}
            value={paidOn} disabled={busy} onChange={(event) => setPaidOn(event.target.value)} />
          <div className="row-wrap mt-8">
            <button className="btn btn-primary" disabled={busy || !paidOn}>
              {t('finance.issued.paidConfirm')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setPaying(false)}>
              {t('crm.form.cancel')}
            </button>
          </div>
        </form>
      </Dialog>

      {/* ---- Lo storno: definitivo, con il motivo agli atti ----------------- */}
      <Dialog open={voiding} onClose={() => !busy && setVoiding(false)} title={t('finance.issued.voidTitle')}>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!voidReason.trim()) return;
          setVoiding(false);
          // Lo storno assegna il numero di nota di credito; il PDF la materializza.
          void run(async () => {
            await financeIssuedService.void(companyId, invoice.id, voidReason.trim());
            await financeIssuedService.generatePdf(companyId, invoice.id, 'credit_note');
          }, 'finance.issued.voidedToast');
        }}>
          <p>{t('finance.issued.voidQuestion')}</p>
          <Textarea id="inv-void-reason" label={t('finance.issued.voidReasonLabel')}
            value={voidReason} disabled={busy} rows={3} maxLength={500}
            onChange={(event) => setVoidReason(event.target.value)} />
          <div className="row-wrap mt-8">
            <button className="btn btn-primary" disabled={busy || !voidReason.trim()}>
              {t('finance.issued.voidConfirm')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setVoiding(false)}>
              {t('crm.form.cancel')}
            </button>
          </div>
        </form>
      </Dialog>

      {/* ---- La modifica della bozza: la stessa finestra della creazione ----- */}
      <FinanceIssuedInvoiceEditor
        open={editing}
        companyId={companyId}
        initial={editing ? initialFromDetail(data) : null}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); reload(); }}
      />
    </>
  );
}
