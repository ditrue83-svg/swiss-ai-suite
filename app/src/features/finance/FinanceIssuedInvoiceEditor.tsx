// ============================================================================
// FinanceIssuedInvoiceEditor — la BOZZA di una fattura emessa (0053).
//
// Gemello voluto del QuoteEditor dei preventivi: stessa finestra, stesse righe,
// stesse aliquote IVA (la tabella è una sola). Le differenze sono la 0053:
//   · la valuta è solo CHF o EUR, perché la polizza QR non esiste altrove;
//   · su una bozza ESISTENTE cliente e trattativa non si cambiano (lo vieta la
//     RPC: se servono altri, la bozza si ricrea);
//   · il salvataggio è della sola bozza: il PDF si genera dal dettaglio, dove
//     sta anche il pulsante «Emetti» che quel PDF pretende.
//
// Il modulo resta quello che NON muove denaro: qui si scrive una proposta di
// fattura, non un incasso.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { Input, Select, Textarea } from '@/components/ui/forms';
import { SkeletonLine } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { useT, type TKey } from '@/i18n';
import { formatCurrency } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { crmService } from '@/services/crmService';
import { financeIssuedService, type IssuedInvoiceDetail } from '@/services/financeIssuedService';
import { crmQuoteService, type CrmQuoteVersion, type CrmVatRate } from '@/services/crmQuoteService';
import { EMPTY_FILTERS } from '@/features/crm/crmModel';
import styles from '@/features/crm/crm.module.css';
import type { FinanceIssuedInvoiceLanguage } from '@/types/models';
import type { CrmOpportunity, CrmOrganization } from '@/types/models';

type DraftLine = { key: string; description: string; quantity: string; unitPrice: string; vatRateId: string };
const LANGUAGES: FinanceIssuedInvoiceLanguage[] = ['it', 'de', 'fr'];
// Solo CHF ed EUR: la polizza QR non esiste in altre valute, e offrirla sarebbe
// una promessa che il guardiano dell'emissione deve poi smentire.
const CURRENCIES = ['CHF', 'EUR'];
const today = () => new Date().toISOString().slice(0, 10);
const inThirtyDays = () => { const v = new Date(); v.setDate(v.getDate() + 30); return v.toISOString().slice(0, 10); };
const newLine = (vatRateId = ''): DraftLine =>
  ({ key: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '', vatRateId });

/** Ciò che la finestra sa già all'apertura: niente per una bozza nuova, la
 *  fattura per una modifica, il preventivo per «Crea fattura». */
export interface IssuedInvoiceEditorInitial {
  invoiceId: string | null;
  organizationId: string;
  opportunityId: string | null;
  quoteVersionId: string | null;
  language: FinanceIssuedInvoiceLanguage;
  currency: string;
  title: string;
  notes: string;
  issuedOn: string;
  dueDate: string;
  lines: DraftLine[];
}

/** Dal preventivo (accettato) alla bozza: righe e importi si portano dietro. */
export function initialFromQuote(quote: CrmQuoteVersion): IssuedInvoiceEditorInitial {
  return {
    invoiceId: null,
    organizationId: quote.organizationId,
    opportunityId: quote.opportunityId,
    quoteVersionId: quote.id,
    language: quote.language,
    // Un preventivo in USD non diventa una fattura in USD: la polizza QR non la
    // coprirebbe. Si ripiega su CHF e l'operatore vede la valuta, non un errore.
    currency: CURRENCIES.includes(quote.currency) ? quote.currency : 'CHF',
    title: quote.title,
    notes: quote.notes ?? '',
    issuedOn: today(),
    dueDate: inThirtyDays(),
    lines: quote.items.map((item) => ({
      key: item.id, description: item.description,
      quantity: String(item.quantity), unitPrice: String(item.unitPrice), vatRateId: item.vatRateId,
    })),
  };
}

/** Dalla bozza alla finestra che la riscrive. */
export function initialFromDetail(detail: IssuedInvoiceDetail): IssuedInvoiceEditorInitial {
  const { invoice, items } = detail;
  return {
    invoiceId: invoice.id,
    organizationId: invoice.organizationId,
    opportunityId: invoice.opportunityId,
    quoteVersionId: invoice.quoteVersionId,
    language: invoice.language,
    currency: invoice.currency,
    title: invoice.title,
    notes: invoice.notes ?? '',
    issuedOn: invoice.issuedOn,
    dueDate: invoice.dueDate,
    lines: items.map((item) => ({
      key: item.id, description: item.description,
      quantity: String(item.quantity), unitPrice: String(item.unitPrice), vatRateId: item.vatRateId,
    })),
  };
}

export function FinanceIssuedInvoiceEditor(props: {
  open: boolean;
  companyId: string;
  initial: IssuedInvoiceEditorInitial | null;
  onClose: () => void;
  onSaved: (invoiceId: string) => void;
}) {
  const t = useT();
  const { showToast } = useToast();
  const editing = !!props.initial?.invoiceId;

  // Le fonti della finestra: clienti, aliquote, trattative del cliente scelto.
  const [orgs, setOrgs] = useState<CrmOrganization[]>([]);
  const [rates, setRates] = useState<CrmVatRate[]>([]);
  const [sourcesReady, setSourcesReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [opps, setOpps] = useState<CrmOpportunity[]>([]);

  const [orgId, setOrgId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [language, setLanguage] = useState<FinanceIssuedInvoiceLanguage>('it');
  const [currency, setCurrency] = useState('CHF');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [issuedOn, setIssuedOn] = useState(today());
  const [dueDate, setDueDate] = useState(inThirtyDays());
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Clienti e aliquote entrano all'apertura; il modulo resta in attesa finché
  // non ci sono, perché un menu vuoto sembrerebbe «nessun cliente».
  useEffect(() => {
    if (!props.open) return;
    let active = true;
    setSourcesReady(false);
    setLoadError('');
    Promise.all([
      crmService.list(props.companyId, EMPTY_FILTERS),
      financeIssuedService.vatRates(),
    ])
      .then(([page, vatRates]) => {
        if (!active) return;
        setOrgs(page.items);
        setRates(vatRates);
        setSourcesReady(true);
      })
      .catch((e) => { if (active) setLoadError(toUserMessage(e)); });
    return () => { active = false; };
  }, [props.open, props.companyId]);

  // Il modulo si RIEMPIE solo quando le fonti ci sono: inizializzarlo prima e
  // reinizializzarlo dopo cancellerebbe ciò che si sta già scrivendo.
  useEffect(() => {
    if (!props.open || !sourcesReady) return;
    const init = props.initial;
    setOrgId(init?.organizationId ?? '');
    setOpportunityId(init?.opportunityId ?? '');
    setLanguage(init?.language ?? 'it');
    setCurrency(init?.currency ?? 'CHF');
    setTitle(init?.title ?? '');
    setNotes(init?.notes ?? '');
    setIssuedOn(init?.issuedOn ?? today());
    setDueDate(init?.dueDate ?? inThirtyDays());
    setLines(init?.lines.length ? init.lines : [newLine(rates[0]?.id ?? '')]);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initial, sourcesReady]);

  // Le trattative seguono il cliente scelto; senza cliente non ce ne sono.
  useEffect(() => {
    if (!props.open || !orgId) { setOpps([]); return; }
    let active = true;
    crmService.opportunities(props.companyId, { organizationId: orgId, limit: 100 })
      .then((page) => { if (active) setOpps(page.items); })
      .catch(() => { if (active) setOpps([]); });
    return () => { active = false; };
  }, [props.open, props.companyId, orgId]);

  const invalid = !orgId || !title.trim() || !issuedOn || !dueDate || lines.length === 0
    || lines.some((row) => !row.description.trim() || !(Number(row.quantity) > 0)
      || !(Number(row.unitPrice) >= 0) || !row.vatRateId);

  const preview = useMemo(() => lines.reduce((sum, row) => {
    const rate = rates.find((candidate) => candidate.id === row.vatRateId)?.rate ?? 0;
    const net = Number(row.quantity) * Number(row.unitPrice);
    return Number.isFinite(net) ? sum + net + Math.round(net * rate) / 100 : sum;
  }, 0), [lines, rates]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || invalid) return;
    setBusy(true);
    setError('');
    try {
      const invoiceId = await financeIssuedService.saveDraft(props.companyId, {
        invoiceId: props.initial?.invoiceId ?? null,
        organizationId: orgId,
        opportunityId: opportunityId || null,
        quoteVersionId: props.initial?.quoteVersionId ?? null,
        language, currency, title: title.trim(), notes: notes || null,
        issuedOn, dueDate,
        items: lines.map((row) => ({
          description: row.description.trim(), quantity: Number(row.quantity),
          unitPrice: Number(row.unitPrice), vatRateId: row.vatRateId,
        })),
      });
      showToast(t('finance.issued.savedToast'));
      props.onSaved(invoiceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onClose={() => !busy && props.onClose()}
      title={t(editing ? 'finance.issued.edit' : 'finance.issued.create')}>
      {loadError && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{loadError}</span></div>}
      {!loadError && !sourcesReady && (
        <><SkeletonLine width="80%" /><SkeletonLine width="65%" /></>
      )}
      {!loadError && sourcesReady && (
        <form onSubmit={save}>
          <div className="grid-2">
            <Select id="inv-customer" label={t('finance.issued.customer')} value={orgId}
              disabled={busy || editing}
              onChange={(event) => { setOrgId(event.target.value); setOpportunityId(''); }}>
              <option value="">{'—'}</option>
              {orgs.map((org) => <option key={org.id} value={org.id}>{org.displayName}</option>)}
            </Select>
            <Select id="inv-opportunity" label={t('finance.issued.opportunity')} value={opportunityId}
              disabled={busy || editing}
              onChange={(event) => setOpportunityId(event.target.value)}>
              <option value="">{'—'}</option>
              {opps.map((opp) => <option key={opp.id} value={opp.id}>{opp.title}</option>)}
            </Select>
            <Select id="inv-language" label={t('crm.quotes.language')} value={language} disabled={busy}
              onChange={(event) => setLanguage(event.target.value as FinanceIssuedInvoiceLanguage)}>
              {LANGUAGES.map((value) => (
                <option key={value} value={value}>{t(`crm.quotes.languages.${value}` as TKey)}</option>
              ))}
            </Select>
            <Select id="inv-currency" label={t('crm.opp.currency')} value={currency} disabled={busy}
              onChange={(event) => setCurrency(event.target.value)}>
              {CURRENCIES.map((value) => <option key={value}>{value}</option>)}
            </Select>
            <Input id="inv-issued-on" type="date" label={t('finance.issued.issuedOnLabel')}
              value={issuedOn} disabled={busy} onChange={(event) => setIssuedOn(event.target.value)} />
            <Input id="inv-due-date" type="date" label={t('finance.issued.dueDateLabel')}
              value={dueDate} disabled={busy} min={issuedOn}
              onChange={(event) => setDueDate(event.target.value)} />
          </div>
          <p className="muted-sm">{t('finance.issued.currencyHint')}</p>
          {/* Su una bozza esistente la 0053 vieta di cambiare cliente o
              trattativa: i menu sono spenti e la frase dice perché. */}
          {editing && <p className="muted-sm">{t('finance.issued.lockedPartiesHint')}</p>}
          <Input id="inv-title" label={t('crm.quotes.subject')} value={title} disabled={busy}
            maxLength={200} onChange={(event) => setTitle(event.target.value)} />
          <div className="card-title mt-8">{t('crm.quotes.items')}</div>
          <div className={styles.quoteLines}>
            {lines.map((row, index) => (
              <div className={styles.quoteLine} key={row.key}>
                <Input id={`inv-desc-${row.key}`} label={t('crm.quotes.description')} value={row.description}
                  disabled={busy} maxLength={500}
                  onChange={(event) => setLines((current) => current.map((item, at) => (at === index ? { ...item, description: event.target.value } : item)))} />
                <Input id={`inv-qty-${row.key}`} label={t('crm.quotes.quantity')} value={row.quantity}
                  disabled={busy} inputMode="decimal"
                  onChange={(event) => setLines((current) => current.map((item, at) => (at === index ? { ...item, quantity: event.target.value } : item)))} />
                <Input id={`inv-price-${row.key}`} label={t('crm.quotes.unitPrice')} value={row.unitPrice}
                  disabled={busy} inputMode="decimal"
                  onChange={(event) => setLines((current) => current.map((item, at) => (at === index ? { ...item, unitPrice: event.target.value } : item)))} />
                <Select id={`inv-vat-${row.key}`} label={t('crm.quotes.vat')} value={row.vatRateId}
                  disabled={busy}
                  onChange={(event) => setLines((current) => current.map((item, at) => (at === index ? { ...item, vatRateId: event.target.value } : item)))}>
                  <option value="">{'-'}</option>
                  {rates.map((rate) => <option key={rate.id} value={rate.id}>{rate.rate}{'%'}</option>)}
                </Select>
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy || lines.length === 1}
                  onClick={() => setLines((current) => current.filter((_, at) => at !== index))}>
                  {t('crm.quotes.removeLine')}
                </button>
              </div>
            ))}
          </div>
          <div className="row-wrap mt-8">
            <button type="button" className="btn btn-sm" disabled={busy}
              onClick={() => setLines((current) => [...current, newLine(rates[0]?.id ?? '')])}>
              {t('crm.quotes.addLine')}
            </button>
            <span className="muted-sm">{t('crm.quotes.previewTotal')}: {formatCurrency(preview, currency)}</span>
          </div>
          <p className="muted-sm">{t('crm.quotes.vatSourceHint')}</p>
          <Textarea id="inv-notes" label={t('crm.quotes.notes')} value={notes} disabled={busy}
            rows={3} maxLength={2000} error={error || undefined}
            onChange={(event) => setNotes(event.target.value)} />
          <div className="row-wrap">
            <button className="btn btn-primary" disabled={busy || invalid}>
              {t('finance.issued.saveDraft')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={props.onClose}>
              {t('crm.form.cancel')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
