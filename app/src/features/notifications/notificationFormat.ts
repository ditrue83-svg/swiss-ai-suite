// ============================================================================
// Come si legge una notifica: funzioni PURE, senza React e senza rete.
//
// Stanno qui perché sono decisioni di prodotto — quale frase corrisponde a
// quale tipo, dove porta il collegamento — e le decisioni di prodotto vanno
// provate. Un tipo senza etichetta comparirebbe grezzo in pagina, che è
// esattamente il difetto trovato nella 0017 con le categorie.
// ============================================================================
import type { TKey } from '@/i18n';
import type { AppNotification, NotificationType } from '@/types/models';

/**
 * La frase di un tipo di notifica.
 *
 * ⚠️ `task_due_soon` si sdoppia guardando `payload.kind`: per il database
 * «fra una settimana» e «domani» sono la stessa notifica, per chi legge sono
 * due cose diverse. Il `kind` lo scrive il worker che l'ha generata, quindi non
 * è una deduzione: è il dato.
 */
export function notificationTitleKey(n: Pick<AppNotification, 'type' | 'payload'>): TKey {
  switch (n.type) {
    case 'task_assigned': return 'notifications.typeAssigned';
    case 'task_due_soon':
      return n.payload?.kind === 'd1' ? 'notifications.typeDueTomorrow' : 'notifications.typeDueSoon';
    case 'task_due_today': return 'notifications.typeDueToday';
    case 'task_overdue': return 'notifications.typeOverdue';
    case 'unassigned_task_due_soon': return 'notifications.typeUnassigned';
    case 'calendar_sync_failed': return 'notifications.typeSyncFailed';
    case 'calendar_reauth_required': return 'notifications.typeReauth';
    // 0020 — l'avviso di una regola aziendale. Il TESTO lo ha scritto l'azienda
    // dentro la regola e non è traducibile: questa chiave è solo l'intestazione
    // («Automazione»), il testo sta nel payload e si mostra così com'è.
    case 'workflow_alert': return 'notifications.typeWorkflow';
  }
}

/**
 * Dove porta il collegamento.
 *
 * Non viene mai da un URL salvato nella notifica: si costruisce dal tipo di
 * entità e dal suo identificativo. Un URL conservato mesi fa punterebbe a un
 * dominio che nel frattempo può essere cambiato, e sarebbe l'unico posto del
 * prodotto in cui un indirizzo vive fuori dal codice che lo genera.
 */
export function notificationLink(n: Pick<AppNotification, 'entityType' | 'entityId'>): string {
  if (n.entityType === 'task') return `/attivita/${n.entityId}`;
  if (n.entityType === 'calendar_connection') return '/calendario/impostazioni';
  // 0020 — un avviso di regola può riferirsi a un documento o a una
  // comunicazione. Le comunicazioni non hanno un indirizzo proprio: si aprono
  // dalla lista, e portare lì è la verità.
  if (n.entityType === 'document') return `/documenti/${n.entityId}`;
  if (n.entityType === 'email_message') return '/inbox';
  // Un tipo di entità che non conosciamo non diventa un collegamento inventato:
  // porta alla panoramica, che esiste sempre.
  return '/';
}

/** Un tipo che segnala un guasto e non un promemoria: la UI lo evidenzia. */
export function isProblem(type: NotificationType): boolean {
  return type === 'calendar_sync_failed'
    || type === 'calendar_reauth_required'
    || type === 'task_overdue'
    || type === 'unassigned_task_due_soon';
}

/**
 * «2 ore fa», nella lingua di chi legge.
 *
 * Passa da `Intl.RelativeTimeFormat` e non da quattro chiavi di dizionario per
 * lingua: le regole del plurale e delle forme brevi cambiano fra italiano,
 * tedesco e francese, e scriverle a mano significherebbe sbagliarle in almeno
 * una delle tre. Qui le sa il browser.
 */
export function relativeTime(iso: string, localeTag: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((then - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' });

  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(Math.round(seconds), 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 2_592_000) return rtf.format(Math.round(seconds / 86_400), 'day');
  return rtf.format(Math.round(seconds / 2_592_000), 'month');
}

/**
 * Il numero sul pallino. Oltre nove diventa «9+» (§80).
 *
 * Non è un vezzo grafico: un pallino che deve contenere «147» o diventa largo
 * quanto una parola o rimpicciolisce il testo sotto la soglia leggibile. Il
 * numero esatto resta nell'etichetta per lo screen reader, dove lo spazio non
 * è un problema.
 */
export function badgeLabel(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}
