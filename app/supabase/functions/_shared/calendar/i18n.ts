// ============================================================================
// I testi che il SERVER scrive fuori dal prodotto.
//
// Sono pochi e stanno qui perché escono dal perimetro dell'interfaccia: la
// descrizione di un evento nel calendario personale di qualcuno e il corpo di
// un'email di promemoria. `src/i18n` non può servirli — quello vive nel browser
// e conosce la lingua dalla sessione, mentre un worker che gira alle otto del
// mattino non ha nessuna sessione da cui dedurla. La lingua arriva da
// `notification_preferences.locale`, cioè da una scelta registrata, non da un
// ripiego.
//
// La garanzia contro le traduzioni incomplete è la stessa del frontend: `de` e
// `fr` sono tipizzati come `typeof it`, quindi una chiave mancante rompe
// `npm run typecheck`. Non esiste un fallback che mostri l'italiano dentro
// un'email tedesca senza che nessuno se ne accorga.
//
// Modulo PORTABILE: nessuna API Deno.
// ============================================================================

export type ServerLocale = 'it' | 'de' | 'fr';
export const SERVER_LOCALES: ServerLocale[] = ['it', 'de', 'fr'];

/** Tag BCP-47 per le date: la variante svizzera, come nel resto del prodotto. */
export const LOCALE_TAG: Record<ServerLocale, string> = {
  it: 'it-CH', de: 'de-CH', fr: 'fr-CH',
};

const it = {
  // ---- Evento sul calendario esterno --------------------------------------
  eventIntro: 'Attività sincronizzata da AI-Swisse.',
  eventCompany: 'Azienda: {company}',
  eventPriority: 'Priorità: {priority}',
  eventOpen: 'Apri in AI-Swisse: {url}',
  // Titolo usato quando la persona ha scelto di non mostrare il titolo vero
  // nel calendario esterno (§96). Dice che c'è qualcosa e dove guardare, e non
  // finge di essere un titolo.
  eventGenericTitle: 'Attività AI-Swisse in scadenza',
  priorityHigh: 'Alta',
  priorityMedium: 'Media',
  priorityLow: 'Bassa',

  // ---- Email di notifica ---------------------------------------------------
  subjectAssigned: 'AI-Swisse — Ti è stata assegnata un’attività',
  subjectDueSoon: 'AI-Swisse — Attività in scadenza',
  subjectDueTomorrow: 'AI-Swisse — Attività in scadenza domani',
  subjectDueToday: 'AI-Swisse — Attività in scadenza oggi',
  subjectOverdue: 'AI-Swisse — Attività scaduta',
  subjectUnassigned: 'AI-Swisse — Attività urgente senza responsabile',
  subjectSyncFailed: 'AI-Swisse — Sincronizzazione del calendario non riuscita',
  subjectReauth: 'AI-Swisse — Il calendario va ricollegato',

  bodyDeadline: 'Scadenza: {date}',
  bodyNoDeadline: 'Senza scadenza',
  bodyOpen: 'Apri attività',
  bodyOpenCalendar: 'Apri le impostazioni del calendario',
  bodySyncFailed: 'Le attività non vengono più copiate sul calendario collegato. Il lavoro registrato in AI-Swisse non è stato toccato.',
  bodyReauth: 'Il collegamento con il calendario è scaduto o è stato revocato. Per riprenderlo serve autorizzare di nuovo AI-Swisse.',
  bodyUnassigned: 'Questa attività è urgente e non ha un responsabile.',
  // Perché questa email arriva, e come si smette di riceverla. Senza questa
  // riga un promemoria è indistinguibile da posta non richiesta.
  footerWhy: 'Ricevi questo messaggio perché hai attivato le notifiche via email per {company} in AI-Swisse. Puoi spegnerle dalle impostazioni di Notifiche e calendario.',
} as const;

type Dict = Record<keyof typeof it, string>;

const de: Dict = {
  eventIntro: 'Von AI-Swisse synchronisierte Aufgabe.',
  eventCompany: 'Unternehmen: {company}',
  eventPriority: 'Priorität: {priority}',
  eventOpen: 'In AI-Swisse öffnen: {url}',
  eventGenericTitle: 'AI-Swisse-Aufgabe mit Frist',
  priorityHigh: 'Hoch',
  priorityMedium: 'Mittel',
  priorityLow: 'Niedrig',

  subjectAssigned: 'AI-Swisse — Ihnen wurde eine Aufgabe zugewiesen',
  subjectDueSoon: 'AI-Swisse — Aufgabe mit näher rückender Frist',
  subjectDueTomorrow: 'AI-Swisse — Aufgabe mit Frist morgen',
  subjectDueToday: 'AI-Swisse — Aufgabe mit Frist heute',
  subjectOverdue: 'AI-Swisse — Frist überschritten',
  subjectUnassigned: 'AI-Swisse — Dringende Aufgabe ohne zuständige Person',
  subjectSyncFailed: 'AI-Swisse — Kalendersynchronisierung fehlgeschlagen',
  subjectReauth: 'AI-Swisse — Der Kalender muss neu verbunden werden',

  bodyDeadline: 'Frist: {date}',
  bodyNoDeadline: 'Ohne Frist',
  bodyOpen: 'Aufgabe öffnen',
  bodyOpenCalendar: 'Kalendereinstellungen öffnen',
  bodySyncFailed: 'Die Aufgaben werden nicht mehr in den verbundenen Kalender übertragen. Die in AI-Swisse erfasste Arbeit wurde nicht verändert.',
  bodyReauth: 'Die Verbindung zum Kalender ist abgelaufen oder wurde widerrufen. Um sie fortzusetzen, muss AI-Swisse erneut autorisiert werden.',
  bodyUnassigned: 'Diese Aufgabe ist dringend und hat keine zuständige Person.',
  footerWhy: 'Sie erhalten diese Nachricht, weil Sie die E-Mail-Benachrichtigungen für {company} in AI-Swisse aktiviert haben. Sie können sie in den Einstellungen «Benachrichtigungen und Kalender» ausschalten.',
};

const fr: Dict = {
  eventIntro: 'Tâche synchronisée depuis AI-Swisse.',
  eventCompany: 'Entreprise : {company}',
  eventPriority: 'Priorité : {priority}',
  eventOpen: 'Ouvrir dans AI-Swisse : {url}',
  eventGenericTitle: 'Tâche AI-Swisse à échéance',
  priorityHigh: 'Haute',
  priorityMedium: 'Moyenne',
  priorityLow: 'Basse',

  subjectAssigned: 'AI-Swisse — Une tâche vous a été attribuée',
  subjectDueSoon: 'AI-Swisse — Tâche dont l’échéance approche',
  subjectDueTomorrow: 'AI-Swisse — Tâche à échéance demain',
  subjectDueToday: 'AI-Swisse — Tâche à échéance aujourd’hui',
  subjectOverdue: 'AI-Swisse — Échéance dépassée',
  subjectUnassigned: 'AI-Swisse — Tâche urgente sans responsable',
  subjectSyncFailed: 'AI-Swisse — Échec de la synchronisation du calendrier',
  subjectReauth: 'AI-Swisse — Le calendrier doit être reconnecté',

  bodyDeadline: 'Échéance : {date}',
  bodyNoDeadline: 'Sans échéance',
  bodyOpen: 'Ouvrir la tâche',
  bodyOpenCalendar: 'Ouvrir les paramètres du calendrier',
  bodySyncFailed: 'Les tâches ne sont plus copiées vers le calendrier connecté. Le travail enregistré dans AI-Swisse n’a pas été modifié.',
  bodyReauth: 'La connexion au calendrier a expiré ou a été révoquée. Pour la reprendre, il faut autoriser AI-Swisse à nouveau.',
  bodyUnassigned: 'Cette tâche est urgente et n’a pas de responsable.',
  footerWhy: 'Vous recevez ce message parce que vous avez activé les notifications par e-mail pour {company} dans AI-Swisse. Vous pouvez les désactiver depuis les paramètres « Notifications et calendrier ».',
};

const DICTS: Record<ServerLocale, Dict> = { it, de, fr };

export type ServerKey = keyof typeof it;

/** Traduzione con interpolazione `{nome}`. Stessa convenzione del frontend. */
export function st(locale: ServerLocale, key: ServerKey, vars?: Record<string, string>): string {
  const raw = DICTS[locale][key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
}

/** Lingua dichiarata dal client o dal database; l'italiano è il ripiego. */
export function asServerLocale(value: unknown): ServerLocale {
  return value === 'de' ? 'de' : value === 'fr' ? 'fr' : 'it';
}

/**
 * Data leggibile nella lingua di chi legge. `YYYY-MM-DD` è una data di
 * calendario, quindi si formatta in UTC: interpretarla nel fuso del server
 * farebbe comparire il giorno prima a chi sta a ovest di Greenwich.
 */
export function formatDay(day: string, locale: ServerLocale): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(LOCALE_TAG[locale], {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
