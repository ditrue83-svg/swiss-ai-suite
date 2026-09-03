// ============================================================================
// FinanceIssuedPanel — l'elenco delle fatture EMESSE verso i clienti (0053),
// nella scheda «Emesse» di Finanze.
//
// Ha volutamente la STESSA forma dell'elenco principale (le righe `finRow`,
// le pastiglie di stato, i totali una riga per valuta) ma un caricamento
// proprio: le fatture emesse non passano da `list_finance_items`, che parla di
// documenti in ARRIVO — qui il documento lo produciamo noi, e la sorgente è
// `financeIssuedService`.
//
// ⚠️⚠️ ANCHE QUI IL MODULO NON MUOVE DENARO: «pagata» e «stornata» sono
// dichiarazioni di una persona registrate con la loro data, e un IBAN è testo
// che si mostra, mai un'azione.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { DeadlineMark } from '@/components/ui/DeadlineMark';
import { ErrorState, EmptyCta, SkeletonLine } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { financeIssuedService } from '@/services/financeIssuedService';
import { crmQuoteService } from '@/services/crmQuoteService';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT, type TFunction, type TKey } from '@/i18n';
import { formatDecimal } from './financeModel';
import {
  FinanceIssuedInvoiceEditor, initialFromQuote, type IssuedInvoiceEditorInitial,
} from './FinanceIssuedInvoiceEditor';
import styles from './finance.module.css';
import type { FinanceIssuedInvoiceStatus, IssuedInvoice } from '@/types/models';

// ---------------------------------------------------------------------------
// Le chiavi degli elenchi chiusi: `Record` completi, come in FinancePage — se
// la 0053 aggiungesse uno stato, il compilatore fallirebbe QUI e non una
// casella vuota nella lista.
// ---------------------------------------------------------------------------
const STATUS_KEY: Record<FinanceIssuedInvoiceStatus, TKey> = {
  draft: 'finance.issued.status.draft',
  issued: 'finance.issued.status.issued',
  sent: 'finance.issued.status.sent',
  overdue: 'finance.issued.status.overdue',
  paid: 'finance.issued.status.paid',
  voided: 'finance.issued.status.voided',
};

// Il tono si decide qui, una volta: «scaduta» chiede un'azione, «pagata» è un
// esito positivo, «bozza» e «stornata» sono il caso normale e non gridano.
const STATUS_TONE: Record<FinanceIssuedInvoiceStatus, TagTone> = {
  draft: 'neutral',
  issued: 'info',
  sent: 'info',
  overdue: 'alert',
  paid: 'ok',
  voided: 'neutral',
};

/** Su una bozza riscritta il PDF è OBSOLETO: la 0053 azzera `pdf_generated_at`. */
function pdfStale(invoice: IssuedInvoice): boolean {
  return invoice.status === 'draft' && !invoice.pdfGeneratedAt;
}

/** La scadenza ha senso quando qualcuno deve ancora pagare. */
function hasDueDate(invoice: IssuedInvoice): boolean {
  return invoice.status === 'issued' || invoice.status === 'sent' || invoice.status === 'overdue';
}

export function FinanceIssuedPanel({ companyId }: { companyId: string }) {
  const t = useT();
  const { localeTag } = useI18n();
  const { showToast } = useToast();
  const [items, setItems] = useState<IssuedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // L'editor è del pannello: «Nuova fattura» qui, «Crea fattura» dal
  // preventivo accettato (che arriva come `?dal-preventivo=` nell'indirizzo).
  const [editor, setEditor] = useState<{ initial: IssuedInvoiceEditorInitial | null } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    financeIssuedService.list(companyId)
      .then((rows) => { if (active) setItems(rows); })
      .catch((e) => {
        if (!active) return;
        setError(toUserMessage(e));
        setItems([]);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, tick]);

  // ---- «Crea fattura» da un preventivo accettato ---------------------------
  // Il gesto nasce nel CRM e atterra qui come parametro dell'indirizzo: la
  // bozza si pre-compila dalla versione del preventivo, poi il parametro si
  // toglie — ricaricando la pagina la finestra non si riapre da sola.
  const [params, setParams] = useSearchParams();
  const fromQuote = params.get('dal-preventivo');
  useEffect(() => {
    if (!fromQuote) return;
    let active = true;
    crmQuoteService.getVersion(companyId, fromQuote)
      .then((quote) => {
        if (!active) return;
        if (quote) setEditor({ initial: initialFromQuote(quote) });
        else showToast(t('finance.issued.prefillFailed'));
      })
      .catch((e) => { if (active) showToast(toUserMessage(e)); })
      .finally(() => {
        if (!active) return;
        const next = new URLSearchParams(params);
        next.delete('dal-preventivo');
        setParams(next, { replace: true });
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromQuote, companyId]);

  // Il totale dell'elenco, UNA RIGA PER VALUTA (§22/§113: due valute non si
  // sommano mai). Le STORNATE non contano: la nota di credito le ha già
  // annullate, e sommarle dipingerebbe un incasso che non esiste — l'etichetta
  // accanto al totale lo dice a chi legge.
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const invoice of items) {
      if (invoice.status === 'voided') continue;
      byCurrency.set(
        invoice.currency,
        (byCurrency.get(invoice.currency) ?? 0) + invoice.totalAmount,
      );
    }
    return [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, total]) => ({ currency, total }));
  }, [items]);

  return (
    <div className="card mt-16" id="fin-list" role="tabpanel" aria-labelledby="fin-tab-issued">
      {/* ⚠️ NON SI OFFRE UN'AZIONE CHE NON PUÒ RIUSCIRE: quando l'elenco non si
          è potuto leggere, anche salvare una bozza fallirebbe — il guasto è
          dichiarato sotto, qui non si aggiunge una promessa. */}
      {!error && (
        <div className="row-wrap mb-12">
          <button className="btn btn-sm" onClick={() => setEditor({ initial: null })}>
            <Icon name="plus" className="ic-sm" /> {t('finance.issued.create')}
          </button>
        </div>
      )}

      {loading && (
        <><SkeletonLine width="80%" /><SkeletonLine width="65%" /><SkeletonLine width="72%" /></>
      )}

      {!loading && error && (
        <ErrorState message={error} onRetry={() => setTick((n) => n + 1)} />
      )}

      {/* ⚠️ Il vuoto è un INIZIO, non un guasto: qui non ci sono filtri da
          togliere, c'è una prima fattura da preparare. */}
      {!loading && !error && items.length === 0 && (
        <EmptyCta
          icon="document"
          title={t('finance.issued.empty')}
          subtitle={t('finance.issued.emptyHint')}
          action={(
            <button className="btn btn-primary" onClick={() => setEditor({ initial: null })}>
              <Icon name="plus" className="ic-sm" /> {t('finance.issued.create')}
            </button>
          )}
        />
      )}

      {!loading && !error && items.map((invoice) => (
        <IssuedRow key={invoice.id} invoice={invoice} t={t} localeTag={localeTag} />
      ))}

      {!loading && !error && totals.length > 0 && (
        <div className="muted-sm mt-16">
          {t('finance.issued.listTotal')}
          {': '}
          {totals.map((row) => formatDecimal(row.total, row.currency, localeTag) ?? '—').join(' · ')}
          {totals.length > 1 && ` — ${t('finance.kpi.multiCurrencyHint')}`}
        </div>
      )}

      <FinanceIssuedInvoiceEditor
        open={editor !== null}
        companyId={companyId}
        initial={editor?.initial ?? null}
        onClose={() => setEditor(null)}
        onSaved={() => { setEditor(null); setTick((n) => n + 1); }}
      />
    </div>
  );
}

function IssuedRow({
  invoice, t, localeTag,
}: {
  invoice: IssuedInvoice; t: TFunction; localeTag: string;
}) {
  const meta = [
    t('finance.row.invoiceNumber', { value: invoice.invoiceNumber }),
    formatDate(invoice.issuedOn),
    invoice.creditNoteNumber
      ? t('finance.issued.creditNoteNumber', { value: invoice.creditNoteNumber })
      : null,
  ].filter(Boolean);

  return (
    <div className={styles.finRow}>
      <Link className={styles.finRowMain} to={`/finanze/emesse/${invoice.id}`}>
        <div className={styles.finRowTitle}>{invoice.customerName}</div>
        <div className={styles.finRowSub}>{meta.join(' · ')}</div>
      </Link>

      <div className={styles.finRowAmount}>
        {formatDecimal(invoice.totalAmount, invoice.currency, localeTag) ?? '—'}
        {hasDueDate(invoice) && (
          <div><DeadlineMark date={invoice.dueDate} display={formatDate(invoice.dueDate)} /></div>
        )}
      </div>

      <div className={styles.finRowSide}>
        <Tag tone={STATUS_TONE[invoice.status]}>{t(STATUS_KEY[invoice.status])}</Tag>
        {/* ⚠️ Una bozza col PDF obsoleto NON si può emettere: la pastiglia lo
            dice qui, dove la fattura si sceglie, e non dopo il rifiuto del
            guardiano. */}
        {pdfStale(invoice) && <Tag tone="attention">{t('finance.issued.pdfStale')}</Tag>}
      </div>
    </div>
  );
}
