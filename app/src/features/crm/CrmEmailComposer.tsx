import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/forms';
import { requireSupabase } from '@/lib/supabase';
import { crmService } from '@/services/crmService';
import { useT } from '@/i18n';

type Recipient = { id: string; label: string };

export function CrmEmailComposer({ companyId, organizationId, opportunityId, onSent }: {
  companyId: string; organizationId: string; opportunityId?: string | null; onSent: () => void;
}) {
  const t = useT(); const [open, setOpen] = useState(false); const [to, setTo] = useState('');
  const [subject, setSubject] = useState(''); const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (!open) return; void crmService.people(companyId, organizationId).then((people) => {
    const values = people.flatMap((p) => p.methods.filter((m) => m.type === 'email').map((m) => ({ id: m.id, label: `${p.contact.displayName} · ${m.value}` })));
    setRecipients(values); setTo(values[0]?.id ?? '');
  }); }, [open, companyId, organizationId]);
  const disabled = !to || !subject.trim() || !body.trim() || busy;
  async function submit(e: React.FormEvent) { e.preventDefault(); if (disabled) return; setBusy(true); setError('');
    const { data, error: invokeError } = await requireSupabase().functions.invoke<{ status?: string; reason?: string }>('send-crm-email', { body: { companyId, organizationId, opportunityId: opportunityId ?? null, recipientMethodId: to, subject, bodyText: body, idempotencyKey: crypto.randomUUID() } });
    setBusy(false); if (invokeError || data?.status === 'failed') { setError(data?.reason ?? t('crm.email.sendFailed')); return; }
    setOpen(false); setSubject(''); setBody(''); onSent();
  }
  return <><button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>{t('crm.email.compose')}</button>
    <Dialog open={open} onClose={() => !busy && setOpen(false)} title={t('crm.email.compose')}>
      <form onSubmit={submit}>
        <Select id="crm-email-to" label={t('crm.email.to')} value={to} onChange={(e) => setTo(e.target.value)} disabled={busy}>
          {recipients.length ? recipients.map((r) => <option key={r.id} value={r.id}>{r.label}</option>) : <option value="">{t('crm.email.noRecipient')}</option>}
        </Select>
        <Input id="crm-email-subject" label={t('crm.email.subject')} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} disabled={busy} />
        <Textarea id="crm-email-body" label={t('crm.email.body')} value={body} maxLength={20000} rows={8} onChange={(e) => setBody(e.target.value)} disabled={busy} error={error || undefined} />
        <div className="row-wrap"><button className="btn btn-primary" disabled={disabled}>{t('crm.email.send')}</button><button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>{t('crm.form.cancel')}</button></div>
      </form>
    </Dialog></>;
}
