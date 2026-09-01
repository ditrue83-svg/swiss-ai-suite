import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import type {
  CrmFollowUpSequence, CrmOpportunityFollowUpStatus, CrmOpportunityStage,
} from '@/types/models';

type StepDraft = { silenceDays: number; taskTitle: string; emailTemplateId: string | null };

function fail(error: unknown): never {
  throw new AppError(toUserMessage(error), error);
}

export const crmFollowUpService = {
  async list(companyId: string): Promise<CrmFollowUpSequence[]> {
    const sb = requireSupabase() as any;
    const { data, error } = await sb.from('crm_follow_up_sequences')
      .select('id, company_id, name, stage, is_active, archived_at, '
        + 'crm_follow_up_steps(id, position, silence_days, task_title, email_template_id, '
        + 'crm_email_templates(name))')
      .eq('company_id', companyId).is('archived_at', null).order('stage');
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, any>>).map((row) => ({
      id: row.id,
      companyId: row.company_id,
      name: row.name,
      stage: row.stage,
      isActive: row.is_active,
      archivedAt: row.archived_at,
      steps: ((row.crm_follow_up_steps ?? []) as Array<Record<string, any>>)
        .sort((a, b) => a.position - b.position)
        .map((step) => ({
          id: step.id,
          position: step.position,
          silenceDays: step.silence_days,
          taskTitle: step.task_title,
          emailTemplateId: step.email_template_id,
          emailTemplateName: step.crm_email_templates?.name ?? null,
        })),
    }));
  },

  async templates(companyId: string): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await requireSupabase().from('crm_email_templates')
      .select('id, name').eq('company_id', companyId).is('archived_at', null).order('name');
    if (error) fail(error);
    return (data ?? []) as Array<{ id: string; name: string }>;
  },

  async save(input: {
    companyId: string;
    sequenceId: string | null;
    name: string;
    stage: CrmOpportunityStage;
    isActive: boolean;
    steps: StepDraft[];
  }): Promise<string> {
    const sb = requireSupabase() as any;
    const { data, error } = await sb.rpc('crm_save_follow_up_sequence', {
      p_company_id: input.companyId,
      p_sequence_id: input.sequenceId,
      p_name: input.name,
      p_stage: input.stage,
      p_is_active: input.isActive,
      p_steps: input.steps,
    });
    if (error) fail(error);
    return data as string;
  },

  async archive(companyId: string, sequenceId: string): Promise<void> {
    const sb = requireSupabase() as any;
    const { error } = await sb.rpc('crm_archive_follow_up_sequence', {
      p_company_id: companyId, p_sequence_id: sequenceId,
    });
    if (error) fail(error);
  },

  async status(companyId: string, opportunityId: string): Promise<CrmOpportunityFollowUpStatus | null> {
    const sb = requireSupabase() as any;
    const { data, error } = await sb.rpc('crm_opportunity_follow_up_status', {
      p_company_id: companyId, p_opportunity_id: opportunityId,
    });
    if (error) fail(error);
    const row = (data ?? [])[0] as Record<string, any> | undefined;
    if (!row) return null;
    return {
      sequenceId: row.sequence_id,
      sequenceName: row.sequence_name,
      sequenceActive: row.sequence_active,
      stepId: row.step_id,
      stepPosition: row.step_position,
      silenceDays: row.silence_days,
      taskTitle: row.task_title,
      emailTemplateId: row.email_template_id,
      emailTemplateName: row.email_template_name,
      dueAt: row.due_at,
      outboundAt: row.outbound_at,
      state: row.state,
    };
  },
};
