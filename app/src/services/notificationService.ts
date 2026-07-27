// ============================================================================
// notificationService — la campanella e le preferenze.
//
// LETTURA dal database (RLS: `user_id = auth.uid()`, quindi due colleghi della
// stessa azienda non si leggono le notifiche a vicenda). SCRITTURA solo per le
// PROPRIE preferenze; le notifiche il client non le tocca — «segna come letta»
// passa da una funzione, e nessun `update` su quella tabella è concesso.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import type { AppNotification, NotificationPreferences } from '@/types/models';
import type { Database } from '@/types/database';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];
type PreferencesRow = Database['public']['Tables']['notification_preferences']['Row'];

// I default vivono in un modulo senza dipendenze, così i test offline possono
// verificare che coincidano con quelli della migrazione: questo file importa il
// client Supabase, che fuori dal browser non esiste.
export { DEFAULT_TIMEZONE, TIMEZONE_CHOICES, defaultPreferences } from '@/features/calendar/preferencesDefaults';

function toNotification(row: NotificationRow): AppNotification {
  const payload = (row.payload ?? {}) as AppNotification['payload'];
  return {
    id: row.id,
    companyId: row.company_id,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: typeof payload === 'object' && payload !== null ? payload : {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function toPreferences(row: PreferencesRow): NotificationPreferences {
  return {
    companyId: row.company_id,
    userId: row.user_id,
    inAppEnabled: row.in_app_enabled,
    emailEnabled: row.email_enabled,
    remind7Days: row.remind_7_days,
    remind1Day: row.remind_1_day,
    remindDueDay: row.remind_due_day,
    remindOverdue: row.remind_overdue,
    timezone: row.timezone,
    locale: row.locale,
    showTaskTitle: row.show_task_title,
  };
}

export const notificationService = {
  /** Le mie notifiche per l'azienda attiva, dalla più recente. */
  async list(companyId: string, limit = 30): Promise<AppNotification[]> {
    const { data, error } = await requireSupabase()
      .from('notifications')
      .select('id, company_id, user_id, type, entity_type, entity_id, payload, dedupe_key, read_at, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new AppError(toUserMessage(error), error);
    return ((data ?? []) as unknown as NotificationRow[]).map(toNotification);
  },

  /** Il numero del badge. Conteggio nel database: non è la lunghezza di un elenco troncato. */
  async unreadCount(companyId: string): Promise<number> {
    const { data, error } = await requireSupabase().rpc('notifications_unread_count', {
      p_company_id: companyId,
    });
    if (error) throw new AppError(toUserMessage(error), error);
    return typeof data === 'number' ? data : 0;
  },

  async markRead(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const { data, error } = await requireSupabase().rpc('notifications_mark_read', { p_ids: ids });
    if (error) throw new AppError(toUserMessage(error), error);
    return typeof data === 'number' ? data : 0;
  },

  async markAllRead(companyId: string): Promise<number> {
    const { data, error } = await requireSupabase().rpc('notifications_mark_all_read', {
      p_company_id: companyId,
    });
    if (error) throw new AppError(toUserMessage(error), error);
    return typeof data === 'number' ? data : 0;
  },

  /** Le preferenze salvate, oppure `null` se non è mai stata scritta una riga. */
  async preferences(companyId: string): Promise<NotificationPreferences | null> {
    const { data, error } = await requireSupabase()
      .from('notification_preferences')
      .select('company_id, user_id, in_app_enabled, email_enabled, remind_7_days, remind_1_day, remind_due_day, remind_overdue, timezone, locale, show_task_title, created_at, updated_at')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    return data ? toPreferences(data as unknown as PreferencesRow) : null;
  },

  /**
   * Salva le proprie preferenze.
   *
   * `userId` viaggia nella riga perché fa parte della chiave primaria, ma non è
   * il client a deciderlo: la policy e il trigger della 0018 RIFIUTANO una riga
   * con un `user_id` diverso da `auth.uid()` — non la correggono in silenzio.
   */
  async savePreferences(input: NotificationPreferences): Promise<NotificationPreferences> {
    const { data, error } = await requireSupabase()
      .from('notification_preferences')
      .upsert({
        company_id: input.companyId,
        user_id: input.userId,
        in_app_enabled: input.inAppEnabled,
        email_enabled: input.emailEnabled,
        remind_7_days: input.remind7Days,
        remind_1_day: input.remind1Day,
        remind_due_day: input.remindDueDay,
        remind_overdue: input.remindOverdue,
        timezone: input.timezone,
        locale: input.locale,
        show_task_title: input.showTaskTitle,
      }, { onConflict: 'company_id,user_id' })
      .select('company_id, user_id, in_app_enabled, email_enabled, remind_7_days, remind_1_day, remind_due_day, remind_overdue, timezone, locale, show_task_title, created_at, updated_at')
      .single();
    if (error || !data) throw new AppError(preferencesErrorMessage(error), error);
    return toPreferences(data as unknown as PreferencesRow);
  },
};

/**
 * Messaggi per i guasti che questo dominio produce davvero. Un `23514` con
 * dentro `invalid_timezone` non è un errore di sistema: è un fuso che il
 * database non conosce, e va detto così.
 */
export function preferencesErrorMessage(error: unknown): string {
  const raw = error as { message?: string; hint?: string } | null;
  const text = `${raw?.message ?? ''} ${raw?.hint ?? ''}`;
  if (text.includes('invalid_timezone')) return tr('calendar.errors.invalidTimezone');
  if (text.includes('preferences_not_own')) return tr('calendar.errors.notOwnPreferences');
  return toUserMessage(error);
}
