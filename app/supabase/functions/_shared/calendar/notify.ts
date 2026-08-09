// ============================================================================
// Il motore delle notifiche: quali promemoria sono dovuti e come si consegnano.
//
// DUE PASSI SEPARATI, e la separazione è il punto:
//   1. GENERARE — decidere che una notifica è dovuta e scriverla. È un fatto,
//      e una volta scritto non si ripete: lo impedisce un vincolo del database,
//      non un controllo in questo file.
//   2. CONSEGNARE — provare a mandarla su un canale esterno. È un tentativo,
//      può fallire, si ritenta.
// Se fossero un passo solo, un guasto del provider di posta impedirebbe anche
// alla notifica in-app di esistere — cioè un canale accessorio potrebbe far
// perdere quello principale. §144 lo dice in una riga: «Se email notification
// fallisce: la notification in-app rimane».
//
// ⚠️ UNA CONSEGUENZA DEL MODELLO, DICHIARATA E NON NASCOSTA
// La consegna email è appesa alla notifica. Quindi spegnere le notifiche
// dentro AI-Swisse spegne ANCHE le email: l'email è una copia di ciò che la
// campanella mostra, non un canale indipendente. La schermata delle
// impostazioni lo scrive, invece di lasciare due interruttori che sembrano
// indipendenti e non lo sono.
// ============================================================================
import {
  DEFAULT_TIMEZONE, EMAIL_MAX_ATTEMPTS, emailBackoffSeconds,
  UNASSIGNED_ALERT_PRIORITY, type NotificationType,
} from './contract.ts';
import { dueReminders, reminderWindow, unassignedAlert, type ReminderPreferences } from './reminders.ts';
import { formatDay, st, type ServerLocale } from './i18n.ts';
import { buildReminderEmail, type NotificationEmailProvider } from './email.ts';
import { CalendarProviderError } from './types.ts';
import {
  defaultPreferences, enqueueEmailDelivery, insertNotification, preferencesFor,
  type PreferencesRow, type ServerClient,
} from './store.ts';

export interface NotifyDeps {
  sb: ServerClient;
  appOrigin: string;
  /** `null` quando nessun provider è configurato: le email semplicemente non partono (§79). */
  emailProvider: NotificationEmailProvider | null;
}

export interface GenerateReport {
  tasksScanned: number;
  created: number;
  emailsQueued: number;
  unassignedAlerts: number;
  skippedNoTimezone: number;
}

interface ReminderTaskRow {
  id: string;
  company_id: string;
  title: string;
  due_date: string;
  priority: 'low' | 'medium' | 'high';
  assignee_user_id: string | null;
}

const asReminderPrefs = (p: PreferencesRow): ReminderPreferences => ({
  remind7Days: p.remind_7_days,
  remind1Day: p.remind_1_day,
  remindDueDay: p.remind_due_day,
  remindOverdue: p.remind_overdue,
  timezone: p.timezone || DEFAULT_TIMEZONE,
});

/**
 * Genera i promemoria dovuti adesso.
 *
 * La query è UNA per tutte le aziende, con una finestra larga un giorno per
 * lato: la decisione fine — «per questa persona, in questo fuso, alle otto del
 * mattino» — la prende `dueReminders`, che è pura e ha i propri test. Qui si
 * fa solo la parte che ha bisogno del database.
 */
export async function generateReminders(
  deps: NotifyDeps, now: Date, deadlineMs: number, maxTasks = 2000,
): Promise<GenerateReport> {
  const report: GenerateReport = {
    tasksScanned: 0, created: 0, emailsQueued: 0, unassignedAlerts: 0, skippedNoTimezone: 0,
  };
  const window = reminderWindow(now);

  const { data } = await deps.sb.from('tasks')
    .select('id, company_id, title, due_date, priority, assignee_user_id')
    .neq('status', 'completed')
    .is('archived_at', null)
    .gte('due_date', window.from)
    .lte('due_date', window.to)
    .limit(maxTasks);

  const tasks = (data ?? []) as ReminderTaskRow[];
  report.tasksScanned = tasks.length;
  if (!tasks.length) return report;

  // Le preferenze si leggono per azienda, non per attività: dieci attività
  // della stessa persona non sono dieci letture.
  const byCompany = new Map<string, ReminderTaskRow[]>();
  for (const t of tasks) {
    const list = byCompany.get(t.company_id) ?? [];
    list.push(t);
    byCompany.set(t.company_id, list);
  }

  for (const [companyId, list] of byCompany) {
    if (Date.now() >= deadlineMs) break;

    const assignees = [...new Set(list.map((t) => t.assignee_user_id).filter(Boolean))] as string[];
    const hasUnassignedUrgent = list.some(
      (t) => !t.assignee_user_id && t.priority === UNASSIGNED_ALERT_PRIORITY,
    );
    const leaders = hasUnassignedUrgent ? await companyLeaders(deps.sb, companyId) : [];
    const prefs = await preferencesFor(deps.sb, companyId, [...new Set([...assignees, ...leaders])]);

    for (const task of list) {
      if (Date.now() >= deadlineMs) break;

      if (task.assignee_user_id) {
        const p = prefs.get(task.assignee_user_id) ?? defaultPreferences(companyId, task.assignee_user_id);
        // Spento del tutto: nessun canale, nessuna notifica. Vedi il commento
        // in cima al file — l'email è una copia dell'avviso in-app.
        if (!p.in_app_enabled) continue;

        let reminders;
        try {
          reminders = dueReminders({
            dueDate: task.due_date, prefs: asReminderPrefs(p), now, taskId: task.id,
          });
        } catch {
          // Fuso non utilizzabile: si salta questa persona e lo si conta. Non si
          // ripiega su un altro fuso — un promemoria all'ora sbagliata è peggio
          // di un promemoria mancante, perché sembra funzionare.
          report.skippedNoTimezone++;
          continue;
        }

        for (const r of reminders) {
          const created = await insertNotification(deps.sb, {
            companyId,
            userId: task.assignee_user_id,
            type: r.type,
            entityType: 'task',
            entityId: task.id,
            payload: { title: task.title, dueDate: task.due_date, priority: task.priority, kind: r.kind },
            dedupeKey: r.dedupeKey,
          });
          if (!created) continue;                     // esisteva già: è l'esito voluto
          report.created++;
          if (p.email_enabled && deps.emailProvider) {
            await enqueueEmailDelivery(deps.sb, created);
            report.emailsQueued++;
          }
        }
        continue;
      }

      // §32 — urgente e senza responsabile: lo sanno owner e amministratori.
      if (task.priority !== UNASSIGNED_ALERT_PRIORITY) continue;
      for (const leader of leaders) {
        const p = prefs.get(leader) ?? defaultPreferences(companyId, leader);
        if (!p.in_app_enabled) continue;

        let alert;
        try {
          alert = unassignedAlert({
            dueDate: task.due_date, priority: task.priority, now,
            timezone: p.timezone || DEFAULT_TIMEZONE, taskId: task.id,
          });
        } catch {
          report.skippedNoTimezone++;
          continue;
        }
        if (!alert) continue;

        const created = await insertNotification(deps.sb, {
          companyId, userId: leader, type: alert.type,
          entityType: 'task', entityId: task.id,
          payload: { title: task.title, dueDate: task.due_date, priority: task.priority, kind: alert.kind },
          dedupeKey: alert.dedupeKey,
        });
        if (!created) continue;
        report.created++;
        report.unassignedAlerts++;
        if (p.email_enabled && deps.emailProvider) {
          await enqueueEmailDelivery(deps.sb, created);
          report.emailsQueued++;
        }
      }
    }
  }

  return report;
}

/** Chi guida l'azienda: owner e amministratori. */
async function companyLeaders(sb: ServerClient, companyId: string): Promise<string[]> {
  const { data } = await sb.from('company_members')
    .select('user_id').eq('company_id', companyId).in('role', ['owner', 'admin']);
  return ((data ?? []) as { user_id: string }[]).map((m) => m.user_id);
}

// ---- Consegna ---------------------------------------------------------------

export interface DeliverReport {
  attempted: number;
  sent: number;
  retried: number;
  failed: number;
}

interface DeliveryRow {
  id: string;
  attempts: number;
  notification_id: string;
  notifications: {
    company_id: string; user_id: string; type: NotificationType;
    entity_type: string; entity_id: string; payload: Record<string, unknown>;
  } | null;
}

/**
 * Svuota la coda delle email.
 *
 * ⚠️ Il tentativo viene REGISTRATO PRIMA dell'invio, con la prossima attesa già
 * programmata. Sembra pessimismo ed è l'unica forma corretta: se l'isolate
 * venisse ucciso mentre la richiesta è in volo — i 150 secondi arrivano senza
 * preavviso — una riga lasciata `pending` verrebbe ripresa subito e il
 * messaggio partirebbe una seconda volta. Registrando prima, il peggio che può
 * succedere è un'email in meno, mai una in più. La chiave di idempotenza del
 * provider copre il caso simmetrico.
 */
export async function deliverEmails(
  deps: NotifyDeps, deadlineMs: number, batch = 25,
): Promise<DeliverReport> {
  const report: DeliverReport = { attempted: 0, sent: 0, retried: 0, failed: 0 };
  if (!deps.emailProvider) return report;

  const { data } = await deps.sb.from('notification_deliveries')
    .select('id, attempts, notification_id, notifications(company_id, user_id, type, entity_type, entity_id, payload)')
    .in('status', ['pending', 'sending'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(batch);

  for (const raw of (data ?? []) as DeliveryRow[]) {
    if (Date.now() >= deadlineMs) break;
    const notification = raw.notifications;
    if (!notification) {
      // La notifica non c'è più: la consegna non ha più un contenuto da
      // consegnare. Si chiude come annullata, non come fallita — non è andato
      // storto niente.
      await deps.sb.from('notification_deliveries')
        .update({ status: 'cancelled', error_code: 'NOTIFICATION_GONE' }).eq('id', raw.id);
      continue;
    }

    const attempts = raw.attempts + 1;
    const giveUp = attempts >= EMAIL_MAX_ATTEMPTS;

    // Prenotazione: se un'altra esecuzione l'ha già presa, `data` è vuoto e si
    // passa oltre invece di mandare la stessa email due volte.
    const { data: claimed } = await deps.sb.from('notification_deliveries').update({
      status: 'sending',
      attempts,
      next_attempt_at: new Date(Date.now() + emailBackoffSeconds(attempts) * 1000).toISOString(),
    }).eq('id', raw.id).in('status', ['pending', 'sending']).select('id');
    if (!Array.isArray(claimed) || !claimed.length) continue;

    report.attempted++;

    try {
      const message = await composeEmail(deps, notification);
      if (!message) {
        await deps.sb.from('notification_deliveries')
          .update({ status: 'cancelled', error_code: 'NO_RECIPIENT' }).eq('id', raw.id);
        continue;
      }
      const result = await deps.emailProvider.send({
        to: message.to,
        subject: message.subject,
        text: message.text,
        // L'identificativo della CONSEGNA, non della notifica: è ciò che il
        // provider deduplica quando la nostra richiesta si perde per strada.
        idempotencyKey: `delivery:${raw.id}`,
      });
      await deps.sb.from('notification_deliveries').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: result.providerMessageId,
        error_code: null,
      }).eq('id', raw.id);
      report.sent++;
    } catch (error) {
      const err = error instanceof CalendarProviderError
        ? error
        : new CalendarProviderError('UNKNOWN', 'invio fallito');
      // Un errore permanente — indirizzo rifiutato, dominio non verificato,
      // chiave revocata — non migliora riprovando: si chiude subito, invece di
      // occupare la coda per giorni.
      const permanent = !err.retryable || giveUp;
      await deps.sb.from('notification_deliveries').update({
        status: permanent ? 'failed' : 'pending',
        error_code: err.code,
      }).eq('id', raw.id);
      if (permanent) report.failed++; else report.retried++;
    }
  }

  return report;
}

/** Da notifica a messaggio. Restituisce `null` se non c'è un indirizzo a cui scrivere. */
async function composeEmail(
  deps: NotifyDeps,
  n: NonNullable<DeliveryRow['notifications']>,
): Promise<{ to: string; subject: string; text: string } | null> {
  const [{ data: profile }, { data: company }, prefs] = await Promise.all([
    deps.sb.from('profiles').select('email').eq('id', n.user_id).maybeSingle(),
    deps.sb.from('companies').select('legal_name').eq('id', n.company_id).maybeSingle(),
    preferencesFor(deps.sb, n.company_id, [n.user_id]),
  ]);

  const to = (profile as { email?: string | null } | null)?.email ?? null;
  if (!to) return null;

  const companyName = (company as { legal_name?: string } | null)?.legal_name ?? '';
  const p = prefs.get(n.user_id) ?? defaultPreferences(n.company_id, n.user_id);
  const locale: ServerLocale = p.locale;

  const title = typeof n.payload?.title === 'string' ? n.payload.title : '';
  const dueDate = typeof n.payload?.dueDate === 'string' ? n.payload.dueDate : null;
  const kind = typeof n.payload?.kind === 'string' ? n.payload.kind : null;

  const subject = st(locale, subjectKeyFor(n.type, kind));
  const isCalendar = n.entity_type === 'calendar_connection';

  // ⚠️ IL DESTINATARIO VA RIMESSO QUI, e la sua assenza è costata l'intera
  // funzione. `buildReminderEmail` compone SOLO oggetto e corpo — non conosce
  // nessun indirizzo, e non deve conoscerlo. Restituendo il suo risultato nudo,
  // `message.to` era `undefined`, `JSON.stringify` lo trasformava in `null`
  // dentro l'array, e ogni promemoria sarebbe partito verso `to: [null]`: un
  // 4xx del provider, una consegna chiusa come `failed`, e nessuna email mai
  // arrivata a nessuno.
  //
  // Perché nessuno se ne era accorto: `tsconfig.json` include `src` e
  // `scripts`, quindi un file di `supabase/functions/` entra nel typecheck solo
  // se qualcosa là dentro lo importa — e `notify.ts` non era importato da
  // niente. Ora lo importa la sezione 12 di `test:calendar-unit`, che esegue
  // `deliverEmails` per davvero: il typecheck lo vede, e il test verifica che
  // l'indirizzo arrivi al provider.
  return {
    to,
    ...buildReminderEmail({
      subject,
      companyName,
      // Per un guasto del calendario non c'è un titolo di attività: si mette la
      // frase che spiega cosa è successo, invece di una riga vuota.
      taskTitle: isCalendar
        ? st(locale, n.type === 'calendar_reauth_required' ? 'bodyReauth' : 'bodySyncFailed')
        : title,
      deadlineLine: isCalendar
        ? ''
        : dueDate ? st(locale, 'bodyDeadline', { date: formatDay(dueDate, locale) }) : st(locale, 'bodyNoDeadline'),
      extraLine: n.type === 'unassigned_task_due_soon' ? st(locale, 'bodyUnassigned') : null,
      actionLabel: st(locale, isCalendar ? 'bodyOpenCalendar' : 'bodyOpen'),
      // §88 — l'origine la decide il SERVER. Un collegamento costruito su un host
      // arrivato dal client sarebbe il modo più diretto per mandare i propri
      // utenti a inserire le credenziali su un dominio altrui.
      url: isCalendar
        ? `${deps.appOrigin}/calendario/impostazioni`
        : `${deps.appOrigin}/attivita/${n.entity_id}`,
      footer: st(locale, 'footerWhy', { company: companyName }),
    }),
  };
}

function subjectKeyFor(type: NotificationType, kind: string | null) {
  switch (type) {
    case 'task_assigned': return 'subjectAssigned' as const;
    case 'task_due_today': return 'subjectDueToday' as const;
    case 'task_overdue': return 'subjectOverdue' as const;
    case 'unassigned_task_due_soon': return 'subjectUnassigned' as const;
    case 'calendar_sync_failed': return 'subjectSyncFailed' as const;
    case 'calendar_reauth_required': return 'subjectReauth' as const;
    case 'task_due_soon':
      // «Domani» e «fra una settimana» sono la stessa notifica per il database e
      // due cose diverse per chi legge l'oggetto di un'email.
      return kind === 'd1' ? ('subjectDueTomorrow' as const) : ('subjectDueSoon' as const);
  }
}

/**
 * Avvisa che un calendario non riesce più a sincronizzarsi.
 *
 * Una volta sola per connessione, e solo dopo che i ritentativi sono finiti
 * (§122): un avviso a ogni singolo errore di rete insegnerebbe a ignorarli, e
 * il guasto che conta — il consenso revocato — si perderebbe fra gli altri.
 */
export async function notifyCalendarProblem(
  deps: NotifyDeps,
  input: { companyId: string; userId: string; connectionId: string; reauth: boolean; now?: Date },
): Promise<void> {
  const prefs = await preferencesFor(deps.sb, input.companyId, [input.userId]);
  const p = prefs.get(input.userId) ?? defaultPreferences(input.companyId, input.userId);
  if (!p.in_app_enabled) return;

  const created = await insertNotification(deps.sb, {
    companyId: input.companyId,
    userId: input.userId,
    type: input.reauth ? 'calendar_reauth_required' : 'calendar_sync_failed',
    entityType: 'calendar_connection',
    entityId: input.connectionId,
    payload: {},
    // Due chiavi diverse per due guasti diversi:
    //
    //  · «da ricollegare» è uno stato che finisce con un GESTO dell'utente:
    //    una sola notifica, e il callback OAuth cancella la riga al
    //    ricollegamento — così un'eventuale scadenza futura potrà tornare a
    //    farsi sentire. Senza quella cancellazione la chiave resterebbe
    //    occupata per sempre, e un avviso che si può dare una volta sola nella
    //    vita di una connessione non è un avviso.
    //
    //  · «non si sincronizza» può risolversi DA SOLO — il provider torna su, la
    //    rete si riprende — e nessuno cancella niente. Con una chiave fissa il
    //    secondo guasto, mesi dopo, resterebbe muto. La chiave porta quindi il
    //    GIORNO: al massimo un avviso al giorno per connessione, e il problema
    //    che ritorna torna a farsi sentire.
    dedupeKey: input.reauth
      ? `calendar:${input.connectionId}:reauth`
      : `calendar:${input.connectionId}:sync_failed:${(input.now ?? new Date()).toISOString().slice(0, 10)}`,
  });
  if (created && p.email_enabled && deps.emailProvider) {
    await enqueueEmailDelivery(deps.sb, created);
  }
}
