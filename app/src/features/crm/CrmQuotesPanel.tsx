import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/forms';
import { Tag } from '@/components/ui/Tag';
import { EmptyCta } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { useT, type TKey } from '@/i18n';
import { formatCurrency, formatDate } from '@/lib/format';
import { crmQuoteService, type CrmQuoteVersion, type CrmVatRate } from '@/services/crmQuoteService';
import type { CrmOpportunityStage, CrmQuoteLanguage } from '@/types/database';
import styles from './crm.module.css';

type DraftLine = { key: string; description: string; quantity: string; unitPrice: string; vatRateId: string };
const LANGUAGES: CrmQuoteLanguage[] = ['it', 'de', 'fr'];
const CURRENCIES = ['CHF', 'EUR', 'USD'];
const futureDate = () => { const value = new Date(); value.setDate(value.getDate() + 30); return value.toISOString().slice(0, 10); };
const newLine = (vatRateId = ''): DraftLine => ({ key: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '', vatRateId });

function QuoteEditor(props: {
  open: boolean; companyId: string; opportunityId: string; initial: CrmQuoteVersion | null;
  rates: CrmVatRate[]; onClose: () => void; onSaved: (created: boolean) => void;
}) {
  const t = useT(); const { showToast } = useToast();
  const [language, setLanguage] = useState<CrmQuoteLanguage>('it');
  const [validUntil, setValidUntil] = useState(futureDate()); const [currency, setCurrency] = useState('CHF');
  const [title, setTitle] = useState(''); const [introduction, setIntroduction] = useState(''); const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newLine()]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    if (!props.open) return;
    const firstRate = props.rates[0]?.id ?? '';
    if (props.initial) {
      setLanguage(props.initial.language); setValidUntil(props.initial.validUntil); setCurrency(props.initial.currency);
      setTitle(props.initial.title); setIntroduction(props.initial.introduction ?? ''); setNotes(props.initial.notes ?? '');
      setLines(props.initial.items.map((item) => ({ key: item.id, description: item.description,
        quantity: String(item.quantity), unitPrice: String(item.unitPrice), vatRateId: item.vatRateId })));
    } else {
      setLanguage('it'); setValidUntil(futureDate()); setCurrency('CHF'); setTitle(''); setIntroduction(''); setNotes('');
      setLines([newLine(firstRate)]);
    }
    setError('');
  }, [props.open, props.initial, props.rates]);

  const invalid = !title.trim() || !validUntil || lines.length === 0 || lines.some((row) =>
    !row.description.trim() || !(Number(row.quantity) > 0) || !(Number(row.unitPrice) >= 0) || !row.vatRateId);
  const preview = useMemo(() => lines.reduce((sum, row) => {
    const rate = props.rates.find((candidate) => candidate.id === row.vatRateId)?.rate ?? 0;
    const net = Number(row.quantity) * Number(row.unitPrice);
    return Number.isFinite(net) ? sum + net + Math.round(net * rate) / 100 : sum;
  }, 0), [lines, props.rates]);

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy || invalid) return;
    setBusy(true); setError('');
    try {
      const versionId = await crmQuoteService.saveDraft(props.companyId, props.opportunityId, {
        quoteId: props.initial?.quoteId ?? null, language, validUntil, currency, title,
        introduction: introduction || null, notes: notes || null,
        items: lines.map((row) => ({ description: row.description.trim(), quantity: Number(row.quantity),
          unitPrice: Number(row.unitPrice), vatRateId: row.vatRateId })),
      });
      await crmQuoteService.generatePdf(props.companyId, versionId);
      showToast(t('crm.quotes.saved'));
      props.onSaved(!props.initial);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return <Dialog open={props.open} onClose={() => !busy && props.onClose()} title={t(props.initial ? 'crm.quotes.edit' : 'crm.quotes.create')}>
    <form onSubmit={save}>
      <div className="grid-2">
        <Select id="quote-language" label={t('crm.quotes.language')} value={language} disabled={busy}
          onChange={(event) => setLanguage(event.target.value as CrmQuoteLanguage)}>
          {LANGUAGES.map((value) => <option key={value} value={value}>{t(`crm.quotes.languages.${value}` as TKey)}</option>)}
        </Select>
        <Input id="quote-valid" type="date" label={t('crm.quotes.validUntil')} value={validUntil} disabled={busy}
          min={new Date().toISOString().slice(0, 10)} onChange={(event) => setValidUntil(event.target.value)} />
        <Select id="quote-currency" label={t('crm.opp.currency')} value={currency} disabled={busy}
          onChange={(event) => setCurrency(event.target.value)}>{CURRENCIES.map((value) => <option key={value}>{value}</option>)}</Select>
        <Input id="quote-title" label={t('crm.quotes.subject')} value={title} disabled={busy} maxLength={200}
          onChange={(event) => setTitle(event.target.value)} />
      </div>
      <Textarea id="quote-intro" label={t('crm.quotes.introduction')} value={introduction} disabled={busy}
        rows={3} maxLength={2000} onChange={(event) => setIntroduction(event.target.value)} />
      <div className="card-title mt-8">{t('crm.quotes.items')}</div>
      <div className={styles.quoteLines}>
        {lines.map((row, index) => <div className={styles.quoteLine} key={row.key}>
          <Input id={`quote-desc-${row.key}`} label={t('crm.quotes.description')} value={row.description} disabled={busy}
            maxLength={500} onChange={(event) => setLines((current) => current.map((item, at) => at === index ? { ...item, description: event.target.value } : item))} />
          <Input id={`quote-qty-${row.key}`} label={t('crm.quotes.quantity')} value={row.quantity} disabled={busy}
            inputMode="decimal" onChange={(event) => setLines((current) => current.map((item, at) => at === index ? { ...item, quantity: event.target.value } : item))} />
          <Input id={`quote-price-${row.key}`} label={t('crm.quotes.unitPrice')} value={row.unitPrice} disabled={busy}
            inputMode="decimal" onChange={(event) => setLines((current) => current.map((item, at) => at === index ? { ...item, unitPrice: event.target.value } : item))} />
          <Select id={`quote-vat-${row.key}`} label={t('crm.quotes.vat')} value={row.vatRateId} disabled={busy}
            onChange={(event) => setLines((current) => current.map((item, at) => at === index ? { ...item, vatRateId: event.target.value } : item))}>
            <option value="">-</option>{props.rates.map((rate) => <option key={rate.id} value={rate.id}>{rate.rate}%</option>)}
          </Select>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy || lines.length === 1}
            onClick={() => setLines((current) => current.filter((_, at) => at !== index))}>{t('crm.quotes.removeLine')}</button>
        </div>)}
      </div>
      <div className="row-wrap mt-8">
        <button type="button" className="btn btn-sm" disabled={busy}
          onClick={() => setLines((current) => [...current, newLine(props.rates[0]?.id ?? '')])}>{t('crm.quotes.addLine')}</button>
        <span className="muted-sm">{t('crm.quotes.previewTotal')}: {formatCurrency(preview, currency)}</span>
      </div>
      <p className="muted-sm">{t('crm.quotes.vatSourceHint')}</p>
      <Textarea id="quote-notes" label={t('crm.quotes.notes')} value={notes} disabled={busy}
        rows={3} maxLength={2000} error={error || undefined} onChange={(event) => setNotes(event.target.value)} />
      <div className="row-wrap"><button className="btn btn-primary" disabled={busy || invalid}>{t('crm.quotes.saveAndGenerate')}</button>
        <button type="button" className="btn" disabled={busy} onClick={props.onClose}>{t('crm.form.cancel')}</button></div>
    </form>
  </Dialog>;
}

export function CrmQuotesPanel(props: {
  companyId: string; opportunityId: string; opportunityStage: CrmOpportunityStage;
  refreshToken: number;
  onMoveStage: (stage: 'proposal' | 'won') => Promise<void>;
}) {
  const t = useT(); const { showToast } = useToast();
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<CrmQuoteVersion[]>([]); const [rates, setRates] = useState<CrmVatRate[]>([]);
  const [editor, setEditor] = useState<CrmQuoteVersion | 'new' | null>(null); const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<CrmQuoteVersion | null>(null); const [suggestProposal, setSuggestProposal] = useState(false);
  async function load() {
    const [quoteRows, vatRows] = await Promise.all([
      crmQuoteService.list(props.companyId, props.opportunityId), crmQuoteService.vatRates(),
    ]); setQuotes(quoteRows); setRates(vatRows);
  }
  useEffect(() => { void load(); }, [props.companyId, props.opportunityId, props.refreshToken]);
  async function run(action: () => Promise<void>, message: TKey) {
    if (busy) return; setBusy(true);
    try { await action(); showToast(t(message)); await load(); }
    catch (err) { showToast(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return <div className="crm-sec">
    <div className="crm-sec-head"><div><strong>{t('crm.quotes.title')}</strong><div className="muted-sm">{t('crm.quotes.emailHint')}</div></div>
      <button type="button" className="btn btn-sm" onClick={() => setEditor('new')}>{t('crm.quotes.create')}</button></div>
    {quotes.length === 0 ? <EmptyCta title={t('crm.quotes.empty')} /> : <div className={styles.quoteCards}>
      {quotes.map((quote) => <div className={styles.quoteCard} key={quote.id}>
        <div className={styles.quoteCardMain}><div className="list-title">{quote.quoteNumber} · {t('crm.quotes.versionLabel', { n: quote.version })}</div>
          <div className="list-sub">{quote.title} · {formatDate(quote.issuedOn)} · {t('crm.quotes.validUntil')} {formatDate(quote.validUntil)}</div>
          <div className="row-wrap"><Tag tone={quote.status === 'accepted' ? 'ok' : quote.status === 'rejected' || quote.status === 'expired' ? 'alert' : quote.status === 'sent' ? 'info' : 'neutral'}>{t(`crm.quotes.status.${quote.status}` as TKey)}</Tag>
            <strong>{formatCurrency(quote.totalAmount, quote.currency)}</strong>
            {quote.status === 'draft' && !quote.pdfGeneratedAt && <Tag tone="attention">{t('crm.quotes.pdfStale')}</Tag>}</div></div>
        <div className="row-wrap">
          {quote.documentStoragePath && quote.pdfGeneratedAt && <button type="button" className="btn btn-sm" onClick={() => void crmQuoteService.openPdf(quote.documentStoragePath!)}>{t('crm.quotes.openPdf')}</button>}
          {quote.status === 'draft' && <button type="button" className="btn btn-sm" onClick={() => setEditor(quote)}>{t('crm.quotes.edit')}</button>}
          {quote.status === 'draft' && !quote.pdfGeneratedAt && <button type="button" className="btn btn-sm" disabled={busy}
            onClick={() => void run(() => crmQuoteService.generatePdf(props.companyId, quote.id).then(() => undefined), 'crm.quotes.generated')}>{t('crm.quotes.regenerate')}</button>}
          {quote.status === 'sent' && <><button type="button" className="btn btn-sm" disabled={busy} onClick={() => setAccepted(quote)}>{t('crm.quotes.accept')}</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run(() => crmQuoteService.setStatus(props.companyId, quote.id, 'rejected'), 'crm.quotes.statusSaved')}>{t('crm.quotes.reject')}</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void run(() => crmQuoteService.setStatus(props.companyId, quote.id, 'expired'), 'crm.quotes.statusSaved')}>{t('crm.quotes.expire')}</button></>}
          {/* 0053 — dal preventivo accettato alla fattura: il gesto porta alla
              scheda «Emesse» con la bozza già pre-compilata da QUESTA versione. */}
          {quote.status === 'accepted' && (
            <button type="button" className="btn btn-sm"
              onClick={() => navigate(`/finanze?sezione=emesse&dal-preventivo=${quote.id}`)}>
              {t('crm.quotes.createInvoice')}
            </button>
          )}
          {quote.status !== 'draft' && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run(async () => {
            await crmQuoteService.newVersion(props.companyId, quote.quoteId);
            const next = (await crmQuoteService.list(props.companyId, props.opportunityId)).find((candidate) => candidate.quoteId === quote.quoteId && candidate.status === 'draft');
            if (next) setEditor(next);
          }, 'crm.quotes.versionCreated')}>{t('crm.quotes.newVersion')}</button>}
        </div>
      </div>)}
    </div>}
    <QuoteEditor open={editor !== null} companyId={props.companyId} opportunityId={props.opportunityId}
      initial={editor === 'new' ? null : editor} rates={rates} onClose={() => setEditor(null)} onSaved={(created) => {
        setEditor(null); void load(); if (created && !['proposal', 'won', 'lost'].includes(props.opportunityStage)) setSuggestProposal(true);
      }} />
    <Dialog open={suggestProposal} onClose={() => setSuggestProposal(false)} title={t('crm.quotes.proposalTitle')}>
      <p>{t('crm.quotes.proposalQuestion')}</p><div className="row-wrap">
        <button className="btn btn-primary" onClick={() => { setSuggestProposal(false); void props.onMoveStage('proposal'); }}>{t('crm.quotes.moveProposal')}</button>
        <button className="btn" onClick={() => setSuggestProposal(false)}>{t('crm.quotes.keepStage')}</button></div>
    </Dialog>
    <Dialog open={accepted !== null} onClose={() => setAccepted(null)} title={t('crm.quotes.acceptTitle')}>
      <p>{t('crm.quotes.acceptQuestion')}</p><div className="row-wrap">
        <button className="btn btn-primary" disabled={busy} onClick={() => {
          const quote = accepted; setAccepted(null); if (!quote) return;
          void run(async () => { await crmQuoteService.setStatus(props.companyId, quote.id, 'accepted'); await props.onMoveStage('won'); }, 'crm.quotes.acceptedAndWon');
        }}>{t('crm.quotes.acceptAndWon')}</button>
        <button className="btn" disabled={busy} onClick={() => {
          const quote = accepted; setAccepted(null); if (quote) void run(() => crmQuoteService.setStatus(props.companyId, quote.id, 'accepted'), 'crm.quotes.statusSaved');
        }}>{t('crm.quotes.acceptOnly')}</button></div>
    </Dialog>
  </div>;
}
