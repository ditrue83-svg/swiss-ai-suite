import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Input, Textarea } from '@/components/ui/forms';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n, useT } from '@/i18n';
import { requireSupabase } from '@/lib/supabase';

type Template = { id: string; name: string; archived_at: string | null; subject: string; body_text: string };

/** Impostazioni locali al CRM: i template sono dell'azienda, la firma è dell'utente. */
export function CrmEmailSettingsPanel() {
  const t = useT(); const { locale } = useI18n(); const { activeCompanyId, isAdmin } = useCompany(); const { user } = useAuth();
  const userId = user?.id;
  const settingsLoadFailed = t('crm.email.settingsLoadFailed');
  const [templates, setTemplates] = useState<Template[]>([]); const [signature, setSignature] = useState('');
  const [senderName, setSenderName] = useState(''); const [senderAddress, setSenderAddress] = useState('');
  const [name, setName] = useState(''); const [subject, setSubject] = useState(''); const [body, setBody] = useState('');
  const [editing, setEditing] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!activeCompanyId || !userId) return;
    const sb = requireSupabase() as any;
    const [{ data: raw, error: templatesError }, { data: sig, error: signatureError }, { data: sender, error: senderError }] = await Promise.all([
      sb.from('crm_email_templates').select('id, name, archived_at, crm_email_template_translations!inner(subject, body_text, locale)').eq('company_id', activeCompanyId).eq('crm_email_template_translations.locale', locale).order('created_at', { ascending: false }),
      sb.from('crm_user_email_signatures').select('body_text').eq('company_id', activeCompanyId).eq('user_id', userId).eq('locale', locale).maybeSingle(),
      sb.from('crm_email_senders').select('display_name, from_address').eq('company_id', activeCompanyId).maybeSingle(),
    ]);
    if (templatesError || signatureError || senderError) { setError(settingsLoadFailed); return; }
    setTemplates(((raw ?? []) as Array<Record<string, unknown>>).map((row) => {
      const translation = (row.crm_email_template_translations as Array<Record<string, unknown>>)[0]!;
      return { id: row.id as string, name: row.name as string, archived_at: row.archived_at as string | null, subject: translation.subject as string, body_text: translation.body_text as string };
    }));
    setSignature((sig?.body_text as string | null) ?? ''); setError('');
    setSenderName((sender?.display_name as string | null) ?? ''); setSenderAddress((sender?.from_address as string | null) ?? '');
  }, [activeCompanyId, locale, settingsLoadFailed, userId]);
  useEffect(() => { void load(); }, [load]);

  async function saveSignature(event: FormEvent) { event.preventDefault(); if (!activeCompanyId || !user || busy) return; setBusy(true); setError('');
    const { error: saveError } = await (requireSupabase() as any).from('crm_user_email_signatures').upsert({ company_id: activeCompanyId, user_id: user.id, locale, body_text: signature }, { onConflict: 'company_id,user_id,locale' });
    setBusy(false); if (saveError) setError(t('crm.email.settingsSaveFailed'));
  }
  async function saveSender(event: FormEvent) { event.preventDefault(); if (!activeCompanyId || !user || !isAdmin || busy || !senderName.trim() || !senderAddress.trim()) return; setBusy(true); setError('');
    const { error: saveError } = await (requireSupabase() as any).from('crm_email_senders').upsert({ company_id: activeCompanyId, display_name: senderName.trim(), from_address: senderAddress.trim().toLowerCase(), updated_by: user.id }, { onConflict: 'company_id' });
    setBusy(false); if (saveError) setError(t('crm.email.settingsSaveFailed'));
  }
  async function saveTemplate(event: FormEvent) { event.preventDefault(); if (!activeCompanyId || !user || !isAdmin || busy || !name.trim() || !subject.trim() || !body.trim()) return; setBusy(true); setError(''); const sb = requireSupabase() as any;
    if (editing) {
      const { error: updateError } = await sb.from('crm_email_templates').update({ name: name.trim() }).eq('id', editing).eq('company_id', activeCompanyId);
      const { error: translationError } = await sb.from('crm_email_template_translations').update({ subject: subject.trim(), body_text: body.trim() }).eq('template_id', editing).eq('company_id', activeCompanyId).eq('locale', locale);
      if (updateError || translationError) setError(t('crm.email.settingsSaveFailed'));
    } else {
      const { data: created, error: createError } = await sb.from('crm_email_templates').insert({ company_id: activeCompanyId, name: name.trim(), created_by: user.id }).select('id').single();
      if (createError || !created) setError(t('crm.email.settingsSaveFailed'));
      else { const { error: translationError } = await sb.from('crm_email_template_translations').insert({ company_id: activeCompanyId, template_id: created.id, locale, subject: subject.trim(), body_text: body.trim() }); if (translationError) setError(t('crm.email.settingsSaveFailed')); }
    }
    setBusy(false); if (!error) { setEditing(null); setName(''); setSubject(''); setBody(''); await load(); }
  }
  function edit(template: Template) { setEditing(template.id); setName(template.name); setSubject(template.subject); setBody(template.body_text); }
  async function archive(id: string) { if (!activeCompanyId || !isAdmin) return; const { error: archiveError } = await (requireSupabase() as any).from('crm_email_templates').update({ archived_at: new Date().toISOString(), archived_by: user?.id ?? null }).eq('id', id).eq('company_id', activeCompanyId); if (archiveError) setError(t('crm.email.settingsSaveFailed')); else await load(); }

  if (!activeCompanyId || !user) return null;
  return <div><div className="page-head"><div className="page-desc">{t('crm.email.settingsHint')}</div></div>
    {isAdmin && <form onSubmit={saveSender} className="card"><Input id="crm-email-sender-name" label={t('crm.email.senderName')} value={senderName} onChange={(e) => setSenderName(e.target.value)} disabled={busy} /><Input id="crm-email-sender-address" label={t('crm.email.senderAddress')} type="email" value={senderAddress} onChange={(e) => setSenderAddress(e.target.value)} disabled={busy} hint={t('crm.email.senderHint')} /><button className="btn btn-primary" disabled={busy}>{t('crm.email.save')}</button></form>}
    <form onSubmit={saveSignature} className="card"><Textarea id="crm-email-signature" label={t('crm.email.signature')} value={signature} rows={5} onChange={(e) => setSignature(e.target.value)} disabled={busy} hint={t('crm.email.signatureHint')} /><button className="btn btn-primary" disabled={busy}>{t('crm.email.save')}</button></form>
    <section className="card mt-6"><div className="card-title">{t('crm.email.templates')}</div>{!isAdmin && <p className="muted-sm">{t('crm.email.templatesReadOnly')}</p>}
      {templates.filter((x) => !x.archived_at).map((template) => <div className="list-row" key={template.id}><div className="list-main"><span className="list-title">{template.name}</span><div className="list-sub">{template.subject}</div></div>{isAdmin && <div className="row-wrap"><button type="button" className="btn btn-sm" onClick={() => edit(template)}>{t('crm.email.edit')}</button><button type="button" className="btn btn-sm" onClick={() => void archive(template.id)}>{t('crm.email.archive')}</button></div>}</div>)}
      {isAdmin && <form onSubmit={saveTemplate} className="mt-6"><Input id="crm-email-template-name" label={t('crm.email.templateName')} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={busy} /><Input id="crm-email-template-subject" label={t('crm.email.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} disabled={busy} /><Textarea id="crm-email-template-body" label={t('crm.email.body')} value={body} onChange={(e) => setBody(e.target.value)} rows={7} disabled={busy} /><button className="btn btn-primary" disabled={busy}>{editing ? t('crm.email.updateTemplate') : t('crm.email.createTemplate')}</button></form>}
    </section>{error && <p className="field-error" role="alert">{error}</p>}</div>;
}
