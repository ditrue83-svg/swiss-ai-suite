import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/forms';
import { requireSupabase } from '@/lib/supabase';
import { crmService } from '@/services/crmService';
import { useT } from '@/i18n';
import { useI18n } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';

type Recipient = { id: string; label: string };
type Attachment = { id: string; label: string };
type Template = { id: string; name: string; subject: string; body: string };

export function CrmEmailComposer({ companyId, organizationId, opportunityId, suggestedTemplateId, onSent }: {
  companyId: string; organizationId: string; opportunityId?: string | null;
  suggestedTemplateId?: string | null; onSent: () => void;
}) {
  const t = useT(); const { locale } = useI18n(); const { user } = useAuth(); const [open, setOpen] = useState(false); const [to, setTo] = useState('');
  const [subject, setSubject] = useState(''); const [body, setBody] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]); const [attachments, setAttachments] = useState<Attachment[]>([]); const [templates, setTemplates] = useState<Template[]>([]); const [documentIds, setDocumentIds] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (!open) return; void Promise.all([crmService.people(companyId, organizationId), crmService.linkedDocuments(companyId, organizationId), requireSupabase().from('crm_email_templates').select('id, name, crm_email_template_translations!inner(subject, body_text, locale)').eq('company_id', companyId).is('archived_at', null).eq('crm_email_template_translations.locale', locale), user ? requireSupabase().from('crm_user_email_signatures').select('body_text').eq('company_id', companyId).eq('user_id', user.id).eq('locale', locale).maybeSingle() : Promise.resolve({ data: null, error: null })]).then(([people, documents, templateResult, signatureResult]) => {
    const values = people.flatMap((p) => p.methods.filter((m) => m.type === 'email').map((m) => ({ id: m.id, label: `${p.contact.displayName} · ${m.value}` })));
    setRecipients(values); setTo(values[0]?.id ?? ''); setAttachments(documents.map((d) => ({ id: d.documentId, label: d.title ?? (typeof d.label === 'string' ? d.label : Object.values(d.label).filter((value) => typeof value === 'string').join(' · ')) })));
    const loadedTemplates = ((templateResult.data ?? []) as Array<Record<string, unknown>>).map((row) => { const translation = (row.crm_email_template_translations as Array<Record<string, unknown>>)[0]!; return { id: row.id as string, name: row.name as string, subject: translation.subject as string, body: translation.body_text as string }; });
    setTemplates(loadedTemplates);
    const suggested = loadedTemplates.find((template) => template.id === suggestedTemplateId);
    if (suggested) { setSelectedTemplate(suggested.id); setSubject(suggested.subject); setBody(suggested.body); }
    const signature = (signatureResult.data as { body_text?: string } | null)?.body_text; if (signature) setBody((previous) => previous || `\n\n${signature}`);
  }); }, [open, companyId, organizationId, locale, user, suggestedTemplateId]);
  const disabled = !to || !subject.trim() || !body.trim() || busy;
  async function submit(e: React.FormEvent) { e.preventDefault(); if (disabled) return; setBusy(true); setError('');
    const { data, error: invokeError } = await requireSupabase().functions.invoke<{ status?: string; reason?: string; code?: string }>('send-crm-email', { body: { companyId, organizationId, opportunityId: opportunityId ?? null, recipientMethodId: to, subject, bodyText: body, documentIds, idempotencyKey: crypto.randomUUID() } });
    // ⚠️ SU UN 4xx `data` È NULL: il codice dell'errore sta nel CORPO della
    // risposta, che supabase-js consegna in `error.context` (una Response). I
    // rami che lo leggevano da `data?.code` erano raggiungibili solo su un 200
    // con esito fallito, e EMAIL_NOT_CONFIGURED / QUOTE_PDF_STALE / INVOICE_PDF_STALE
    // arrivano invece con uno stato di errore: qui il codice si legge dal
    // contesto, come già in calendarConnectionService.
    let code = data?.code ?? null;
    if (invokeError && !code) {
      const context = (invokeError as { context?: Response } | null)?.context;
      if (context && typeof context.json === 'function') {
        code = await context.json().then((payload: { code?: string }) => payload?.code ?? null).catch(() => null);
      }
    }
    setBusy(false); if (invokeError || data?.status === 'failed' || code) {
      setError(code === 'EMAIL_NOT_CONFIGURED' ? t('crm.email.unavailable')
        : code === 'QUOTE_PDF_STALE' ? t('crm.email.quoteStale')
        : code === 'INVOICE_PDF_STALE' ? t('crm.email.invoiceStale')
        : t('crm.email.sendFailed')); return;
    }
    setOpen(false); setSubject(''); setBody(''); setSelectedTemplate(''); setDocumentIds([]); onSent();
  }
  return <><button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>{t('crm.email.compose')}</button>
    <Dialog open={open} onClose={() => !busy && setOpen(false)} title={t('crm.email.compose')}>
      <form onSubmit={submit}>
        <Select id="crm-email-to" label={t('crm.email.to')} value={to} onChange={(e) => setTo(e.target.value)} disabled={busy}>
          {recipients.length ? recipients.map((r) => <option key={r.id} value={r.id}>{r.label}</option>) : <option value="">{t('crm.email.noRecipient')}</option>}
        </Select>
        {templates.length > 0 && <Select id="crm-email-template" label={t('crm.email.template')} value={selectedTemplate} onChange={(e) => { setSelectedTemplate(e.target.value); const template = templates.find((candidate) => candidate.id === e.target.value); if (template) { setSubject(template.subject); setBody(template.body); } }} disabled={busy}><option value="">{t('crm.email.noTemplate')}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</Select>}
        <Input id="crm-email-subject" label={t('crm.email.subject')} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
        <Textarea id="crm-email-body" label={t('crm.email.body')} value={body} maxLength={20000} rows={8} onChange={(e) => setBody(e.target.value)} disabled={busy} error={error || undefined} />
        {attachments.length > 0 && <Select id="crm-email-attachments" label={t('crm.email.attachments')} multiple value={documentIds} onChange={(e) => setDocumentIds([...e.currentTarget.selectedOptions].map((o) => o.value))} disabled={busy} hint={t('crm.email.attachmentsHint')}>
          {attachments.map((attachment) => <option key={attachment.id} value={attachment.id}>{attachment.label}</option>)}
        </Select>}
        <div className="row-wrap"><button className="btn btn-primary" disabled={disabled}>{t('crm.email.send')}</button><button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>{t('crm.form.cancel')}</button></div>
      </form>
    </Dialog></>;
}
