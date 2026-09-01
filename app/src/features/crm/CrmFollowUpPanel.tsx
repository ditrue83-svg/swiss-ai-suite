import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Checkbox, Input, Select } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { useCompany } from '@/contexts/CompanyContext';
import { useLabels } from '@/i18n/labels';
import { useT } from '@/i18n';
import { crmFollowUpService } from '@/services/crmFollowUpService';
import type { CrmFollowUpSequence, CrmOpportunityStage } from '@/types/models';
import type { Sede } from '@/components/layout/nav';

const OPEN_STAGES: CrmOpportunityStage[] = ['lead', 'contacted', 'proposal', 'negotiation'];
type DraftStep = { silenceDays: number; taskTitle: string; emailTemplateId: string };
const emptyStep = (days = 3): DraftStep => ({ silenceDays: days, taskTitle: '', emailTemplateId: '' });

export function CrmFollowUpPage() { return <CrmFollowUpPanel sede="pagina" />; }

export function CrmFollowUpPanel({ sede = 'pagina' }: { sede?: Sede }) {
  const t = useT(); const L = useLabels();
  const { activeCompanyId, isAdmin } = useCompany();
  const [sequences, setSequences] = useState<CrmFollowUpSequence[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [stage, setStage] = useState<CrmOpportunityStage>('contacted');
  const [active, setActive] = useState(true);
  const [steps, setSteps] = useState<DraftStep[]>([emptyStep()]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const [seq, tpl] = await Promise.all([
        crmFollowUpService.list(activeCompanyId), crmFollowUpService.templates(activeCompanyId),
      ]);
      setSequences(seq); setTemplates(tpl); setError('');
    } catch { setError(t('crmFollowUp.loadFailed')); }
  }, [activeCompanyId, t]);
  useEffect(() => { void load(); }, [load]);

  function reset() {
    setEditing(null); setName(''); setStage('contacted'); setActive(true);
    setSteps([emptyStep()]); setError('');
  }
  function edit(sequence: CrmFollowUpSequence) {
    setEditing(sequence.id); setName(sequence.name); setStage(sequence.stage);
    setActive(sequence.isActive);
    setSteps(sequence.steps.map((step) => ({
      silenceDays: step.silenceDays, taskTitle: step.taskTitle,
      emailTemplateId: step.emailTemplateId ?? '',
    })));
  }
  function updateStep(index: number, patch: Partial<DraftStep>) {
    setSteps((current) => current.map((step, i) => i === index ? { ...step, ...patch } : step));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!activeCompanyId || !isAdmin || busy) return;
    const valid = name.trim() && steps.length > 0 && steps.every((step, index) =>
      step.taskTitle.trim() && Number.isInteger(step.silenceDays) && step.silenceDays > 0
      && (index === 0 || step.silenceDays > steps[index - 1]!.silenceDays));
    if (!valid) { setError(t('crmFollowUp.invalid')); return; }
    setBusy(true); setError('');
    try {
      await crmFollowUpService.save({
        companyId: activeCompanyId, sequenceId: editing, name: name.trim(), stage,
        isActive: active,
        steps: steps.map((step) => ({ ...step, taskTitle: step.taskTitle.trim(),
          emailTemplateId: step.emailTemplateId || null })),
      });
      reset(); await load();
    } catch { setError(t('crmFollowUp.saveFailed')); }
    finally { setBusy(false); }
  }
  async function archive(id: string) {
    if (!activeCompanyId || !isAdmin || busy) return;
    setBusy(true);
    try { await crmFollowUpService.archive(activeCompanyId, id); await load(); }
    catch { setError(t('crmFollowUp.saveFailed')); }
    finally { setBusy(false); }
  }

  if (!activeCompanyId) return null;
  return <div>
    {sede === 'pagina' && <div className="page-head"><div><div className="page-title">{t('crmFollowUp.title')}</div><div className="page-desc">{t('crmFollowUp.hint')}</div></div></div>}
    {sede === 'pannello' && <p className="page-desc">{t('crmFollowUp.hint')}</p>}
    <p className="muted-sm">{t('crmFollowUp.noAutoEmail')}</p>
    {!isAdmin && <p className="muted-sm">{t('crmFollowUp.readOnly')}</p>}
    {sequences.map((sequence) => <section className="card mt-6" key={sequence.id}>
      <div className="row-wrap"><div><strong>{sequence.name}</strong>{' '}<Tag>{L.crmStage(sequence.stage)}</Tag>{' '}<Tag tone={sequence.isActive ? 'ok' : 'neutral'}>{t(sequence.isActive ? 'crmFollowUp.active' : 'crmFollowUp.paused')}</Tag></div>
      {isAdmin && <div className="row-wrap"><button type="button" className="btn btn-sm" disabled={busy} onClick={() => edit(sequence)}>{t('common.edit')}</button><button type="button" className="btn btn-sm" disabled={busy} onClick={() => void archive(sequence.id)}>{t('crm.email.archive')}</button></div>}</div>
      <ol>{sequence.steps.map((step) => <li key={step.id}>{t('crmFollowUp.afterDays', { days: step.silenceDays })}: {step.taskTitle}{step.emailTemplateName ? ` · ${t('crmFollowUp.template')}: ${step.emailTemplateName}` : ''}</li>)}</ol>
    </section>)}
    {isAdmin && <form className="card mt-6" onSubmit={submit}>
      <div className="card-title">{t(editing ? 'crmFollowUp.editTitle' : 'crmFollowUp.addTitle')}</div>
      <Input id="fu-name" label={t('crmFollowUp.name')} value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} />
      <Select id="fu-stage" label={t('crmFollowUp.stage')} value={stage} disabled={busy} onChange={(e) => setStage(e.target.value as CrmOpportunityStage)}>{OPEN_STAGES.map((value) => <option key={value} value={value}>{L.crmStage(value)}</option>)}</Select>
      <Checkbox id="fu-active" label={t('crmFollowUp.enabled')} checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} />
      {steps.map((step, index) => <div className="card mt-6" key={index}>
        <div className="row-wrap"><strong>{t('crmFollowUp.step', { number: index + 1 })}</strong>{steps.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}><Icon name="trash" className="ic-sm" /> {t('common.delete')}</button>}</div>
        <Input id={`fu-days-${index}`} type="number" min={1} max={365} label={t('crmFollowUp.silenceDays')} value={String(step.silenceDays)} disabled={busy} onChange={(e) => updateStep(index, { silenceDays: Number(e.target.value) })} />
        <Input id={`fu-task-${index}`} label={t('crmFollowUp.taskTitle')} value={step.taskTitle} maxLength={200} disabled={busy} onChange={(e) => updateStep(index, { taskTitle: e.target.value })} />
        <Select id={`fu-template-${index}`} label={t('crmFollowUp.template')} value={step.emailTemplateId} disabled={busy} onChange={(e) => updateStep(index, { emailTemplateId: e.target.value })}><option value="">{t('crmFollowUp.noTemplate')}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</Select>
      </div>)}
      {steps.length < 10 && <button type="button" className="btn mt-6" onClick={() => setSteps((current) => [...current, emptyStep((current.at(-1)?.silenceDays ?? 0) + 3)])}>{t('crmFollowUp.addStep')}</button>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="row-wrap mt-8"><button className="btn btn-primary" disabled={busy}>{t('common.save')}</button>{editing && <button type="button" className="btn" disabled={busy} onClick={reset}>{t('common.cancel')}</button>}</div>
    </form>}
  </div>;
}
